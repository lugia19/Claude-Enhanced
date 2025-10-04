// tts.js
(function () {
	'use strict';

	//#region SVG Icons
	const SPEAKER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 16 16">
        <path d="M10 2.5L5.5 5.5H2v5h3.5L10 13.5v-11z" stroke-linejoin="round"/>
        <path d="M13 5c1.5 1 1.5 5 0 6" stroke-linecap="round"/>
    </svg>`;

	const PAUSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#2c84db" viewBox="0 0 16 16" class="pause-icon">
        <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/>
    </svg>`;
	//#endregion

	//#region Playback Manager
	class PlaybackManager {
		constructor() {
			this.state = 'idle'; // idle, loading, playing, stopping
			this.currentSessionId = null;
			this.audioContext = null;
			this.abortController = null;
			this.activeSources = []; // Registry of all active audio sources
			this.scheduledEndTime = 0; // Track when the last scheduled audio ends

			// New queue management properties
			this.pendingQueue = [];
			this.isProcessing = false;
			this.isGenerating = false;

			this.completionPromise = null;
			this.completionResolve = null;
		}

		async queue(text, voiceId, modelId, apiKey) {
			const sessionId = this.currentSessionId;

			// Handle chunking for very long texts
			const chunks = this.chunkText(text, 9000);

			for (const chunk of chunks) {
				this.pendingQueue.push({
					text: chunk,
					voiceId,
					modelId,
					apiKey,
					sessionId
				});
			}

			// Create completion promise if it doesn't exist
			if (!this.completionPromise) {
				console.log('Creating new completion promise');
				this.completionPromise = new Promise(resolve => {
					this.completionResolve = resolve;
				});
			}

			// Start processing if not already running
			if (!this.isProcessing) {
				this.processNextSegment();
			}
		}

		async processNextSegment() {
			this.isProcessing = true;

			while (this.pendingQueue.length > 0 || this.isGenerating) {
				// Check if session is still valid
				if (!this.currentSessionId) {
					// Session was invalidated, clean up
					this.pendingQueue = [];
					break;
				}

				// Only start next generation if:
				// 1. We have pending items
				// 2. We're not currently generating
				if (this.pendingQueue.length > 0 && !this.isGenerating) {
					// Pull next item and start generating
					const next = this.pendingQueue.shift();

					// Only process if session is still valid
					if (next.sessionId === this.currentSessionId) {
						// Start generation (don't await - let it run in parallel)
						this.streamChunk(
							next.text,
							next.voiceId,
							next.modelId,
							next.apiKey,
							next.sessionId
						).catch(error => {
							console.error('Generation error:', error);
						});
					}
				}

				// Small delay to prevent tight loop
				await new Promise(r => setTimeout(r, 100));
			}

			// Wait for all scheduled audio to finish playing
			if (this.currentSessionId && this.scheduledEndTime > 0) {
				const remainingTime = this.scheduledEndTime - this.audioContext.currentTime;
				if (remainingTime > 0) {
					await new Promise(resolve => setTimeout(resolve, remainingTime * 1000 + 100));
				}
			}

			this.isProcessing = false;
			this.state = 'idle';
			this.updateSettingsButton();  // Update button when everything is done

			// Resolve completion promise
			if (this.completionResolve) {
				this.completionResolve();
				this.completionPromise = null;
				this.completionResolve = null;
			}
		}

		// New method to wait for queue completion
		async waitForCompletion() {
			if (this.completionPromise) {
				return this.completionPromise;
			}
			// If not processing, resolve immediately
			return Promise.resolve();
		}

		async startSession() {
			// Stop any existing playback
			await this.stop();

			// Generate new session ID
			const sessionId = Date.now() + '_' + Math.random();
			this.currentSessionId = sessionId;

			// Set loading state and ensure button shows it
			this.state = 'loading';
			this.updateSettingsButton();

			// Create fresh AudioContext
			this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
		}

		// Keep existing play method for non-actor mode as a wrapper
		async play(text, voiceId, modelId, apiKey) {
			// Start a new session (stops any existing playback)
			await this.startSession();

			// Queue the single item
			await this.queue(text, voiceId, modelId, apiKey);

			// Wait for completion
			await this.waitForCompletion();

			console.log('Playback completed');
		}

		async streamChunk(text, voiceId, modelId, apiKey, sessionId) {
			this.isGenerating = true;
			return new Promise(async (resolve, reject) => {
				try {
					// Verify session is still valid
					if (this.currentSessionId !== sessionId) {
						console.log(`[Session ${sessionId}] Generation aborted before start`);
						this.isGenerating = false;
						resolve();
						return;
					}

					// Create abort controller for this chunk
					this.abortController = new AbortController();

					// Make API request
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
						signal: this.abortController.signal
					});

					if (!response.ok) {
						const error = await response.text();
						throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
					}

					const reader = response.body.getReader();
					let nextStartTime = Math.max(
						this.audioContext.currentTime + 0.1,
						this.scheduledEndTime
					);
					let leftoverBytes = new Uint8Array(0);
					let firstChunk = true;

					while (true) {
						// Check session validity before processing each chunk
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

						// Update state on first audio chunk received
						if (firstChunk && this.state === 'loading') {
							this.state = 'playing';
							this.updateSettingsButton();
							firstChunk = false;
							console.log(`[Session ${sessionId}] Audio started playing`);
						}

						// Combine leftover with new chunk
						const combinedData = new Uint8Array(leftoverBytes.length + value.length);
						combinedData.set(leftoverBytes);
						combinedData.set(value, leftoverBytes.length);

						// Process complete 16-bit samples only
						const completeSamples = Math.floor(combinedData.length / 2);
						const bytesToProcess = completeSamples * 2;

						if (completeSamples > 0) {
							// Check session again before scheduling audio
							if (this.currentSessionId !== sessionId) {
								reader.cancel();
								this.isGenerating = false;
								resolve();
								return;
							}

							const pcmData = new Int16Array(combinedData.buffer, combinedData.byteOffset, completeSamples);

							// Create audio buffer
							const audioBuffer = this.audioContext.createBuffer(1, pcmData.length, 24000);
							const channelData = audioBuffer.getChannelData(0);
							for (let i = 0; i < pcmData.length; i++) {
								channelData[i] = pcmData[i] / 32768.0;
							}

							// Create and schedule source
							const source = this.audioContext.createBufferSource();
							source.buffer = audioBuffer;
							source.connect(this.audioContext.destination);

							// Schedule playback
							source.start(nextStartTime);
							const endTime = nextStartTime + audioBuffer.duration;

							// Register this source
							this.registerSource(source, sessionId, endTime);

							// Update timing for next chunk
							nextStartTime = endTime;
							this.scheduledEndTime = Math.max(this.scheduledEndTime, endTime);
						}

						// Save leftover bytes
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
					console.log(`[Session ${sessionId}] Generation completed or aborted`);
				}
			});
		}

		async stop() {
			if (this.state === 'idle' && !this.isProcessing) {
				return;
			}

			console.log('Stopping playback, state:', this.state);

			// Set stopping state to prevent new operations
			this.state = 'stopping';
			this.updateSettingsButton();

			// Invalidate current session
			const oldSessionId = this.currentSessionId;
			this.currentSessionId = null;

			// Clear pending queue
			this.pendingQueue = [];

			// Abort any ongoing fetch
			if (this.abortController) {
				this.abortController.abort();
				this.abortController = null;
			}

			// Stop all active sources immediately
			const sourcesToStop = [...this.activeSources];
			console.log(`Stopping ${sourcesToStop.length} active sources`);

			for (const sourceInfo of sourcesToStop) {
				if (!sourceInfo.stopped) {
					try {
						sourceInfo.source.stop(0); // Stop immediately
						sourceInfo.stopped = true;
					} catch (e) {
						// Source may have already ended naturally
						console.log('Source already stopped:', e);
					}
				}
			}

			// Clear the registry
			this.activeSources = [];
			this.scheduledEndTime = 0;

			// Resolve completion promise if it exists
			if (this.completionResolve) {
				this.completionResolve();
				this.completionPromise = null;
				this.completionResolve = null;
			}

			// Clean up audio context
			this.cleanupAudioContext();

			// Reset to idle state
			this.state = 'idle';
			this.isProcessing = false;
			this.updateSettingsButton();

			console.log(`Playback stopped${oldSessionId ? ` (was session ${oldSessionId})` : ''}`);
		}

		registerSource(source, sessionId, endTime) {
			const sourceInfo = {
				source,
				sessionId,
				endTime,
				stopped: false
			};

			// Add to registry
			this.activeSources.push(sourceInfo);

			// Set up cleanup when source naturally ends
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

		updateSettingsButton() {
			const button = document.querySelector('.tts-settings-button');
			if (!button) return;
			if (this.state === 'loading' || this.state === 'stopping') {
				// Show pause icon with spinning segmented circle
				button.innerHTML = `
                <div class="relative w-5 h-5">
                    <svg class="spinner-segment absolute inset-0" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20">
                        <path d="M10 2a8 8 0 0 1 0 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.3"/>
                        <path d="M10 2a8 8 0 0 1 5.66 2.34" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <div class="absolute inset-0 flex items-center justify-center">
                        ${PAUSE_ICON}
                    </div>
                </div>
            `;
				button.tooltip?.updateText(this.state === 'loading' ? 'Loading audio...' : 'Stopping...');

			} else if (this.state === 'playing' || this.isProcessing) {
				button.innerHTML = PAUSE_ICON;
				button.tooltip?.updateText('Stop playback');

			} else {
				button.innerHTML = SPEAKER_ICON;
				button.tooltip?.updateText('TTS Settings');
			}
		}

		chunkText(text, maxLength) {
			if (text.length <= maxLength) {
				return [text];
			}

			const chunks = [];
			let currentChunk = '';

			// Split by sentences (periods, exclamations, questions)
			const sentences = text.split(/(?<=[.!?])\s+/);

			for (const sentence of sentences) {
				if ((currentChunk + sentence).length > maxLength) {
					if (currentChunk) {
						chunks.push(currentChunk.trim());
						currentChunk = '';
					}

					// If a single sentence is too long, split it further
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
	}

	const playbackManager = new PlaybackManager();
	//#endregion

	//#region Actor Mode Implementation
	async function attributeDialogueToCharacters(text, characters) {
		return new Promise((resolve, reject) => {
			const requestId = Math.random().toString(36).substr(2, 9);

			const listener = (event) => {
				if (event.data.type === 'tts-analyze-dialogue-response' &&
					event.data.requestId === requestId) {
					window.removeEventListener('message', listener);

					if (event.data.success) {
						resolve(event.data.data);
					} else {
						reject(new Error(event.data.error));
					}
				}
			};

			window.addEventListener('message', listener);

			// Post to MAIN world for processing
			window.postMessage({
				type: 'tts-analyze-dialogue-request',
				text: text,
				characters: characters,
				requestId: requestId
			}, '*');

			// Timeout after 30 seconds
			setTimeout(() => {
				window.removeEventListener('message', listener);
				reject(new Error('Dialogue analysis timed out'));
			}, 30000);
		});
	}

	// Updated playback function that uses actor mode
	async function playText(text, settings, conversationId) {
		// Check if actor mode is enabled for this conversation
		const actorModeResult = await chrome.storage.local.get(`chatActorMode_${conversationId}`);
		const actorModeEnabled = actorModeResult[`chatActorMode_${conversationId}`] === true;

		// Get the voice for this chat (either override or default)
		const voiceResult = await chrome.storage.local.get(`chatVoice_${conversationId}`);
		const voiceOverride = voiceResult[`chatVoice_${conversationId}`] || '';
		const defaultVoiceId = voiceOverride || settings.voice;

		if (!actorModeEnabled) {
			// Actor mode not enabled - use regular voice
			return playbackManager.play(text, defaultVoiceId, settings.model, settings.apiKey);
		}

		// Actor mode is enabled - get character configurations
		const charactersResult = await chrome.storage.local.get(`chatCharacters_${conversationId}`);
		const characters = charactersResult[`chatCharacters_${conversationId}`] || [];

		if (characters.length === 0) {
			// No characters configured - fall back to regular playback
			console.log('Actor mode enabled but no characters configured, using default voice');
			return playbackManager.play(text, defaultVoiceId, settings.model, settings.apiKey);
		}

		try {
			// Start actor mode immediately (stops existing playback and gets session ID)
			await playbackManager.startSession();
			const currentSessionId = playbackManager.currentSessionId;

			console.log('Getting dialogue attribution for actor mode...');

			// Start the attribution request but DON'T await it yet
			const attributionPromise = attributeDialogueToCharacters(text, characters);

			// Check periodically if we've been interrupted while waiting
			const checkInterval = setInterval(() => {
				if (playbackManager.currentSessionId !== currentSessionId) {
					clearInterval(checkInterval);
					console.log('Attribution cancelled - user interrupted');
				}
			}, 100);

			// Now await the attribution
			const segments = await attributionPromise;
			clearInterval(checkInterval);

			// Check if we should still use these results
			if (playbackManager.currentSessionId !== currentSessionId) {
				console.log('Ignoring attribution results - session was interrupted');
				return;
			}

			// Create a voice map
			const voiceMap = {};
			characters.forEach(char => {
				if (char.voice) {
					voiceMap[char.name.toLowerCase()] = char.voice;
				}
			});

			// Merge consecutive segments from the same character
			const mergedSegments = [];
			let currentSegment = null;

			for (const segment of segments) {
				const characterName = segment.character.toLowerCase();

				if (currentSegment && currentSegment.character === characterName) {
					// Same character - merge the text
					currentSegment.text += ' ' + segment.text;
				} else {
					// Different character - save current and start new
					if (currentSegment) {
						mergedSegments.push(currentSegment);
					}
					currentSegment = {
						character: characterName,
						text: segment.text
					};
				}
			}

			// Don't forget the last segment
			if (currentSegment) {
				mergedSegments.push(currentSegment);
			}

			console.log(`Merged ${segments.length} segments into ${mergedSegments.length} segments`);

			// Queue all merged segments
			for (const segment of mergedSegments) {
				const voice = voiceMap[segment.character];

				if (!voice) {
					console.warn(`No voice available for ${segment.character}, skipping segment`);
					continue;
				}

				console.log(`Queueing "${segment.text.substring(0, 50)}..." as ${segment.character} with voice ${voice}`);

				await playbackManager.queue(
					segment.text,
					voice,
					settings.model,
					settings.apiKey
				);
			}

			// Wait for all segments to complete
			await playbackManager.waitForCompletion();

		} catch (error) {
			// Actor mode failed - fall back to regular playback with default voice
			console.error('Actor mode failed, falling back to regular playback:', error);

			// Play the entire text with the default voice
			return playbackManager.play(text, defaultVoiceId, settings.model, settings.apiKey);
		}
	}
	//#endregion

	//#region Message Listener
	let isCapturingText = false;
	let capturedText = null;

	window.addEventListener('message', async (event) => {
		if (event.data.type === 'tts-new-message') {
			const settings = await loadSettings();
			if (settings.enabled && settings.autoSpeak) {
				const { conversationId, text } = event.data;

				// Get quotes-only setting for this chat
				const result = await chrome.storage.local.get(`chatQuotesOnly_${conversationId}`);
				const quotesOnly = result[`chatQuotesOnly_${conversationId}`] === true;

				// Clean up the text
				const messageText = cleanupText(text, quotesOnly);

				if (messageText) {
					console.log("Autoplaying text:", messageText);
					if (settings.apiKey) await playText(messageText, settings, conversationId);
				}
			}
		} else if (event.data.type === 'tts-clipboard-request') {
			const { text, requestId } = event.data;

			if (isCapturingText) {
				// We're capturing - store the text and intercept
				capturedText = text;
				isCapturingText = false;

				window.postMessage({
					type: 'tts-clipboard-response',
					requestId: requestId,
					shouldIntercept: true
				}, '*');
			} else {
				// Normal copy - allow it
				window.postMessage({
					type: 'tts-clipboard-response',
					requestId: requestId,
					shouldIntercept: false
				}, '*');
			}
		}
	});
	//#endregion

	//#region Message Buttons
	function createSpeakButton() {
		const button = createClaudeButton(SPEAKER_ICON, 'icon', async (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Get text from message
			const text = await captureMessageText(button);
			if (!text) {
				alert('Failed to capture message text');
				return;
			}

			// Get settings
			const settings = await loadSettings();
			const conversationId = getConversationId();


			const quotesResult = await chrome.storage.local.get(`chatQuotesOnly_${conversationId}`);
			const quotesOnly = quotesResult[`chatQuotesOnly_${conversationId}`] === true; // Explicitly check for true

			if (!settings.apiKey) {
				alert('Please configure TTS settings first');
				return;
			}

			// Process text with per-chat quotes setting
			const finalText = cleanupText(text, quotesOnly);
			if (!finalText) {
				alert('No text to speak' + (quotesOnly ? ' (no quoted text found)' : ''));
				return;
			}

			// Start playback (will handle stopping existing playback internally)
			try {
				await playText(finalText, settings, conversationId);
			} catch (error) {
				alert('Failed to play audio: ' + error.message);
			}
		});

		// Add additional classes for sizing and identification
		button.classList.add('h-8', 'w-8', 'tts-speak-button');

		createClaudeTooltip(button, 'Read aloud');

		return button;
	}

	function findArtifactButtonsRow() {
		const markdownArtifact = document.querySelector('#markdown-artifact');
		if (!markdownArtifact) return null;

		// Navigate up to find the header bar
		const parentContainer = markdownArtifact.closest('.relative.flex')?.parentElement;
		if (!parentContainer) return null;

		const headerBar = parentContainer.querySelector('.pr-2.pl-3.flex.items-center.justify-between');
		if (!headerBar) return null;

		// Find the container that holds all the button groups (not just the copy button group)
		const buttonsContainer = headerBar.querySelector('.flex.gap-2.items-center.text-sm');
		return buttonsContainer;
	}

	function createArtifactSpeakButton() {
		// Create a container div like the Copy button has
		const container = document.createElement('div');
		container.className = 'flex h-8 whitespace-nowrap';

		const button = document.createElement('button');
		button.className = 'font-base-bold !text-xs rounded-lg bg-bg-000 h-full flex items-center justify-center px-2 border border-border-300 hover:bg-bg-200 tts-artifact-speak-button';
		button.innerHTML = `<div class="relative"><div class="">Speak</div></div>`;

		button.onclick = async (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Find the Copy button specifically
			const buttonsRow = findArtifactButtonsRow();
			const allButtons = buttonsRow?.querySelectorAll('.flex.h-8.whitespace-nowrap button');
			const copyButton = Array.from(allButtons || []).find(btn =>
				!btn.classList.contains('tts-artifact-speak-button')
			);

			if (!copyButton) {
				alert('Could not find copy button');
				return;
			}

			// Rest of the code remains the same...
			isCapturingText = true;
			capturedText = null;

			copyButton.click();

			await new Promise(resolve => setTimeout(resolve, 100));

			isCapturingText = false;

			if (!capturedText) {
				alert('Failed to capture artifact text');
				return;
			}

			const settings = await loadSettings();
			const conversationId = getConversationId();


			const quotesResult = await chrome.storage.local.get(`chatQuotesOnly_${conversationId}`);
			const quotesOnly = quotesResult[`chatQuotesOnly_${conversationId}`] === true;

			if (!settings.apiKey) {
				alert('Please configure TTS settings first');
				return;
			}

			const finalText = cleanupText(capturedText, quotesOnly);
			if (!finalText) {
				alert('No text to speak' + (quotesOnly ? ' (no quoted text found)' : ''));
				return;
			}

			try {
				await playText(finalText, settings, conversationId);
			} catch (error) {
				alert('Failed to play audio: ' + error.message);
			}
		};

		container.appendChild(button);
		return container;
	}

	async function captureMessageText(button) {
		const controls = button.closest('.justify-between');
		const copyButton = controls?.querySelector('[data-testid="action-bar-copy"]');

		if (!copyButton) {
			console.error('Could not find copy button');
			return null;
		}

		// Set capture flag
		isCapturingText = true;
		capturedText = null;

		// Click copy button - this will trigger our interceptor
		copyButton.click();

		// Wait for clipboard interception to complete
		await new Promise(resolve => setTimeout(resolve, 100));

		// Reset flag in case it didn't get caught
		isCapturingText = false;

		return capturedText;
	}

	function cleanupText(text, quotesOnly = false) {
		// Remove triple-backtick code blocks
		text = text.replace(/```[\s\S]*?```/g, '');
		// Remove lines that are indented with 4+ spaces (markdown code blocks)
		text = text.split('\n')
			.filter(line => !line.match(/^    /))
			.join('\n');
		// Clean up multiple newlines
		text = text.replace(/\n{3,}/g, '\n\n').trim();
		// Clean up symbols
		text = text.replace("*", "").replace("_", "").replace("#", "").trim();

		if (quotesOnly) {
			const quotes = text.match(/"([^"]*)"/g);
			if (!quotes) return '';
			return quotes.map(q => q.slice(1, -1)).join(". ");
		}
		return text;
	}

	async function addSpeakButtons() {
		const settings = await loadSettings();
		if (!settings.enabled) return;
		addMessageButtonWithPriority(createSpeakButton, 'tts-speak-button');

		// Handle artifact buttons
		const buttonsRow = findArtifactButtonsRow();

		if (buttonsRow) {
			// Artifact exists - add button if not present
			if (!buttonsRow.querySelector('.tts-artifact-speak-button')) {
				const speakButtonContainer = createArtifactSpeakButton();
				buttonsRow.insertBefore(speakButtonContainer, buttonsRow.firstChild);
			}
		} else {
			// No artifact found - remove any existing artifact speak buttons
			const existingArtifactButtons = document.querySelectorAll('.tts-artifact-speak-button');
			existingArtifactButtons.forEach(btn => {
				// Remove the container div that wraps the button
				const container = btn.closest('.flex.h-8.whitespace-nowrap');
				if (container) {
					container.remove();
				} else {
					btn.remove();
				}
			});
		}
	}

	function removeAllSpeakButtons() {
		// Remove all speak buttons (both types)
		const buttons = document.querySelectorAll('.tts-speak-button, .tts-artifact-speak-button');
		buttons.forEach(btn => btn.remove());
	}
	//#endregion

	//#region Settings Modal
	async function createSettingsModal() {
		const settings = await loadSettings();
		const conversationId = getConversationId();

		// Load per-chat settings
		const quotesResult = await chrome.storage.local.get(`chatQuotesOnly_${conversationId}`);
		const chatQuotesOnly = quotesResult[`chatQuotesOnly_${conversationId}`] === true;

		const voiceResult = await chrome.storage.local.get(`chatVoice_${conversationId}`);
		const chatVoiceOverride = voiceResult[`chatVoice_${conversationId}`] || '';

		const actorResult = await chrome.storage.local.get(`chatActorMode_${conversationId}`);
		const actorModeEnabled = actorResult[`chatActorMode_${conversationId}`] === true;

		// Build content
		const content = document.createElement('div');

		// Enable TTS toggle
		const enableSection = document.createElement('div');
		enableSection.className = 'mb-4';
		const enabledToggle = createClaudeToggle('Enable TTS', settings.enabled, null);
		enableSection.appendChild(enabledToggle.container);
		content.appendChild(enableSection);

		// API Key input
		const apiKeySection = document.createElement('div');
		apiKeySection.className = 'mb-4';
		const apiKeyLabel = document.createElement('label');
		apiKeyLabel.className = CLAUDE_CLASSES.LABEL;
		apiKeyLabel.textContent = 'ElevenLabs API Key';
		apiKeySection.appendChild(apiKeyLabel);
		const apiKeyInput = createClaudeInput({
			type: 'password',
			value: settings.apiKey || '',
			placeholder: 'Enter your API key'
		});
		apiKeyInput.id = 'apiKeyInput';
		apiKeySection.appendChild(apiKeyInput);
		content.appendChild(apiKeySection);

		// Voice select
		const voiceSection = document.createElement('div');
		voiceSection.className = 'mb-4';
		const voiceLabel = document.createElement('label');
		voiceLabel.className = CLAUDE_CLASSES.LABEL;
		voiceLabel.textContent = 'Voice';
		voiceSection.appendChild(voiceLabel);
		const voiceSelect = createClaudeSelect(
			[{ value: '', label: 'Set an API key...' }],
			settings.voice || ''
		);
		voiceSelect.id = 'voiceSelect';
		voiceSelect.disabled = !settings.apiKey;
		voiceSection.appendChild(voiceSelect);
		content.appendChild(voiceSection);

		// Model select
		const modelSection = document.createElement('div');
		modelSection.className = 'mb-4';
		const modelLabel = document.createElement('label');
		modelLabel.className = CLAUDE_CLASSES.LABEL;
		modelLabel.textContent = 'Model';
		modelSection.appendChild(modelLabel);
		const modelSelect = createClaudeSelect(
			[{ value: '', label: 'Set an API key...' }],
			settings.model || ''
		);
		modelSelect.id = 'modelSelect';
		modelSelect.disabled = !settings.apiKey;
		modelSection.appendChild(modelSelect);
		content.appendChild(modelSection);

		// Auto-speak toggle
		const autoSpeakSection = document.createElement('div');
		autoSpeakSection.className = 'mb-4';
		const autoSpeakToggle = createClaudeToggle('Auto-speak new messages', settings.autoSpeak, null);
		autoSpeakSection.appendChild(autoSpeakToggle.container);
		content.appendChild(autoSpeakSection);

		// Per-Chat Settings Section
		const perChatSection = document.createElement('div');
		perChatSection.className = 'border-t border-border-300 pt-4 mt-4';

		const perChatHeading = document.createElement('h4');
		perChatHeading.className = 'text-sm font-semibold text-text-200 mb-3';
		perChatHeading.textContent = 'Per-Chat Settings';
		perChatSection.appendChild(perChatHeading);

		// Quotes only toggle
		const quotesSection = document.createElement('div');
		quotesSection.className = 'mb-4';
		const quotesOnlyToggle = createClaudeToggle('Only speak quoted text', chatQuotesOnly, null);
		quotesSection.appendChild(quotesOnlyToggle.container);
		perChatSection.appendChild(quotesSection);

		// Voice override select
		const overrideSection = document.createElement('div');
		overrideSection.className = 'mb-4';
		const overrideLabel = document.createElement('label');
		overrideLabel.className = CLAUDE_CLASSES.LABEL;
		overrideLabel.textContent = 'Voice Override';
		overrideSection.appendChild(overrideLabel);
		const chatVoiceOverrideSelect = createClaudeSelect(
			[{ value: '', label: 'Use default voice' }],
			chatVoiceOverride
		);
		chatVoiceOverrideSelect.id = 'chatVoiceOverride';
		chatVoiceOverrideSelect.disabled = !settings.apiKey;
		overrideSection.appendChild(chatVoiceOverrideSelect);
		perChatSection.appendChild(overrideSection);

		// Actor mode section
		const actorSection = document.createElement('div');
		actorSection.className = 'mb-4';
		const actorContainer = document.createElement('div');
		actorContainer.className = 'flex items-center justify-between';

		const actorToggleContainer = document.createElement('div');
		actorToggleContainer.className = 'flex-1';
		const actorModeToggle = createClaudeToggle('Actor mode', actorModeEnabled, null);
		actorToggleContainer.appendChild(actorModeToggle.container);
		actorContainer.appendChild(actorToggleContainer);

		const configureActorsBtn = createClaudeButton('Configure Characters', 'secondary');
		configureActorsBtn.id = 'configureActorsBtn';
		configureActorsBtn.style.display = actorModeEnabled ? 'block' : 'none';
		configureActorsBtn.classList.add('ml-2');
		actorContainer.appendChild(configureActorsBtn);

		actorSection.appendChild(actorContainer);
		perChatSection.appendChild(actorSection);

		content.appendChild(perChatSection);

		// Create modal with buttons
		const modal = createClaudeModal({
			title: 'TTS Settings',
			content: content,
			confirmText: 'Save',
			cancelText: 'Cancel',
			onConfirm: async () => {
				const newSettings = {
					enabled: enabledToggle.input.checked,
					apiKey: apiKeyInput.value.trim(),
					voice: voiceSelect.value,
					model: modelSelect.value,
					autoSpeak: autoSpeakToggle.input.checked
				};

				// Handle per-chat settings - always save the state, don't remove
				if (conversationId) {
					await chrome.storage.local.set({
						[`chatQuotesOnly_${conversationId}`]: quotesOnlyToggle.input.checked
					});

					const chatOverride = chatVoiceOverrideSelect.value;
					if (chatOverride) {
						await chrome.storage.local.set({ [`chatVoice_${conversationId}`]: chatOverride });
					} else {
						await chrome.storage.local.remove(`chatVoice_${conversationId}`);
					}

					await chrome.storage.local.set({
						[`chatActorMode_${conversationId}`]: actorModeToggle.input.checked
					});
				}

				await saveSettings(newSettings);

				// Update button visibility based on enabled state
				if (!newSettings.enabled) {
					removeAllSpeakButtons();
				}
			},
			onCancel: () => {
				// Just closes modal
			}
		});

		// Handle actor mode toggle
		actorModeToggle.input.addEventListener('change', (e) => {
			configureActorsBtn.style.display = e.target.checked ? 'block' : 'none';
		});

		// Configure actors button
		configureActorsBtn.onclick = async () => {
			const currentApiKey = apiKeyInput.value.trim();
			await createActorConfigModal(currentApiKey || settings.apiKey);
		};

		// Load and populate voices/models if API key exists
		if (settings.apiKey) {
			const [voices, models] = await Promise.all([
				getVoices(settings.apiKey),
				getModels(settings.apiKey)
			]);

			// Populate voice selects
			const voiceOptions = voices.map(v => ({ value: v.voice_id, label: `${v.name} (${v.voice_id})` }));
			populateSelect(voiceSelect, voiceOptions, settings.voice);

			// Populate chat override with "Use default" option
			chatVoiceOverrideSelect.innerHTML = '<option value="">Use default voice</option>';
			voiceOptions.forEach(opt => {
				const option = document.createElement('option');
				option.value = opt.value;
				option.textContent = opt.label;
				chatVoiceOverrideSelect.appendChild(option);
			});
			chatVoiceOverrideSelect.value = chatVoiceOverride;
			chatVoiceOverrideSelect.disabled = false;

			// Populate models
			const modelOptions = models.map(m => ({ value: m.model_id, label: m.name }));
			populateSelect(modelSelect, modelOptions, settings.model);
		}

		// Handle API key changes
		apiKeyInput.addEventListener('change', async (e) => {
			const newKey = e.target.value.trim();
			if (newKey) {
				const isValid = await testApiKey(newKey);
				if (isValid) {
					const [voices, models] = await Promise.all([
						getVoices(newKey),
						getModels(newKey)
					]);

					const voiceOptions = voices.map(v => ({ value: v.voice_id, label: `${v.name} (${v.voice_id})` }));
					populateSelect(voiceSelect, voiceOptions);

					chatVoiceOverrideSelect.innerHTML = '<option value="">Use default voice</option>';
					voiceOptions.forEach(opt => {
						const option = document.createElement('option');
						option.value = opt.value;
						option.textContent = opt.label;
						chatVoiceOverrideSelect.appendChild(option);
					});
					chatVoiceOverrideSelect.disabled = voiceOptions.length === 0;

					const modelOptions = models.map(m => ({ value: m.model_id, label: m.name }));
					populateSelect(modelSelect, modelOptions);
				} else {
					alert('Invalid ElevenLabs API key');
					e.target.value = settings.apiKey || '';
				}
			}
		});

		document.body.appendChild(modal);
		return modal;
	}

	async function createActorConfigModal(apiKey) {
		const conversationId = getConversationId();
		const charactersResult = await chrome.storage.local.get(`chatCharacters_${conversationId}`);
		let characters = charactersResult[`chatCharacters_${conversationId}`] || [];

		// Ensure narrator exists in the characters list
		if (!characters.find(c => c.name.toLowerCase() === 'narrator')) {
			characters = [{ name: 'Narrator', gender: 'other', voice: '' }, ...characters];
		}

		// Load available voices
		const voices = await getVoices(apiKey);
		const voiceOptions = [
			{ value: '', label: 'None' },
			...voices.map(v => ({ value: v.voice_id, label: `${v.name} (${v.voice_id})` }))
		];

		// Create modal content
		const contentContainer = document.createElement('div');

		// Characters section
		const charactersSection = document.createElement('div');
		charactersSection.className = 'mb-4';

		const headerDiv = document.createElement('div');
		headerDiv.className = 'flex items-center justify-between mb-3';

		const instructionText = document.createElement('p');
		instructionText.className = 'text-sm text-text-300';
		instructionText.textContent = 'Assign voices to character names. If a voice is "None", that character\'s dialog will not be spoken.';
		headerDiv.appendChild(instructionText);

		// Control buttons
		const controlButtons = document.createElement('div');
		controlButtons.className = 'flex justify-end gap-2 mb-3';

		const addBtn = createClaudeButton(
			'<span class="flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke-linecap="round"/></svg>Add Character</span>',
			'secondary',
			null,
			true
		);
		addBtn.id = 'addCharacterBtn';

		const removeBtn = createClaudeButton(
			'<span class="flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 16 16"><path d="M3 8h10" stroke-linecap="round"/></svg>Remove Last</span>',
			'secondary',
			null,
			true
		);
		removeBtn.id = 'removeCharacterBtn';

		controlButtons.appendChild(addBtn);
		controlButtons.appendChild(removeBtn);

		// Table container
		const tableContainer = document.createElement('div');
		tableContainer.className = 'border border-border-300 rounded-lg overflow-hidden';

		// Table header
		const tableHeader = document.createElement('div');
		tableHeader.className = 'grid grid-cols-3 gap-4 p-3 bg-bg-100 border-b border-border-300 font-medium text-sm';
		tableHeader.innerHTML = '<div>Character Name</div><div>Gender</div><div>Voice</div>';

		// Characters list container
		const charactersList = document.createElement('div');
		charactersList.id = 'charactersList';
		charactersList.className = 'max-h-96 overflow-y-auto';

		tableContainer.appendChild(tableHeader);
		tableContainer.appendChild(charactersList);

		const tipText = document.createElement('div');
		tipText.className = 'mt-3 text-xs text-text-400';
		tipText.textContent = 'Tip: Set Narrator to "None" to only speak dialogue. Set it to a voice to include narration.';

		charactersSection.appendChild(headerDiv);
		charactersSection.appendChild(controlButtons);

		// Add warning if voices couldn't load
		if (voices.length === 0 && apiKey) {
			const warningDiv = document.createElement('div');
			warningDiv.className = 'mb-3 p-2 bg-accent-100 border border-accent-200 rounded text-sm text-accent-600';
			warningDiv.textContent = 'Could not load voices. Please check your ElevenLabs API key.';
			charactersSection.appendChild(warningDiv);
		}

		charactersSection.appendChild(tableContainer);
		charactersSection.appendChild(tipText);

		contentContainer.appendChild(charactersSection);

		// Function to create a character row
		function createCharacterRow(character = {}, isNarrator = false) {
			const row = document.createElement('div');
			row.className = 'grid grid-cols-3 gap-4 p-3 border-b border-border-200 character-row hover:bg-bg-50';
			if (isNarrator) {
				row.classList.add('narrator-row', 'bg-bg-50');
			}

			const nameInput = createClaudeInput({
				type: 'text',
				placeholder: 'e.g., Alice',
				value: character.name || ''
			});
			nameInput.classList.add('character-name');
			if (isNarrator) {
				nameInput.disabled = true;
				nameInput.className += ' opacity-60';
			}

			const genderOptions = [
				{ value: 'male', label: 'Male' },
				{ value: 'female', label: 'Female' },
				{ value: 'other', label: 'Other' }
			];
			const genderSelect = createClaudeSelect(genderOptions, character.gender || 'male');
			genderSelect.classList.add('character-gender');
			if (isNarrator) {
				genderSelect.disabled = true;
				genderSelect.className += ' opacity-60';
			}

			const voiceSelect = createClaudeSelect(voiceOptions, character.voice || '');
			voiceSelect.classList.add('character-voice');

			row.appendChild(nameInput);
			row.appendChild(genderSelect);
			row.appendChild(voiceSelect);

			return row;
		}

		// Populate existing characters
		// Always add Narrator first
		const narratorChar = characters.find(c => c.name.toLowerCase() === 'narrator') ||
			{ name: 'Narrator', gender: 'other', voice: '' };
		charactersList.appendChild(createCharacterRow(narratorChar, true));

		// Add other characters
		characters.filter(c => c.name.toLowerCase() !== 'narrator').forEach(character => {
			charactersList.appendChild(createCharacterRow(character, false));
		});

		// If no non-narrator characters, add one empty row
		if (characters.filter(c => c.name.toLowerCase() !== 'narrator').length === 0) {
			charactersList.appendChild(createCharacterRow());
		}

		// Add character button
		addBtn.onclick = () => {
			charactersList.appendChild(createCharacterRow());
		};

		// Remove character button - never remove narrator
		removeBtn.onclick = () => {
			const rows = charactersList.querySelectorAll('.character-row:not(.narrator-row)');
			if (rows.length > 1) {
				rows[rows.length - 1].remove();
			} else if (rows.length === 1) {
				// If only one non-narrator row, clear it instead of removing
				rows[0].querySelector('.character-name').value = '';
				rows[0].querySelector('.character-gender').value = 'male';
				rows[0].querySelector('.character-voice').value = '';
			}
		};

		// Create the modal with the custom content
		const modal = createClaudeModal({
			title: 'Character Voice Configuration',
			content: contentContainer,
			confirmText: 'Save',
			cancelText: 'Cancel',
			onConfirm: async () => {
				// Collect character data - always include narrator
				const characterRows = charactersList.querySelectorAll('.character-row');
				const charactersData = Array.from(characterRows)
					.map(row => ({
						name: row.querySelector('.character-name').value.trim(),
						gender: row.querySelector('.character-gender').value,
						voice: row.querySelector('.character-voice').value
					}))
					.filter(char => char.name);

				if (charactersData.length > 0) {
					await chrome.storage.local.set({ [`chatCharacters_${conversationId}`]: charactersData });
				}
			},
			onCancel: () => {
				// Modal removes itself
			}
		});

		// Adjust modal max width
		const modalContent = modal.querySelector('.' + CLAUDE_CLASSES.MODAL_CONTAINER.split(' ').join('.'));
		if (modalContent) {
			modalContent.style.maxWidth = '700px';
			modalContent.style.width = '90%';
		}

		document.body.appendChild(modal);
		return modal;
	}

	async function getVoices(apiKey) {
		if (!apiKey) {
			return [];
		}

		const allVoices = [];
		let hasMore = true;
		let nextPageToken = null;

		try {
			while (hasMore) {
				// Build URL with pagination
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
					return allVoices; // Return what we have so far
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

			// Sort voices alphabetically by name for consistent ordering
			allVoices.sort((a, b) => a.name.localeCompare(b.name));

			return allVoices;

		} catch (error) {
			console.error('Error fetching voices:', error);
			return allVoices; // Return what we have so far
		}
	}

	async function getModels(apiKey) {
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
			// Return fallback models
			return [{
				model_id: 'eleven_multilingual_v2',
				name: 'Multilingual v2',
				can_do_text_to_speech: true
			}];
		}
	}

	// Simple UI population function
	function populateSelect(selectElement, options, currentValue = '') {
		selectElement.innerHTML = '';

		if (options.length === 0) {
			selectElement.innerHTML = '<option value="">None available</option>';
			selectElement.disabled = true;
			return;
		}

		options.forEach(option => {
			const optionElement = document.createElement('option');
			optionElement.value = option.value;
			optionElement.textContent = option.label;
			selectElement.appendChild(optionElement);
		});

		selectElement.disabled = false;
		selectElement.value = currentValue || options[0]?.value || '';
	}

	async function testApiKey(apiKey) {
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

	async function loadSettings() {
		const result = await chrome.storage.local.get([
			'tts_enabled',
			'tts_apiKey',
			'tts_voice',
			'tts_model',
			'tts_autoSpeak'
		]);

		return {
			enabled: result.tts_enabled || false,
			apiKey: result.tts_apiKey || '',
			voice: result.tts_voice || '',
			model: result.tts_model || 'eleven_multilingual_v2',
			autoSpeak: result.tts_autoSpeak || false
		};
	}

	async function saveSettings(settings) {
		await chrome.storage.local.set({
			'tts_enabled': settings.enabled,
			'tts_apiKey': settings.apiKey,
			'tts_voice': settings.voice,
			'tts_model': settings.model,
			'tts_autoSpeak': settings.autoSpeak
		});
	}

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}
	//#endregion

	//#region Settings Button
	function createSettingsButton() {
		const button = createClaudeButton(SPEAKER_ICON, 'icon', async () => {
			if (playbackManager.isActive()) {
				playbackManager.stop();
			} else {
				await createSettingsModal();
			}
		});

		button.classList.add('tts-settings-button'); // Keep for identification/priority

		const tooltip = createClaudeTooltip(button, 'TTS Settings');

		return button;
	}
	//#endregion

	//#region Initialization
	let currentUrl = window.location.href;

	setInterval(() => {
		if (window.location.href !== currentUrl) {
			currentUrl = window.location.href;
			// Stop playback on navigation
			if (playbackManager.isActive()) {
				playbackManager.stop();
			}
		}
	}, 100);

	function addTTSStyles() {
		if (document.querySelector('#tts-styles')) return;

		const style = document.createElement('style');
		style.id = 'tts-styles';
		style.textContent = `
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .spinner-segment {
            animation: spin 1s linear infinite;
        }
        .tts-settings-button:hover .pause-icon {
            fill: #2573c4 !important;
        }
        .tts-settings-button .pause-icon {
            transition: fill 0.2s ease;
        }
    `;
		document.head.appendChild(style);
	}

	function initialize() {
		addTTSStyles();
		// Try to add the settings button immediately
		tryAddTopRightButton("tts-settings-button", createSettingsButton);
		setInterval(() => tryAddTopRightButton('tts-settings-button', createSettingsButton), 1000);
		setInterval(addSpeakButtons, 1000);
	}

	// Wait for DOM to be ready before initializing
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		// DOM is already ready
		initialize();
	}
	//#endregion
})();