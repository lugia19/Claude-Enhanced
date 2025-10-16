// tts-providers.js
(function () {
	'use strict';

	//#region Streaming Playback Manager (Singleton)
	class StreamingPlaybackManager {
		constructor(onStateChange = null) {
			this.state = 'idle';
			this.currentSessionId = null;
			this.audioContext = null;
			this.abortController = null;
			this.activeSources = [];
			this.scheduledEndTime = 0;

			this.pendingQueue = [];
			this.isProcessing = false;
			this.isGenerating = false;

			this.completionPromise = null;
			this.completionResolve = null;

			this.onStateChange = onStateChange;
		}

		changeState(newState, newProcessing = this.isProcessing) {
			console.log(`State change: ${this.state} -> ${newState}, Processing: ${this.isProcessing} -> ${newProcessing}, is callback present: ${!!this.onStateChange}`);
			this.state = newState;
			this.isProcessing = newProcessing;
			this.onStateChange?.(this.state, this.isProcessing);
		}

		queue(streamFactory) {
			this.pendingQueue.push({
				streamFactory: streamFactory,
				sessionId: this.currentSessionId
			});

			if (!this.completionPromise) {
				console.log('Creating new completion promise');
				this.completionPromise = new Promise(resolve => {
					this.completionResolve = resolve;
				});
			}

			if (!this.isProcessing) {
				this.processQueue();
			}
		}

		async processQueue() {
			this.changeState(this.state, true);

			while (this.pendingQueue.length > 0 || this.isGenerating) {
				if (!this.currentSessionId) {
					this.pendingQueue = [];
					break;
				}

				if (this.pendingQueue.length > 0 && !this.isGenerating) {
					const next = this.pendingQueue.shift();

					if (next.sessionId === this.currentSessionId) {
						this.processStream(next.streamFactory, next.sessionId)
							.catch(error => {
								console.error('Stream processing error:', error);
							});
					}
				}

				await new Promise(r => setTimeout(r, 100));
			}

			// Wait for all scheduled audio to finish playing
			if (this.currentSessionId && this.scheduledEndTime > 0) {
				const remainingTime = this.scheduledEndTime - this.audioContext.currentTime;
				if (remainingTime > 0) {
					await new Promise(resolve => setTimeout(resolve, remainingTime * 1000 + 100));
				}
			}

			this.changeState('idle', false);

			if (this.completionResolve) {
				this.completionResolve();
				this.completionPromise = null;
				this.completionResolve = null;
			}
		}

		async waitForCompletion() {
			if (this.completionPromise) {
				return this.completionPromise;
			}
			return Promise.resolve();
		}

		async startSession() {
			await this.stop();

			const sessionId = Date.now() + '_' + Math.random();
			this.currentSessionId = sessionId;

			this.changeState('loading');

			this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

			return sessionId;
		}

		async processStream(streamFactory, sessionId) {
			this.isGenerating = true;
			return new Promise(async (resolve, reject) => {
				try {
					if (this.currentSessionId !== sessionId) {
						console.log(`[Session ${sessionId}] Stream aborted before start`);
						this.isGenerating = false;
						resolve();
						return;
					}

					this.abortController = new AbortController();

					const reader = await streamFactory();

					let nextStartTime = Math.max(
						this.audioContext.currentTime + 0.1,
						this.scheduledEndTime
					);
					let leftoverBytes = new Uint8Array(0);
					let firstChunk = true;

					while (true) {
						if (this.currentSessionId !== sessionId) {
							reader.cancel();
							this.isGenerating = false;
							resolve();
							return;
						}

						const { done, value } = await reader.read();
						if (done) {
							this.isGenerating = false;
							console.log(`[Session ${sessionId}] Audio stream fully read`);
							break;
						}

						if (firstChunk && this.state === 'loading') {
							this.changeState('playing');
							firstChunk = false;
							console.log(`[Session ${sessionId}] Audio started playing`);
						}

						const combinedData = new Uint8Array(leftoverBytes.length + value.length);
						combinedData.set(leftoverBytes);
						combinedData.set(value, leftoverBytes.length);

						const completeSamples = Math.floor(combinedData.length / 2);
						const bytesToProcess = completeSamples * 2;

						if (completeSamples > 0) {
							if (this.currentSessionId !== sessionId) {
								reader.cancel();
								this.isGenerating = false;
								resolve();
								return;
							}

							const pcmData = new Int16Array(combinedData.buffer, combinedData.byteOffset, completeSamples);

							const audioBuffer = this.audioContext.createBuffer(1, pcmData.length, 24000);
							const channelData = audioBuffer.getChannelData(0);
							for (let i = 0; i < pcmData.length; i++) {
								channelData[i] = pcmData[i] / 32768.0;
							}

							const source = this.audioContext.createBufferSource();
							source.buffer = audioBuffer;
							source.connect(this.audioContext.destination);

							source.start(nextStartTime);
							const endTime = nextStartTime + audioBuffer.duration;

							this.registerSource(source, sessionId, endTime);

							nextStartTime = endTime;
							this.scheduledEndTime = Math.max(this.scheduledEndTime, endTime);
						}

						leftoverBytes = combinedData.slice(bytesToProcess);
					}

					resolve();

				} catch (error) {
					this.isGenerating = false;
					if (error.name === 'AbortError') {
						console.log(`[Session ${sessionId}] Fetch aborted`);
						resolve();
					} else {
						reject(error);
					}
				} finally {
					console.log(`[Session ${sessionId}] Stream processing completed or aborted`);
				}
			});
		}

		async stop() {
			if (this.state === 'idle' && !this.isProcessing) {
				return;
			}

			console.log('Stopping playback, state:', this.state);

			this.changeState('stopping');

			const oldSessionId = this.currentSessionId;
			this.currentSessionId = null;

			this.pendingQueue = [];

			if (this.abortController) {
				this.abortController.abort();
				this.abortController = null;
			}

			const sourcesToStop = [...this.activeSources];
			console.log(`Stopping ${sourcesToStop.length} active sources`);

			for (const sourceInfo of sourcesToStop) {
				if (!sourceInfo.stopped) {
					try {
						sourceInfo.source.stop(0);
						sourceInfo.stopped = true;
					} catch (e) {
						console.log('Source already stopped:', e);
					}
				}
			}

			this.activeSources = [];
			this.scheduledEndTime = 0;

			if (this.completionResolve) {
				this.completionResolve();
				this.completionPromise = null;
				this.completionResolve = null;
			}

			this.cleanupAudioContext();

			this.changeState('idle', false);

			console.log(`Playback stopped${oldSessionId ? ` (was session ${oldSessionId})` : ''}`);
		}

		registerSource(source, sessionId, endTime) {
			const sourceInfo = {
				source,
				sessionId,
				endTime,
				stopped: false
			};

			this.activeSources.push(sourceInfo);

			source.onended = () => {
				sourceInfo.stopped = true;
				this.activeSources = this.activeSources.filter(s => s !== sourceInfo);
			};
		}

		cleanupAudioContext() {
			if (this.audioContext) {
				try {
					if (this.audioContext.state !== 'closed') {
						this.audioContext.close();
					}
				} catch (e) {
					console.error('Error closing AudioContext:', e);
				}
				this.audioContext = null;
			}
		}

		isActive() {
			return this.state !== 'idle' || this.isProcessing;
		}
	}

	const streamingPlaybackManager = new StreamingPlaybackManager();
	//#endregion

	//#region Base Provider
	class Provider {
		constructor(onStateChange = null) {
			this.onStateChange = onStateChange;
		}

		async getVoices(apiKey) {
			throw new Error('getVoices must be implemented by provider');
		}

		async getModels(apiKey) {
			throw new Error('getModels must be implemented by provider');
		}

		async testApiKey(apiKey) {
			throw new Error('testApiKey must be implemented by provider');
		}

		async attributeDialogueToCharacters(text, characters) {
			throw new Error('attributeDialogueToCharacters must be implemented by provider');
		}

		async play(text, voice, model, apiKey) {
			throw new Error('play must be implemented by provider');
		}

		async queue(text, voice, model, apiKey, extra = {}) {
			throw new Error('queue must be implemented by provider');
		}

		async stop() {
			throw new Error('stop must be implemented by provider');
		}

		isActive() {
			throw new Error('isActive must be implemented by provider');
		}

		async startSession() {
			throw new Error('startSession must be implemented by provider');
		}

		async waitForCompletion() {
			throw new Error('waitForCompletion must be implemented by provider');
		}

		getCurrentSessionId() {
			throw new Error('getCurrentSessionId must be implemented by provider');
		}
	}
	//#endregion

	//#region ElevenLabs Provider
	class ElevenLabsProvider extends Provider {
		constructor(onStateChange = null) {
			super(onStateChange);
			if (onStateChange) {
				streamingPlaybackManager.onStateChange = onStateChange;
			}
		}

		async getVoices(apiKey) {
			if (!apiKey) {
				return [];
			}

			const allVoices = [];
			let hasMore = true;
			let nextPageToken = null;

			try {
				while (hasMore) {
					let url = 'https://api.elevenlabs.io/v2/voices?page_size=100';
					if (nextPageToken) {
						url += `&next_page_token=${nextPageToken}`;
					}

					const response = await fetch(url, {
						headers: {
							'xi-api-key': apiKey
						}
					});

					if (!response.ok) {
						console.error('Failed to fetch voices:', response.status);
						return allVoices;
					}

					const data = await response.json();

					if (data.voices && data.voices.length > 0) {
						allVoices.push(...data.voices);
						nextPageToken = data.next_page_token;
						hasMore = data.has_more === true;
					} else {
						hasMore = false;
					}
				}

				allVoices.sort((a, b) => a.name.localeCompare(b.name));
				return allVoices;

			} catch (error) {
				console.error('Error fetching voices:', error);
				return allVoices;
			}
		}

		async getModels(apiKey) {
			if (!apiKey) {
				return [];
			}

			try {
				const response = await fetch('https://api.elevenlabs.io/v1/models', {
					headers: { 'xi-api-key': apiKey }
				});

				if (!response.ok) {
					console.error('Failed to fetch models:', response.status);
					return [];
				}

				const models = await response.json();
				return models.filter(model => model.can_do_text_to_speech);

			} catch (error) {
				console.error('Failed to load models:', error);
				return [{
					model_id: 'eleven_multilingual_v2',
					name: 'Multilingual v2',
					can_do_text_to_speech: true
				}];
			}
		}

		async testApiKey(apiKey) {
			try {
				const response = await fetch('https://api.elevenlabs.io/v1/user', {
					headers: {
						'xi-api-key': apiKey
					}
				});
				return response.ok;
			} catch (error) {
				return false;
			}
		}

		async attributeDialogueToCharacters(text, characters, model) {
			const narratorChar = characters.find(c => c.name.toLowerCase() === 'narrator');
			const includeNarration = narratorChar && narratorChar.voice;
			const availableCharacters = includeNarration
				? characters.map(c => c.name)
				: characters.filter(c => c.name.toLowerCase() !== 'narrator').map(c => c.name);

			// Check if we're using v3 model for emotion tags
			const isV3 = model && model.toLowerCase().includes('v3');

			let prompt;
			if (isV3) {
				prompt = `Output ONLY a JSON array where each element has "character" and "text" fields.
Available characters: ${availableCharacters.join(', ')}

${includeNarration ? 'Include narration as "narrator".' : 'Only include quoted dialogue, skip narration.'}

IMPORTANT: Prefix each text segment with an expression tag in square brackets. Examples: [neutral], [happy], [shouting], [angry] and so on. Simple words.

Example: {"character": "Alice", "text": "[sad]I can't believe this happened."}

Analyze this text and output ONLY the JSON array:
${text}

JSON array:`;
			} else {
				// Basic prompt without emotion tags
				prompt = `Output ONLY a JSON array where each element has "character" and "text" fields.
Available characters: ${availableCharacters.join(', ')}

${includeNarration ? 'Include narration as "narrator".' : 'Only include quoted dialogue, skip narration.'}

Analyze this text and output ONLY the JSON array:
${text}

JSON array:`;
			}

			return new Promise((resolve, reject) => {
				const requestId = Math.random().toString(36).substr(2, 9);

				const listener = (event) => {
					if (event.data.type === 'tts-analyze-dialogue-response' &&
						event.data.requestId === requestId) {
						window.removeEventListener('message', listener);

						if (event.data.success) {
							try {
								const jsonMatch = event.data.data.match(/\[[\s\S]*\]/);
								if (!jsonMatch) {
									throw new Error('No JSON array found in response');
								}

								const parsed = JSON.parse(jsonMatch[0]);
								const segments = parsed.map(s => ({
									character: s.character.toLowerCase(),
									text: s.text, // Keep emotion tags in text
									extra: {}
								}));

								resolve(segments);
							} catch (error) {
								console.error('Failed to parse attribution response:', error);
								reject(error);
							}
						} else {
							reject(new Error(event.data.error));
						}
					}
				};

				window.addEventListener('message', listener);

				window.postMessage({
					type: 'tts-analyze-dialogue-request',
					prompt: prompt,
					requestId: requestId
				}, '*');

				setTimeout(() => {
					window.removeEventListener('message', listener);
					reject(new Error('Dialogue analysis timed out'));
				}, 30000);
			});
		}

		async streamText(text, voiceId, modelId, apiKey, extra = {}) {
			const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=pcm_24000`;
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'xi-api-key': apiKey,
				},
				body: JSON.stringify({
					text: text,
					model_id: modelId,
					apply_text_normalization: (modelId.includes("turbo") || modelId.includes("flash")) ? "off" : "on"
				}),
				signal: streamingPlaybackManager.abortController?.signal
			});

			if (!response.ok) {
				const error = await response.text();
				throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
			}

			return response.body.getReader();
		}

		chunkText(text, maxLength) {
			if (text.length <= maxLength) {
				return [text];
			}

			const chunks = [];
			let currentChunk = '';

			const sentences = text.split(/(?<=[.!?])\s+/);

			for (const sentence of sentences) {
				if ((currentChunk + sentence).length > maxLength) {
					if (currentChunk) {
						chunks.push(currentChunk.trim());
						currentChunk = '';
					}

					if (sentence.length > maxLength) {
						const words = sentence.split(' ');
						for (const word of words) {
							if ((currentChunk + ' ' + word).length > maxLength) {
								if (currentChunk) {
									chunks.push(currentChunk.trim());
									currentChunk = '';
								}
							}
							currentChunk += (currentChunk ? ' ' : '') + word;
						}
					} else {
						currentChunk = sentence;
					}
				} else {
					currentChunk += (currentChunk ? ' ' : '') + sentence;
				}
			}

			if (currentChunk) {
				chunks.push(currentChunk.trim());
			}

			return chunks;
		}

		async play(text, voice, model, apiKey) {
			await streamingPlaybackManager.startSession();

			const chunks = this.chunkText(text, 9000);

			for (const chunk of chunks) {
				streamingPlaybackManager.queue(
					async () => this.streamText(chunk, voice, model, apiKey)
				);
			}

			await streamingPlaybackManager.waitForCompletion();
			console.log('Playback completed');
		}

		async queue(text, voice, model, apiKey, extra = {}) {
			const chunks = this.chunkText(text, 9000);

			for (const chunk of chunks) {
				streamingPlaybackManager.queue(
					async () => this.streamText(chunk, voice, model, apiKey, extra)
				);
			}
		}

		async stop() {
			await streamingPlaybackManager.stop();
		}

		isActive() {
			return streamingPlaybackManager.isActive();
		}

		async startSession() {
			return await streamingPlaybackManager.startSession();
		}

		async waitForCompletion() {
			return streamingPlaybackManager.waitForCompletion();
		}

		getCurrentSessionId() {
			return streamingPlaybackManager.currentSessionId;
		}
	}
	//#endregion

	//#region OpenAI Provider
	class OpenAIProvider extends Provider {
		constructor(onStateChange = null) {
			super(onStateChange);
			if (onStateChange) {
				streamingPlaybackManager.onStateChange = onStateChange;
			}
		}

		async getVoices(apiKey) {
			return [
				{ voice_id: 'alloy', name: 'Alloy' },
				{ voice_id: 'ash', name: 'Ash' },
				{ voice_id: 'ballad', name: 'Ballad' },
				{ voice_id: 'coral', name: 'Coral' },
				{ voice_id: 'echo', name: 'Echo' },
				{ voice_id: 'fable', name: 'Fable' },
				{ voice_id: 'onyx', name: 'Onyx' },
				{ voice_id: 'nova', name: 'Nova' },
				{ voice_id: 'sage', name: 'Sage' },
				{ voice_id: 'shimmer', name: 'Shimmer' },
				{ voice_id: 'verse', name: 'Verse' }
			];
		}

		async getModels(apiKey) {
			return [
				{ model_id: 'gpt-4o-mini-tts', name: 'GPT-4o Mini TTS', can_do_text_to_speech: true }
			];
		}

		async testApiKey(apiKey) {
			try {
				const response = await fetch('https://api.openai.com/v1/models', {
					headers: {
						'Authorization': `Bearer ${apiKey}`
					}
				});
				return response.ok;
			} catch (error) {
				return false;
			}
		}

		async attributeDialogueToCharacters(text, characters) {
			// Build OpenAI-specific prompt
			const narratorChar = characters.find(c => c.name.toLowerCase() === 'narrator');
			const includeNarration = narratorChar && narratorChar.voice;
			const availableCharacters = includeNarration
				? characters.map(c => c.name)
				: characters.filter(c => c.name.toLowerCase() !== 'narrator').map(c => c.name);

			const prompt = `Output ONLY a JSON array where each element has:
- "character": one of [${availableCharacters.join(', ')}]
- "text": the dialogue or narration text
- "instructions": brief voice instruction (e.g., "speak sadly", "whisper excitedly", "calm and measured")

${includeNarration ? 'Include narration as "narrator".' : 'Only include quoted dialogue, skip narration.'}

Analyze this text and output ONLY the JSON array:
${text}

JSON array:`;

			return new Promise((resolve, reject) => {
				const requestId = Math.random().toString(36).substr(2, 9);

				const listener = (event) => {
					if (event.data.type === 'tts-analyze-dialogue-response' &&
						event.data.requestId === requestId) {
						window.removeEventListener('message', listener);

						if (event.data.success) {
							try {
								// Parse JSON from response
								const jsonMatch = event.data.data.match(/\[[\s\S]*\]/);
								if (!jsonMatch) {
									throw new Error('No JSON array found in response');
								}

								const parsed = JSON.parse(jsonMatch[0]);
								const segments = parsed.map(s => ({
									character: s.character.toLowerCase(),
									text: s.text,
									extra: { instructions: s.instructions || '' }
								}));

								resolve(segments);
							} catch (error) {
								console.error('Failed to parse attribution response:', error);
								reject(error);
							}
						} else {
							reject(new Error(event.data.error));
						}
					}
				};

				window.addEventListener('message', listener);

				window.postMessage({
					type: 'tts-analyze-dialogue-request',
					prompt: prompt,
					requestId: requestId
				}, '*');

				setTimeout(() => {
					window.removeEventListener('message', listener);
					reject(new Error('Dialogue analysis timed out'));
				}, 30000);
			});
		}

		async streamText(text, voiceId, modelId, apiKey, extra = {}) {
			const body = {
				input: text,
				model: modelId,
				voice: voiceId,
				response_format: 'pcm'
			};

			// Add instructions if present and model supports it
			if (extra.instructions && modelId === 'gpt-4o-mini-tts') {
				body.instructions = extra.instructions;
			}

			const response = await fetch('https://api.openai.com/v1/audio/speech', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
				signal: streamingPlaybackManager.abortController?.signal
			});

			if (!response.ok) {
				const error = await response.text();
				throw new Error(`OpenAI API error: ${response.status} - ${error}`);
			}

			return response.body.getReader();
		}

		chunkText(text, maxLength) {
			if (text.length <= maxLength) {
				return [text];
			}

			const chunks = [];
			let currentChunk = '';

			const sentences = text.split(/(?<=[.!?])\s+/);

			for (const sentence of sentences) {
				if ((currentChunk + sentence).length > maxLength) {
					if (currentChunk) {
						chunks.push(currentChunk.trim());
						currentChunk = '';
					}

					if (sentence.length > maxLength) {
						const words = sentence.split(' ');
						for (const word of words) {
							if ((currentChunk + ' ' + word).length > maxLength) {
								if (currentChunk) {
									chunks.push(currentChunk.trim());
									currentChunk = '';
								}
							}
							currentChunk += (currentChunk ? ' ' : '') + word;
						}
					} else {
						currentChunk = sentence;
					}
				} else {
					currentChunk += (currentChunk ? ' ' : '') + sentence;
				}
			}

			if (currentChunk) {
				chunks.push(currentChunk.trim());
			}

			return chunks;
		}

		async play(text, voice, model, apiKey) {
			await streamingPlaybackManager.startSession();

			const chunks = this.chunkText(text, 4096);

			for (const chunk of chunks) {
				streamingPlaybackManager.queue(
					async () => this.streamText(chunk, voice, model, apiKey)
				);
			}

			await streamingPlaybackManager.waitForCompletion();
			console.log('Playback completed');
		}

		async queue(text, voice, model, apiKey, extra = {}) {
			const chunks = this.chunkText(text, 4096);

			for (const chunk of chunks) {
				streamingPlaybackManager.queue(
					async () => this.streamText(chunk, voice, model, apiKey, extra)
				);
			}
		}

		async stop() {
			await streamingPlaybackManager.stop();
		}

		isActive() {
			return streamingPlaybackManager.isActive();
		}

		async startSession() {
			return await streamingPlaybackManager.startSession();
		}

		async waitForCompletion() {
			return streamingPlaybackManager.waitForCompletion();
		}

		getCurrentSessionId() {
			return streamingPlaybackManager.currentSessionId;
		}
	}
	//#endregion

	//#region Browser TTS Provider
	class BrowserTTSProvider extends Provider {
		constructor(onStateChange = null) {
			super(onStateChange);
			this.synth = window.speechSynthesis;
			this.state = 'idle';
			this.isProcessing = false;
			this.onStateChange = onStateChange;
			this.utteranceQueue = [];
			this.currentSessionId = null;
		}

		changeState(newState, newProcessing = this.isProcessing) {
			this.state = newState;
			this.isProcessing = newProcessing;
			this.onStateChange?.(this.state, this.isProcessing);
		}

		async getVoices(apiKey) {
			// Browser voices load asynchronously, might need to wait
			let voices = this.synth.getVoices();

			if (voices.length === 0) {
				// Wait for voices to load
				await new Promise(resolve => {
					this.synth.addEventListener('voiceschanged', resolve, { once: true });
					setTimeout(resolve, 1000); // Timeout fallback
				});
				voices = this.synth.getVoices();
			}

			return voices.map(v => ({
				voice_id: v.voiceURI,
				name: `${v.name} (${v.lang})`
			}));
		}

		async getModels(apiKey) {
			return [
				{ model_id: 'browser', name: 'Browser TTS', can_do_text_to_speech: true }
			];
		}

		async testApiKey(apiKey) {
			return true; // No API key needed
		}

		async attributeDialogueToCharacters(text, characters) {
			// Basic attribution via Claude
			return new Promise((resolve, reject) => {
				const requestId = Math.random().toString(36).substr(2, 9);

				const listener = (event) => {
					if (event.data.type === 'tts-analyze-dialogue-response' &&
						event.data.requestId === requestId) {
						window.removeEventListener('message', listener);

						if (event.data.success) {
							const segments = event.data.data.map(seg => ({
								...seg,
								extra: {}
							}));
							resolve(segments);
						} else {
							reject(new Error(event.data.error));
						}
					}
				};

				window.addEventListener('message', listener);

				window.postMessage({
					type: 'tts-analyze-dialogue-request',
					text: text,
					characters: characters,
					requestId: requestId
				}, '*');

				setTimeout(() => {
					window.removeEventListener('message', listener);
					reject(new Error('Dialogue analysis timed out'));
				}, 30000);
			});
		}

		async speak(text, voiceId, extra = {}) {
			return new Promise((resolve, reject) => {
				const sessionId = this.currentSessionId;

				const utterance = new SpeechSynthesisUtterance(text);

				// Find and set voice
				const voices = this.synth.getVoices();
				const voice = voices.find(v => v.voiceURI === voiceId);
				if (voice) {
					utterance.voice = voice;
				}

				utterance.onstart = () => {
					if (this.state === 'loading') {
						this.changeState('playing');
					}
				};

				utterance.onend = () => {
					// Check if session is still valid
					if (this.currentSessionId === sessionId) {
						resolve();
					}
				};

				utterance.onerror = (event) => {
					console.error('Speech synthesis error:', event);
					reject(event.error);
				};

				// Check session before speaking
				if (this.currentSessionId !== sessionId) {
					resolve(); // Session cancelled
					return;
				}

				this.synth.speak(utterance);
			});
		}

		async play(text, voice, model, apiKey) {
			await this.startSession();
			await this.speak(text, voice);
			this.changeState('idle', false);
		}

		async queue(text, voice, model, apiKey, extra = {}) {
			this.utteranceQueue.push({ text, voice, extra, sessionId: this.currentSessionId });

			if (!this.isProcessing) {
				this.processQueue();
			}
		}

		async processQueue() {
			this.changeState(this.state, true);

			while (this.utteranceQueue.length > 0) {
				if (!this.currentSessionId) {
					this.utteranceQueue = [];
					break;
				}

				const next = this.utteranceQueue.shift();

				if (next.sessionId === this.currentSessionId) {
					try {
						await this.speak(next.text, next.voice, next.extra);
					} catch (error) {
						console.error('Speech error:', error);
					}
				}
			}

			this.changeState('idle', false);
		}

		async stop() {
			if (this.state === 'idle' && !this.isProcessing) {
				return;
			}

			console.log('Stopping browser TTS');

			this.changeState('stopping');
			this.currentSessionId = null;
			this.utteranceQueue = [];
			this.synth.cancel();
			this.changeState('idle', false);
		}

		isActive() {
			return this.state !== 'idle' || this.isProcessing || this.synth.speaking;
		}

		async startSession() {
			await this.stop();
			const sessionId = Date.now() + '_' + Math.random();
			this.currentSessionId = sessionId;
			this.changeState('loading');
			return sessionId;
		}

		async waitForCompletion() {
			// Wait for queue to empty and synth to finish
			while (this.utteranceQueue.length > 0 || this.synth.speaking) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}

		getCurrentSessionId() {
			return this.currentSessionId;
		}
	}
	//#endregion

	// Export to window for use by main script
	window.TTSProviders = {
		TTS_PROVIDERS: {
			elevenlabs: {
				name: 'ElevenLabs',
				requiresApiKey: true,
				class: ElevenLabsProvider
			},
			openai: {
				name: 'OpenAI',
				requiresApiKey: true,
				class: OpenAIProvider
			},
			browser: {
				name: 'Browser (Free)',
				requiresApiKey: false,
				class: BrowserTTSProvider
			}
		}
	};
})();