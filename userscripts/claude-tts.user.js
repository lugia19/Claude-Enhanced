// ==UserScript==
// @name         Claude TTS
// @namespace    https://lugia19.com
// @version      0.1.0
// @description  Adds text-to-speech functionality to claude.ai using ElevenLabs
// @match        https://claude.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @license      GPLv3
// ==/UserScript==

(function () {
	'use strict';

	//#region Polyglot Setup
	const isUserscript = typeof unsafeWindow === 'undefined';
	if (typeof unsafeWindow === 'undefined') unsafeWindow = window;

	let setStorageValue, getStorageValue, deleteStorageValue;

	if (typeof GM_setValue !== 'undefined') {
		// Running as userscript
		setStorageValue = async (key, value) => {
			GM_setValue(key, value);
		};

		getStorageValue = async (key, defaultValue) => {
			return GM_getValue(key, defaultValue);
		};

		deleteStorageValue = async (key) => {
			GM_deleteValue(key);
		};
	} else {
		// Running as extension
		setStorageValue = async (key, value) => {
			window.postMessage({
				type: 'GM_setValue',
				key: key,
				value: value
			}, '*');
		};

		getStorageValue = async (key, defaultValue) => {
			return new Promise((resolve) => {
				const requestId = Math.random().toString(36).substr(2, 9);
				const listener = (event) => {
					if (event.data.type === 'GM_getValue_response' &&
						event.data.requestId === requestId) {
						window.removeEventListener('message', listener);
						resolve(event.data.value !== undefined ? event.data.value : defaultValue);
					}
				};
				window.addEventListener('message', listener);

				window.postMessage({
					type: 'GM_getValue',
					key: key,
					requestId: requestId
				}, '*');
			});
		};

		deleteStorageValue = async (key) => {
			window.postMessage({
				type: 'GM_deleteValue',
				key: key
			}, '*');
		};
	}
	//#endregion

	//#region Style System
	const claudeStyleMap = {
		// Icon buttons (top bar and message controls)
		'claude-icon-btn': 'inline-flex items-center justify-center relative shrink-0 ring-offset-2 ring-offset-bg-300 ring-accent-main-100 focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none text-text-200 border-transparent transition-colors font-styrene active:bg-bg-400 hover:bg-bg-500/40 hover:text-text-100 h-9 w-9 rounded-md active:scale-95',

		// Modal backdrop
		'claude-modal-backdrop': 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50',

		// Modal content box
		'claude-modal': 'bg-bg-100 rounded-lg p-6 shadow-xl max-w-md w-full mx-4 border border-border-300',

		// Primary button (white action buttons)
		'claude-btn-primary': 'inline-flex items-center justify-center px-4 py-2 font-base-bold bg-text-000 text-bg-000 rounded hover:bg-text-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[5rem] h-9',

		// Secondary button (cancel/neutral buttons)
		'claude-btn-secondary': 'inline-flex items-center justify-center px-4 py-2 hover:bg-bg-500/40 rounded transition-colors min-w-[5rem] h-9 text-text-000 font-base-bold border-0.5 border-border-200',

		// Select dropdown
		'claude-select': 'w-full p-2 rounded bg-bg-200 text-text-100 border border-border-300 hover:border-border-200 cursor-pointer',

		// Checkbox
		'claude-checkbox': 'mr-2 rounded border-border-300 accent-accent-main-100',

		// Text input
		'claude-input': 'w-full p-2 rounded bg-bg-200 text-text-100 border border-border-300 hover:border-border-200',

		// Tooltip wrapper (positioned absolutely)
		'claude-tooltip': 'fixed left-0 top-0 min-w-max z-50 pointer-events-none',

		// Tooltip content
		'claude-tooltip-content': 'px-2 py-1 text-xs font-normal font-ui leading-tight rounded-md shadow-md text-white bg-black/80 backdrop-blur break-words max-w-[13rem]',

		// Modal section headings
		'claude-modal-heading': 'text-lg font-semibold mb-4 text-text-100',

		// Modal section text/labels
		'claude-modal-text': 'text-sm text-text-400',

		// Form label
		'claude-label': 'block text-sm font-medium text-text-200 mb-1',

		// Radio/checkbox container
		'claude-check-group': 'flex items-center text-text-100',

		// Small/fine print text
		'claude-text-sm': 'text-sm text-text-400 sm:text-[0.75rem]',

		// Toggle switch container
		'claude-toggle': 'group/switch relative select-none cursor-pointer inline-block',

		// Hidden checkbox (screen reader only)
		'claude-toggle-input': 'peer sr-only',

		// Toggle track/background
		'claude-toggle-track': 'border-border-300 rounded-full bg-bg-500 transition-colors peer-checked:bg-accent-secondary-100 peer-disabled:opacity-50',

		// Toggle thumb/circle
		'claude-toggle-thumb': 'absolute flex items-center justify-center rounded-full bg-white transition-transform group-hover/switch:opacity-80',
	};

	function applyClaudeStyling(element) {
		// Apply to the element itself if it has claude- classes
		const elementClasses = Array.from(element.classList || []);
		elementClasses.forEach(className => {
			if (className.startsWith('claude-') && claudeStyleMap[className]) {
				element.classList.remove(className);
				claudeStyleMap[className].split(' ').forEach(c => {
					if (c) element.classList.add(c);
				});
			}
		});

		// Find and process all child elements with claude- classes
		const elements = element.querySelectorAll('[class*="claude-"]');
		elements.forEach(el => {
			const classes = Array.from(el.classList);
			classes.forEach(className => {
				if (className.startsWith('claude-') && claudeStyleMap[className]) {
					el.classList.remove(className);
					claudeStyleMap[className].split(' ').forEach(c => {
						if (c) el.classList.add(c);
					});
				}
			});
		});
	}

	function createClaudeToggle(labelText = '', checked = false, onChange = null) {
		// Container for toggle + label
		const container = document.createElement('div');
		container.className = 'flex items-center gap-2';

		// Toggle wrapper
		const toggleWrapper = document.createElement('label');

		const toggleContainer = document.createElement('div');
		toggleContainer.className = 'group/switch relative select-none cursor-pointer inline-block';

		const input = document.createElement('input');
		input.type = 'checkbox';
		input.className = 'peer sr-only';
		input.role = 'switch';
		input.checked = checked;
		input.style.width = '36px';
		input.style.height = '20px';

		const track = document.createElement('div');
		track.className = 'border-border-300 rounded-full bg-bg-500 transition-colors peer-checked:bg-accent-secondary-100 peer-disabled:opacity-50';
		track.style.width = '36px';
		track.style.height = '20px';

		const thumb = document.createElement('div');
		thumb.className = 'absolute flex items-center justify-center rounded-full bg-white transition-transform group-hover/switch:opacity-80';
		thumb.style.width = '16px';
		thumb.style.height = '16px';
		thumb.style.left = '2px';
		thumb.style.top = '2px';
		thumb.style.transform = checked ? 'translateX(16px)' : 'translateX(0)';

		input.addEventListener('change', (e) => {
			thumb.style.transform = e.target.checked ? 'translateX(16px)' : 'translateX(0)';
			if (onChange) onChange(e.target.checked);
		});

		toggleContainer.appendChild(input);
		toggleContainer.appendChild(track);
		toggleContainer.appendChild(thumb);
		toggleWrapper.appendChild(toggleContainer);

		container.appendChild(toggleWrapper);

		// Add label text if provided
		if (labelText) {
			const label = document.createElement('span');
			label.className = 'text-text-100 select-none cursor-pointer';
			label.style.transform = 'translateY(-3px)'; // Slight upward adjustment
			label.textContent = labelText;
			label.onclick = () => input.click(); // Make label clickable
			container.appendChild(label);
		}

		return { container, input, toggle: toggleContainer };
	}

	function createClaudeTooltip(element, tooltipText) {
		// Create tooltip wrapper
		const tooltipWrapper = document.createElement('div');
		tooltipWrapper.className = 'claude-tooltip';
		tooltipWrapper.style.display = 'none';
		tooltipWrapper.setAttribute('data-radix-popper-content-wrapper', '');

		// Add tooltip content
		const tooltipContent = document.createElement('div');
		tooltipContent.className = 'claude-tooltip-content tooltip-content';
		tooltipContent.setAttribute('data-side', 'bottom');
		tooltipContent.setAttribute('data-align', 'center');
		tooltipContent.setAttribute('data-state', 'delayed-open');
		tooltipContent.innerHTML = `
            ${tooltipText}
            <span role="tooltip" style="position: absolute; border: 0px; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; overflow-wrap: normal;">
                ${tooltipText}
            </span>
        `;
		tooltipWrapper.appendChild(tooltipContent);

		// Apply styling
		applyClaudeStyling(tooltipWrapper);

		// Add hover events to element
		element.addEventListener('mouseenter', () => {
			tooltipWrapper.style.display = 'block';
			const rect = element.getBoundingClientRect();
			const tooltipRect = tooltipWrapper.getBoundingClientRect();
			const centerX = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
			tooltipWrapper.style.transform = `translate(${centerX}px, ${rect.bottom + 5}px)`;
		});

		element.addEventListener('mouseleave', () => {
			tooltipWrapper.style.display = 'none';
		});

		// Hide on click if element is clickable
		const originalOnclick = element.onclick;
		if (originalOnclick) {
			element.onclick = (e) => {
				tooltipWrapper.style.display = 'none';
				return originalOnclick.call(element, e);
			};
		}

		// Add tooltip to document body
		document.body.appendChild(tooltipWrapper);

		// Clean up tooltip when element is removed
		const originalRemove = element.remove.bind(element);
		element.remove = () => {
			tooltipWrapper.remove();
			originalRemove();
		};

		// Return wrapper in case manual control is needed
		return tooltipWrapper;
	}
	//#endregion

	//#region SVG Icons
	const SPEAKER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
        <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/>
        <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/>
    </svg>`;

	const LOADING_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
        <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
    </svg>`;

	const PAUSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/>
    </svg>`;

	const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
        <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
        <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
    </svg>`;
	//#endregion

	//#region Global State
	let isPlaying = false;
	const pendingRequests = new Map(); // conversationId -> timestamp
	//#endregion

	//#region Playback Manager
	class PlaybackManager {
		constructor() {
			this.playbackState = 'none'; // none, loading, playing
			this.currentAudio = null;
			this.audioContext = null;
			this.currentSource = null;
		}

		async play(text, voiceId, modelId, apiKey) {
			// Stop any existing playback
			if (this.isActive()) {
				this.stop();
			}

			// Set loading state
			this.playbackState = 'loading';
			this.updateSettingsButton();

			try {
				// Chunk the text
				const chunks = this.chunkText(text, 3000);
				console.log(`Split text into ${chunks.length} chunks`);

				// Initialize audio context if needed
				if (!this.audioContext) {
					this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
				}

				// Fetch all audio chunks
				const audioBuffers = [];
				for (let i = 0; i < chunks.length; i++) {
					console.log(`Fetching audio for chunk ${i + 1}/${chunks.length}`);
					const audioData = await this.fetchAudio(chunks[i], voiceId, modelId, apiKey);
					if (!this.audioContext) {
						console.log("Audio context removed, likely stopped while fetching");
						return;
					}
					const audioBuffer = await this.audioContext.decodeAudioData(audioData);
					audioBuffers.push(audioBuffer);
				}

				// Set playing state
				this.playbackState = 'playing';
				this.updateSettingsButton();

				// Play all chunks sequentially
				for (let i = 0; i < audioBuffers.length; i++) {
					if (this.playbackState !== 'playing') break; // Stop if playback was cancelled

					console.log(`Playing chunk ${i + 1}/${audioBuffers.length}`);
					await this.playAudioBuffer(audioBuffers[i]);
				}

			} catch (error) {
				console.error('Playback error:', error);
				throw error;
			} finally {
				if (this.playbackState !== 'none') { // Only reset if not already stopped
					this.playbackState = 'none';
					this.updateSettingsButton();
				}
			}
		}

		async fetchAudio(text, voiceId, modelId, apiKey) {
			const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'xi-api-key': apiKey
				},
				body: JSON.stringify({
					text: text,
					model_id: modelId
				})
			});

			if (!response.ok) {
				const error = await response.text();
				throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
			}

			return await response.arrayBuffer();
		}

		playAudioBuffer(audioBuffer) {
			return new Promise((resolve, reject) => {
				try {
					this.currentSource = this.audioContext.createBufferSource();
					this.currentSource.buffer = audioBuffer;
					this.currentSource.connect(this.audioContext.destination);

					this.currentSource.onended = () => {
						this.currentSource = null;
						resolve();
					};

					this.currentSource.start(0);
				} catch (error) {
					reject(error);
				}
			});
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

		stop() {
			console.log('Stopping playback');

			// Stop current audio source
			if (this.currentSource) {
				try {
					this.currentSource.stop();
					this.currentSource.disconnect();
				} catch (e) {
					// Already stopped
				}
				this.currentSource = null;
			}

			// Close audio context
			if (this.audioContext && this.audioContext.state !== 'closed') {
				this.audioContext.close();
				this.audioContext = null;
			}

			this.playbackState = 'none';
			this.updateSettingsButton();
		}

		isActive() {
			return this.playbackState !== 'none';
		}

		updateSettingsButton() {
			const button = document.querySelector('.tts-settings-button');
			if (!button) return;

			const tooltip = document.querySelector('.tts-settings-tooltip');

			if (this.playbackState === 'loading') {
				// Show pause icon with spinning segmented circle
				button.innerHTML = `
                <div class="relative w-5 h-5">
                    <style>
                        @keyframes spin {
                            to { transform: rotate(360deg); }
                        }
                        .spinner-segment {
                            animation: spin 1s linear infinite;
                        }
                    </style>
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
					tooltip.querySelector('.tooltip-content').textContent = 'Loading audio...';
				}
			} else if (this.playbackState === 'playing') {
				button.innerHTML = PAUSE_ICON;
				if (tooltip) {
					tooltip.querySelector('.tooltip-content').textContent = 'Stop playback';
				}
			} else {
				button.innerHTML = SETTINGS_ICON;
				if (tooltip) {
					tooltip.querySelector('.tooltip-content').textContent = 'TTS Settings';
				}
			}
		}
	}

	const playbackManager = new PlaybackManager();
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

			const settings = await loadSettings();

			// Get text from message
			const text = await captureMessageText(button, settings.quotesOnly);
			if (!text) {
				alert('Failed to capture message text');
				return;
			}

			// Get settings
			const conversationId = getConversationId();
			const voiceOverride = conversationId ? await getStorageValue(`chatVoice_${conversationId}`, '') : '';
			const voiceId = voiceOverride || settings.voice;

			if (!settings.apiKey || !voiceId) {
				alert('Please configure TTS settings first');
				return;
			}


			// Start playback (will handle stopping existing playback internally)
			try {
				await playbackManager.play(text, voiceId, settings.model, settings.apiKey);
			} catch (error) {
				alert('Failed to play audio: ' + error.message);
			}
		};

		return button;
	}

	async function captureMessageText(button, quotesOnly) {
		const controls = button.closest('.justify-between');
		const copyButton = controls?.querySelector('[data-testid="action-bar-copy"]');

		if (!copyButton) {
			console.error('Could not find copy button');
			return null;
		}

		// Temporarily override clipboard
		const originalWrite = navigator.clipboard.write;
		let capturedText = null;

		navigator.clipboard.write = async (data) => {
			const item = data[0];
			if (item.types.includes('text/plain')) {
				const blob = await item.getType('text/plain');
				capturedText = await blob.text();
			}
			return Promise.resolve();
		};

		// Click copy button
		copyButton.click();
		await new Promise(resolve => setTimeout(resolve, 100)); // Wait for clipboard to be set
		// Restore original clipboard
		navigator.clipboard.write = originalWrite;

		// Remove code blocks (both ``` style and indented)
		if (capturedText) {
			capturedText = cleanupText(capturedText, quotesOnly);
		}

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

		const messages = document.querySelectorAll('.font-claude-response');
		messages.forEach((message) => {
			const controls = findMessageControls(message);
			if (controls && !controls.querySelector('.tts-speak-button')) {
				const speakBtn = createSpeakButton();
				const copyButton = controls.querySelector('[data-testid="action-bar-copy"]');
				if (copyButton) {
					controls.insertBefore(speakBtn, copyButton.parentElement);
				}
			}
		});
	}

	function removeAllSpeakButtons() {
		const buttons = document.querySelectorAll('.tts-speak-button');
		buttons.forEach(btn => btn.remove());
	}
	//#endregion

	//#region Request Tracking
	const originalFetch = unsafeWindow.fetch;
	unsafeWindow.fetch = async (...args) => {
		const [input, config] = args;

		let url = undefined;
		if (input instanceof URL) {
			url = input.href;
		} else if (typeof input === 'string') {
			url = input;
		} else if (input instanceof Request) {
			url = input.url;
		}

		// Track completion requests
		if (url && (url.includes('/completion') || url.includes('/retry_completion')) && config?.method === 'POST') {
			const urlParts = url.split('/');
			const conversationId = urlParts[urlParts.indexOf('chat_conversations') + 1];
			pendingRequests.set(conversationId, Date.now());
		}

		const response = await originalFetch(...args);

		// Check for conversation updates
		if (url && url.includes('/chat_conversations/') &&
			url.includes('tree=True') &&
			config?.method === 'GET') {

			const urlParts = url.split('/');
			const conversationId = urlParts[urlParts.indexOf('chat_conversations') + 1]?.split('?')[0];

			const requestTime = pendingRequests.get(conversationId);
			if (requestTime) {
				// Wait for response to complete
				response.clone().json().then(async (data) => {
					// Check if we have a new message
					const lastMessage = data.chat_messages?.[data.chat_messages.length - 1];
					if (lastMessage && lastMessage.sender === 'assistant') {
						const messageTime = new Date(lastMessage.created_at).getTime();

						// If message is newer than our request, auto-speak if enabled
						if (messageTime > requestTime) {
							const settings = await loadSettings();
							if (settings.enabled && settings.autoSpeak) {
								// Extract text from message content
								let messageText = '';
								for (const content of lastMessage.content) {
									if (content.text) {
										messageText += content.text + '\n';
									}
								}

								if (messageText) {
									// Clean up the text
									messageText = cleanupText(messageText, settings.quotesOnly);

									if (messageText) {
										// Get voice settings
										const voiceOverride = await getStorageValue(`chatVoice_${conversationId}`, '');
										const voiceId = voiceOverride || settings.voice;

										if (settings.apiKey && voiceId) {
											// Small delay to let UI settle
											setTimeout(() => {
												playbackManager.play(messageText, voiceId, settings.model, settings.apiKey)
													.catch(err => console.error('Auto-speak failed:', err));
											}, 100);
										}
									}
								}
							}
							pendingRequests.delete(conversationId);
						}
					}
				});
			}
		}

		return response;
	};
	//#endregion

	//#region Settings Modal
	async function createSettingsModal() {
		const modal = document.createElement('div');
		modal.className = 'claude-modal-backdrop';

		const settings = await loadSettings();

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
                    <option value="">Loading voices...</option>
                </select>
            </div>

            <div class="mb-4">
                <label class="claude-label">Model</label>
                <select class="claude-select" id="modelSelect">
                    <option value="">Loading models...</option>
                </select>
            </div>

            <div class="mb-4">
                <div id="autoSpeakToggleContainer"></div>
            </div>

            <div class="mb-4">
                <div id="quotesOnlyToggleContainer"></div>
            </div>

            <div class="mb-4">
                <label class="claude-label">Voice Override (Current Chat)</label>
                <select class="claude-select" id="chatVoiceOverride" ${!settings.apiKey ? 'disabled' : ''}>
                    <option value="">Use default voice</option>
                </select>
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

		const quotesOnlyToggle = createClaudeToggle('Only speak quoted text', settings.quotesOnly, null);
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
				autoSpeak: autoSpeakToggle.input.checked,
				quotesOnly: quotesOnlyToggle.input.checked
			};

			// Handle per-chat override
			const chatOverride = modal.querySelector('#chatVoiceOverride').value;
			if (chatOverride) {
				const conversationId = getConversationId();
				if (conversationId) {
					await setStorageValue(`chatVoice_${conversationId}`, chatOverride);
				}
			} else {
				const conversationId = getConversationId();
				if (conversationId) {
					await deleteStorageValue(`chatVoice_${conversationId}`);
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
				const override = await getStorageValue(`chatVoice_${conversationId}`, '');
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
		return {
			enabled: await getStorageValue('tts_enabled', false),
			apiKey: await getStorageValue('tts_apiKey', ''),
			voice: await getStorageValue('tts_voice', ''),
			model: await getStorageValue('tts_model', 'eleven_multilingual_v2'),
			autoSpeak: await getStorageValue('tts_autoSpeak', false),
			quotesOnly: await getStorageValue('tts_quotesOnly', false)
		};
	}

	async function saveSettings(settings) {
		await setStorageValue('tts_enabled', settings.enabled);
		await setStorageValue('tts_apiKey', settings.apiKey);
		await setStorageValue('tts_voice', settings.voice);
		await setStorageValue('tts_model', settings.model);
		await setStorageValue('tts_autoSpeak', settings.autoSpeak);
		await setStorageValue('tts_quotesOnly', settings.quotesOnly);
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
		button.innerHTML = SETTINGS_ICON;

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

	function tryAddSettingsButton() {
		const BUTTON_PRIORITY = [
			'style-selector-button',
			'stt-settings-button',
			'tts-settings-button',
			'export-button'
		];

		const buttonClass = 'tts-settings-button';

		const container = document.querySelector(".right-3.flex.gap-2");
		if (!container || container.querySelector('.' + buttonClass) || container.querySelectorAll("button").length == 0) {
			return; // Either container not found or button already exists
		}

		const button = createSettingsButton();
		button.classList.add(buttonClass);

		const myIndex = BUTTON_PRIORITY.indexOf(buttonClass);

		// Look for the button that should come right before us
		for (let i = myIndex - 1; i >= 0; i--) {
			const previousButton = container.querySelector('.' + BUTTON_PRIORITY[i]);
			if (previousButton) {
				if (previousButton.nextSibling) {
					container.insertBefore(button, previousButton.nextSibling);
				} else {
					container.appendChild(button);
				}
				return;
			}
		}

		// No previous buttons found, we go first
		container.insertBefore(button, container.firstChild);
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

	function initialize() {
		// Try to add the settings button immediately
		tryAddSettingsButton();

		// Check every 5 seconds
		setInterval(tryAddSettingsButton, 5000);

		// Add message buttons every 3 seconds
		setInterval(addSpeakButtons, 3000);
	}

	initialize();
	//#endregion
})();