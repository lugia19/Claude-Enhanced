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
		}

		async play(text, voiceId, modelId, apiKey) {
			// Always stop any existing playback first and wait for cleanup
			await this.stop();

			// Generate new session ID
			const sessionId = Date.now() + '_' + Math.random();
			this.currentSessionId = sessionId;

			// Set loading state
			this.state = 'loading';
			this.updateSettingsButton();

			try {
				// Create fresh AudioContext for this session
				this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

				// Chunk the text
				const chunks = this.chunkText(text, 9000);
				console.log(`[Session ${sessionId}] Split text into ${chunks.length} chunks`);

				// Play chunks sequentially
				for (let i = 0; i < chunks.length; i++) {
					// Check if this session is still valid
					if (this.currentSessionId !== sessionId) {
						console.log(`[Session ${sessionId}] Aborted - new session started`);
						return;
					}

					console.log(`[Session ${sessionId}] Streaming chunk ${i + 1}/${chunks.length}`);
					await this.streamChunk(chunks[i], voiceId, modelId, apiKey, sessionId);
				}

				// Wait for all scheduled audio to finish
				if (this.currentSessionId === sessionId && this.scheduledEndTime > 0) {
					const remainingTime = this.scheduledEndTime - this.audioContext.currentTime;
					if (remainingTime > 0) {
						console.log(`[Session ${sessionId}] Waiting ${remainingTime.toFixed(2)}s for playback to complete`);
						await new Promise(resolve => setTimeout(resolve, remainingTime * 1000 + 100));
					}
				}

			} catch (error) {
				console.error(`[Session ${sessionId}] Playback error:`, error);
				throw error;
			} finally {
				// Only clean up if this is still the current session
				if (this.currentSessionId === sessionId) {
					this.state = 'idle';
					this.currentSessionId = null;
					this.updateSettingsButton();
					this.cleanupAudioContext();
				}
			}
		}

		async streamChunk(text, voiceId, modelId, apiKey, sessionId) {
			return new Promise(async (resolve, reject) => {
				try {
					// Verify session is still valid
					if (this.currentSessionId !== sessionId) {
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
							resolve();
							return;
						}

						const { done, value } = await reader.read();
						if (done) break;

						// Update state on first audio chunk
						if (firstChunk && this.state === 'loading') {
							this.state = 'playing';
							this.updateSettingsButton();
							firstChunk = false;
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
					if (error.name === 'AbortError') {
						console.log(`[Session ${sessionId}] Fetch aborted`);
						resolve();
					} else {
						reject(error);
					}
				}
			});
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
				console.log(`[Session ${sessionId}] Source ended naturally, ${this.activeSources.length} remaining`);
			};

			console.log(`[Session ${sessionId}] Registered source, ${this.activeSources.length} active`);
		}

		async stop() {
			if (this.state === 'idle') {
				return;
			}

			console.log('Stopping playback, state:', this.state);

			// Set stopping state to prevent new operations
			this.state = 'stopping';
			this.updateSettingsButton();

			// Invalidate current session
			const oldSessionId = this.currentSessionId;
			this.currentSessionId = null;

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

			// Clean up audio context
			this.cleanupAudioContext();

			// Reset to idle state
			this.state = 'idle';
			this.updateSettingsButton();

			console.log(`Playback stopped${oldSessionId ? ` (was session ${oldSessionId})` : ''}`);
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
			return this.state !== 'idle';
		}

		updateSettingsButton() {
			const button = document.querySelector('.tts-settings-button');
			if (!button) return;

			const tooltip = document.querySelector('.tts-settings-tooltip');

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
				if (tooltip) {
					const text = this.state === 'loading' ? 'Loading audio...' : 'Stopping...';
					tooltip.querySelector('.tooltip-content').textContent = text;
				}
			} else if (this.state === 'playing') {
				button.innerHTML = PAUSE_ICON;
				if (tooltip) {
					tooltip.querySelector('.tooltip-content').textContent = 'Stop playback';
				}
			} else {
				button.innerHTML = SPEAKER_ICON;
				if (tooltip) {
					tooltip.querySelector('.tooltip-content').textContent = 'TTS Settings';
				}
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
				const quotesOnly = result[`chatQuotesOnly_${conversationId}`] || false;

				// Clean up the text
				const messageText = cleanupText(text, quotesOnly);

				if (messageText) {
					// Get voice settings
					const voiceResult = await chrome.storage.local.get(`chatVoice_${conversationId}`);
					const voiceOverride = voiceResult[`chatVoice_${conversationId}`] || '';
					const voiceId = voiceOverride || settings.voice;
					console.log("Autoplaying text:", messageText);
					if (settings.apiKey && voiceId) {
						// Small delay to let UI settle
						setTimeout(() => {
							playbackManager.play(messageText, voiceId, settings.model, settings.apiKey)
								.catch(err => console.error('Auto-speak failed:', err));
						}, 100);
					}
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
	function findMessageControls(messageElement) {
		const group = messageElement.closest('.group');
		const buttons = group?.querySelectorAll('button');
		if (!buttons) return null;
		const retryButton = Array.from(buttons).find(button =>
			button.textContent.includes('Retry')
		);
		return retryButton?.closest('.justify-between');
	}

	function createSpeakButton() {
		const button = document.createElement('button');
		button.className = 'claude-icon-btn h-8 w-8 tts-speak-button';
		button.innerHTML = SPEAKER_ICON;

		applyClaudeStyling(button);
		createClaudeTooltip(button, 'Read aloud');

		button.onclick = async (e) => {
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

			const voiceResult = await chrome.storage.local.get(`chatVoice_${conversationId}`);
			const voiceOverride = voiceResult[`chatVoice_${conversationId}`] || '';
			const voiceId = voiceOverride || settings.voice;

			const quotesResult = await chrome.storage.local.get(`chatQuotesOnly_${conversationId}`);
			const quotesOnly = quotesResult[`chatQuotesOnly_${conversationId}`] || false;

			if (!settings.apiKey || !voiceId) {
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
				await playbackManager.play(finalText, voiceId, settings.model, settings.apiKey);
			} catch (error) {
				alert('Failed to play audio: ' + error.message);
			}
		};

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

			const voiceResult = await chrome.storage.local.get(`chatVoice_${conversationId}`);
			const voiceOverride = voiceResult[`chatVoice_${conversationId}`] || '';
			const voiceId = voiceOverride || settings.voice;

			const quotesResult = await chrome.storage.local.get(`chatQuotesOnly_${conversationId}`);
			const quotesOnly = quotesResult[`chatQuotesOnly_${conversationId}`] || false;

			if (!settings.apiKey || !voiceId) {
				alert('Please configure TTS settings first');
				return;
			}

			const finalText = cleanupText(capturedText, quotesOnly);
			if (!finalText) {
				alert('No text to speak' + (quotesOnly ? ' (no quoted text found)' : ''));
				return;
			}

			try {
				await playbackManager.play(finalText, voiceId, settings.model, settings.apiKey);
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

		// Handle regular message buttons (existing code)
		const messages = document.querySelectorAll('.font-claude-response');
		messages.forEach((message) => {
			const controls = findMessageControls(message);
			if (controls && !controls.querySelector('.tts-speak-button')) {
				const speakBtn = createSpeakButton();
				addMessageButtonWithPriority(controls, speakBtn, 'tts-speak-button');
			}
		});

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
		const modal = document.createElement('div');
		modal.className = 'claude-modal-backdrop';

		const settings = await loadSettings();
		const conversationId = getConversationId();

		// Load per-chat settings
		const quotesResult = await chrome.storage.local.get(`chatQuotesOnly_${conversationId}`);
		const chatQuotesOnly = quotesResult[`chatQuotesOnly_${conversationId}`] || false;

		modal.innerHTML = `
        <div class="claude-modal">
            <h3 class="claude-modal-heading">TTS Settings</h3>
            
            <div class="mb-4">
                <div id="enabledToggleContainer"></div>
            </div>

            <div class="mb-4">
                <label class="claude-label">ElevenLabs API Key</label>
                <input type="password" class="claude-input" id="apiKeyInput" 
                       value="${settings.apiKey || ''}" 
                       placeholder="Enter your API key">
            </div>

            <div class="mb-4">
                <label class="claude-label">Voice</label>
                <select class="claude-select" id="voiceSelect" ${!settings.apiKey ? 'disabled' : ''}>
                    <option value="">Set an API key...</option>
                </select>
            </div>

            <div class="mb-4">
                <label class="claude-label">Model</label>
                <select class="claude-select" id="modelSelect" ${!settings.apiKey ? 'disabled' : ''}>
                    <option value="">Set an API key...</option>
                </select>
            </div>

            <div class="mb-4">
                <div id="autoSpeakToggleContainer"></div>
            </div>

            <!-- Per-Chat Settings Section -->
            <div class="border-t border-border-300 pt-4 mt-4">
                <h4 class="text-sm font-semibold text-text-200 mb-3">Per-Chat Settings</h4>
                
                <div class="mb-4">
                    <div id="quotesOnlyToggleContainer"></div>
                </div>

                <div class="mb-4">
                    <label class="claude-label">Voice Override</label>
                    <select class="claude-select" id="chatVoiceOverride" ${!settings.apiKey ? 'disabled' : ''}>
                        <option value="">Use default voice</option>
                    </select>
                </div>
            </div>

            <div class="flex justify-end gap-2">
                <button class="claude-btn-secondary" id="cancelSettings">Cancel</button>
                <button class="claude-btn-primary" id="saveSettings">Save</button>
            </div>
        </div>
    `;

		document.body.appendChild(modal);

		// Apply styling
		applyClaudeStyling(modal);

		// Add toggles
		const enabledToggle = createClaudeToggle('Enable TTS', settings.enabled, null);
		modal.querySelector('#enabledToggleContainer').appendChild(enabledToggle.container);

		const autoSpeakToggle = createClaudeToggle('Auto-speak new messages', settings.autoSpeak, null);
		modal.querySelector('#autoSpeakToggleContainer').appendChild(autoSpeakToggle.container);

		const quotesOnlyToggle = createClaudeToggle('Only speak quoted text', chatQuotesOnly, null);
		modal.querySelector('#quotesOnlyToggleContainer').appendChild(quotesOnlyToggle.container);

		// Load voices and models if API key exists
		if (settings.apiKey) {
			await Promise.all([
				loadVoices(modal, settings),
				loadModels(modal, settings)
			]);
		}

		// Handle API key changes
		modal.querySelector('#apiKeyInput').addEventListener('change', async (e) => {
			const newKey = e.target.value.trim();
			if (newKey) {
				// Test the API key
				const isValid = await testApiKey(newKey);
				if (isValid) {
					await Promise.all([
						loadVoices(modal, { ...settings, apiKey: newKey }),
						loadModels(modal, { ...settings, apiKey: newKey })
					]);
				} else {
					alert('Invalid ElevenLabs API key');
					e.target.value = settings.apiKey || '';
				}
			}
		});

		// Save button
		modal.querySelector('#saveSettings').onclick = async () => {
			const newSettings = {
				enabled: enabledToggle.input.checked,
				apiKey: modal.querySelector('#apiKeyInput').value.trim(),
				voice: modal.querySelector('#voiceSelect').value,
				model: modal.querySelector('#modelSelect').value,
				autoSpeak: autoSpeakToggle.input.checked
			};

			// Handle per-chat settings
			if (conversationId) {
				// Save quotes-only setting
				if (quotesOnlyToggle.input.checked) {
					await chrome.storage.local.set({ [`chatQuotesOnly_${conversationId}`]: true });
				} else {
					await chrome.storage.local.remove(`chatQuotesOnly_${conversationId}`);
				}

				// Save voice override
				const chatOverride = modal.querySelector('#chatVoiceOverride').value;
				if (chatOverride) {
					await chrome.storage.local.set({ [`chatVoice_${conversationId}`]: chatOverride });
				} else {
					await chrome.storage.local.remove(`chatVoice_${conversationId}`);
				}
			}

			await saveSettings(newSettings);
			modal.remove();

			// Update button visibility based on enabled state
			if (!newSettings.enabled) {
				removeAllSpeakButtons();
			}
		};

		// Cancel button
		modal.querySelector('#cancelSettings').onclick = () => {
			modal.remove();
		};

		// Click backdrop to close
		modal.onclick = (e) => {
			if (e.target === modal) {
				modal.remove();
			}
		};

		return modal;
	}

	async function loadVoices(modal, settings) {
		const voiceSelect = modal.querySelector('#voiceSelect');
		const chatOverrideSelect = modal.querySelector('#chatVoiceOverride');

		try {
			// Use the new search endpoint with pagination
			const response = await fetch('https://api.elevenlabs.io/v1/voices?page_size=100', {
				headers: {
					'xi-api-key': settings.apiKey
				}
			});

			if (!response.ok) {
				throw new Error('Failed to fetch voices');
			}

			const data = await response.json();
			const voices = data.voices;

			// Clear and populate voice selects
			voiceSelect.innerHTML = '';
			chatOverrideSelect.innerHTML = '<option value="">Use default voice</option>';

			voices.forEach(voice => {
				const option = new Option(`${voice.name} (${voice.voice_id})`, voice.voice_id);
				voiceSelect.add(option.cloneNode(true));
				chatOverrideSelect.add(option.cloneNode(true));
			});

			// Set selected values
			voiceSelect.value = settings.voice || (voices[0]?.voice_id || '');

			// Set chat override if exists
			const conversationId = getConversationId();
			if (conversationId) {
				const result = await chrome.storage.local.get(`chatVoice_${conversationId}`);
				const override = result[`chatVoice_${conversationId}`] || '';
				chatOverrideSelect.value = override;
			}

			// Enable selects
			voiceSelect.disabled = false;
			chatOverrideSelect.disabled = false;

		} catch (error) {
			alert('Failed to load voices from ElevenLabs');
			console.error('Voice loading error:', error);
		}
	}

	async function loadModels(modal, settings) {
		const modelSelect = modal.querySelector('#modelSelect');

		try {
			const response = await fetch('https://api.elevenlabs.io/v1/models', {
				headers: {
					'xi-api-key': settings.apiKey
				}
			});

			if (!response.ok) {
				throw new Error('Failed to fetch models');
			}

			const models = await response.json();

			// Clear and populate model select
			modelSelect.innerHTML = '';
			modelSelect.disabled = false;

			// Filter for TTS-capable models and add them
			models
				.filter(model => model.can_do_text_to_speech)
				.forEach(model => {
					const option = new Option(model.name, model.model_id);
					modelSelect.add(option);
				});

			// Set selected value
			modelSelect.value = settings.model || models.find(m => m.can_do_text_to_speech)?.model_id || '';

		} catch (error) {
			// Fall back to hardcoded models if API fails
			console.error('Failed to load models.', error);
			modelSelect.innerHTML = '<option value="eleven_multilingual_v2">Multilingual v2</option>';
			modelSelect.value = settings.model || 'eleven_multilingual_v2';
		}
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
		const button = document.createElement('button');
		button.className = 'claude-icon-btn tts-settings-button';
		button.innerHTML = SPEAKER_ICON;

		applyClaudeStyling(button);
		const tooltip = createClaudeTooltip(button, 'TTS Settings');
		tooltip.classList.add('tts-settings-tooltip');

		button.onclick = async () => {
			if (playbackManager.isActive()) {
				playbackManager.stop();
			} else {
				await createSettingsModal();
			}
		};

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