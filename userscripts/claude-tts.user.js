// ==UserScript==
// @name         Claude TTS Integration
// @namespace    lugia19.com
// @version      1.0.0
// @description  Adds text-to-speech functionality to Claude.ai using ElevenLabs API
// @match        https://claude.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @author       lugia19
// @license      GPLv3
// ==/UserScript==

(function () {
	'use strict';

	// ======== POLYGLOT SETUP ========
	if (typeof unsafeWindow === 'undefined') unsafeWindow = window;

	// ======== STYLE MAP ========
	const claudeStyleMap = {
		'claude-icon-btn': 'inline-flex items-center justify-center relative shrink-0 ring-offset-2 ring-offset-bg-300 ring-accent-main-100 focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none text-text-200 border-transparent transition-colors font-styrene active:bg-bg-400 hover:bg-bg-500/40 hover:text-text-100 h-9 w-9 rounded-md active:scale-95',
		'claude-modal-backdrop': 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50',
		'claude-modal': 'bg-bg-100 rounded-lg p-6 shadow-xl max-w-md w-full mx-4 border border-border-300',
		'claude-btn-primary': 'inline-flex items-center justify-center px-4 py-2 font-base-bold bg-text-000 text-bg-000 rounded hover:bg-text-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[5rem] h-9',
		'claude-btn-secondary': 'inline-flex items-center justify-center px-4 py-2 hover:bg-bg-500/40 rounded transition-colors min-w-[5rem] h-9 text-text-000 font-base-bold border-0.5 border-border-200',
		'claude-select': 'w-full p-2 rounded bg-bg-200 text-text-100 border border-border-300 hover:border-border-200 cursor-pointer',
		'claude-checkbox': 'mr-2 rounded border-border-300 accent-accent-main-100',
		'claude-input': 'w-full p-2 rounded bg-bg-200 text-text-100 border border-border-300 hover:border-border-200',
		'claude-tooltip': 'fixed left-0 top-0 min-w-max z-50 pointer-events-none',
		'claude-tooltip-content': 'px-2 py-1 text-xs font-normal font-ui leading-tight rounded-md shadow-md text-white bg-black/80 backdrop-blur break-words max-w-[13rem]',
		'claude-modal-heading': 'text-lg font-semibold mb-4 text-text-100',
		'claude-modal-text': 'text-sm text-text-400',
		'claude-label': 'block text-sm font-medium text-text-200 mb-1',
		'claude-check-group': 'flex items-center text-text-100',
		'claude-text-sm': 'text-sm text-text-400 sm:text-[0.75rem]',
		'claude-toggle': 'group/switch relative select-none cursor-pointer inline-block',
		'claude-toggle-input': 'peer sr-only',
		'claude-toggle-track': 'border-border-300 rounded-full bg-bg-500 transition-colors peer-checked:bg-accent-secondary-100 peer-disabled:opacity-50',
		'claude-toggle-thumb': 'absolute flex items-center justify-center rounded-full bg-white transition-transform group-hover/switch:opacity-80',
	};

	function applyClaudeStyling(element) {
		const elementClasses = Array.from(element.classList || []);
		elementClasses.forEach(className => {
			if (className.startsWith('claude-') && claudeStyleMap[className]) {
				element.classList.remove(className);
				claudeStyleMap[className].split(' ').forEach(c => {
					if (c) element.classList.add(c);
				});
			}
		});

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
		const container = document.createElement('div');
		container.className = 'flex items-center gap-2';

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

		if (labelText) {
			const label = document.createElement('span');
			label.className = 'text-text-100 select-none cursor-pointer';
			label.style.transform = 'translateY(-3px)';
			label.textContent = labelText;
			label.onclick = () => input.click();
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
		tooltipContent.className = 'claude-tooltip-content';
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

	// ======== STORAGE ABSTRACTION ========
	let setStorageValue, getStorageValue, deleteStorageValue;

	if (typeof GM_setValue !== 'undefined') {
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
		// Extension fallback using postMessage
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

	// ======== API STUBS ========
	async function fetchVoices(apiKey) {
		// TODO: Implement GET /v1/voices
		return [
			{ voice_id: 'test_id_1', name: 'Test Voice 1' },
			{ voice_id: 'test_id_2', name: 'Test Voice 2' }
		];
	}

	async function fetchModels(apiKey) {
		// TODO: Implement GET /v1/models (if needed)
		return [
			{ model_id: 'eleven_multilingual_v2', name: 'Multilingual v2' },
			{ model_id: 'eleven_turbo_v2_5', name: 'Turbo v2.5' },
			{ model_id: 'eleven_monolingual_v1', name: 'Monolingual v1' }
		];
	}

	async function generateTTS(apiKey, text, voiceId, model) {
		// TODO: Implement POST /v1/text-to-speech/{voice_id}
		console.log('TTS Generation:', { text: text.substring(0, 100), voiceId, model });
		// Return a dummy blob for testing
		return new Blob(['dummy audio data'], { type: 'audio/mpeg' });
	}

	// ======== AUDIO CONTROLLER ========
	class AudioController {
		constructor() {
			this.currentAudio = null;
			this.currentButton = null;
		}

		async play(audioBlob, button = null) {
			// Stop any currently playing audio
			this.stop();

			try {
				const audioUrl = URL.createObjectURL(audioBlob);
				this.currentAudio = new Audio(audioUrl);
				this.currentButton = button;

				// Update button state if provided
				if (button) {
					button.classList.add('playing');
					// Change icon to stop icon
					button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
                        <rect x="6" y="5" width="3" height="10" rx="0.5"/>
                        <rect x="11" y="5" width="3" height="10" rx="0.5"/>
                    </svg>`;
				}

				this.currentAudio.addEventListener('ended', () => {
					this.cleanup();
				});

				this.currentAudio.addEventListener('error', (e) => {
					console.error('Audio playback error:', e);
					this.cleanup();
				});

				await this.currentAudio.play();
			} catch (error) {
				console.error('Failed to play audio:', error);
				this.cleanup();
			}
		}

		stop() {
			if (this.currentAudio) {
				this.currentAudio.pause();
				this.currentAudio.currentTime = 0;
				this.cleanup();
			}
		}

		cleanup() {
			if (this.currentAudio) {
				const audioUrl = this.currentAudio.src;
				this.currentAudio = null;
				if (audioUrl.startsWith('blob:')) {
					URL.revokeObjectURL(audioUrl);
				}
			}

			if (this.currentButton) {
				this.currentButton.classList.remove('playing');
				// Restore speaker icon
				this.currentButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10.5 5.5l-4 3H4a1 1 0 00-1 1v1a1 1 0 001 1h2.5l4 3V5.5zM14 8a2 2 0 010 4V8zM16 6v8a4 4 0 000-8z"/>
                </svg>`;
				this.currentButton = null;
			}
		}
	}

	const audioController = new AudioController();

	// ======== TEXT EXTRACTION ========
	async function extractTextViaClipboard(copyButton) {
		let capturedText = null;
		const originalWrite = navigator.clipboard.write;

		navigator.clipboard.write = async (items) => {
			for (const item of items) {
				if (item.types.includes('text/plain')) {
					const blob = await item.getType('text/plain');
					capturedText = await blob.text();
				}
			}
			return Promise.resolve();
		};

		copyButton.click();
		await new Promise(resolve => setTimeout(resolve, 10));

		navigator.clipboard.write = originalWrite;

		// Strip code blocks
		if (capturedText) {
			capturedText = capturedText.replace(/```[\s\S]*?```/g, '');
		}

		return capturedText;
	}

	function extractTextFromAPIResponse(content) {
		const textParts = [];

		for (const block of content) {
			if (block.type === 'text' && block.text) {
				let text = block.text;
				// Strip code blocks
				text = text.replace(/```[\s\S]*?```/g, '');
				textParts.push(text);
			}
		}

		return textParts.join('\n');
	}

	// ======== SPEAKER BUTTON ========
	function createSpeakerButton(messageElement) {
		const button = document.createElement('button');
		button.className = 'claude-icon-btn h-8 w-8 tts-speaker-button';
		button.type = 'button';
		button.setAttribute('aria-label', 'Read aloud');

		button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10.5 5.5l-4 3H4a1 1 0 00-1 1v1a1 1 0 001 1h2.5l4 3V5.5zM14 8a2 2 0 010 4V8zM16 6v8a4 4 0 000-8z"/>
    </svg>`;

		applyClaudeStyling(button);
		createClaudeTooltip(button, 'Read aloud');

		button.onclick = async (e) => {
			e.preventDefault();
			e.stopPropagation();

			// If this button is already playing, stop it
			if (button.classList.contains('playing')) {
				audioController.stop();
				return;
			}

			// Find the copy button in the same message
			const messageGroup = button.closest('.group');
			const copyButton = messageGroup?.querySelector('[data-testid="action-bar-copy"]');

			if (!copyButton) {
				console.error('Could not find copy button');
				return;
			}

			// Extract text using clipboard intercept
			const text = await extractTextViaClipboard(copyButton);

			if (!text || text.trim() === '') {
				console.warn('No text to speak');
				return;
			}

			// Apply filters
			const settings = await getSettings();
			let finalText = text;

			if (settings.speakOnlyQuotes) {
				// Extract only quoted text
				const quotes = text.match(/"[^"]+"/g) || [];
				finalText = quotes.join(' ');

				if (!finalText) {
					console.warn('No quoted text found');
					return;
				}
			}

			// Get voice for this chat
			const conversationId = getConversationId();
			const voiceOverride = await getStorageValue(`voice_override_${conversationId}`, null);
			const voiceId = voiceOverride || settings.selectedVoice;

			if (!voiceId) {
				console.error('No voice selected');
				alert('Please select a voice in TTS settings');
				return;
			}

			// Generate and play TTS
			try {
				const audioBlob = await generateTTS(settings.apiKey, finalText, voiceId, settings.selectedModel);
				await audioController.play(audioBlob, button);
			} catch (error) {
				console.error('TTS generation failed:', error);
				alert('TTS generation failed. Check your API key and settings.');
			}
		};

		return button;
	}

	// ======== BUTTON MANAGEMENT ========
	function addSpeakerButtons() {
		const messages = document.querySelectorAll('.font-claude-response');

		messages.forEach((message) => {
			const group = message.closest('.group');
			if (!group) return;

			// Find the action bar
			const copyButton = group.querySelector('[data-testid="action-bar-copy"]');
			if (!copyButton) return;

			const actionBar = copyButton.closest('.justify-between');
			if (!actionBar) return;

			// Check if we already added a button
			if (actionBar.querySelector('.tts-speaker-button')) return;

			// Add speaker button
			const speakerButton = createSpeakerButton(message);
			actionBar.insertBefore(speakerButton, copyButton.parentElement);
		});
	}

	function removeSpeakerButtons() {
		document.querySelectorAll('.tts-speaker-button').forEach(button => {
			button.remove();
		});
	}

	async function updateButtonVisibility() {
		const settings = await getSettings();

		if (settings.enabled) {
			addSpeakerButtons();
		} else {
			removeSpeakerButtons();
			audioController.stop(); // Stop any playing audio
		}
	}

	// ======== SETTINGS MODAL ========
	async function getSettings() {
		return {
			enabled: await getStorageValue('tts_enabled', false),
			apiKey: await getStorageValue('tts_api_key', ''),
			selectedVoice: await getStorageValue('tts_voice', ''),
			selectedModel: await getStorageValue('tts_model', 'eleven_multilingual_v2'),
			autoSpeak: await getStorageValue('tts_auto_speak', false),
			speakOnlyQuotes: await getStorageValue('tts_speak_only_quotes', false)
		};
	}

	async function saveSettings(settings) {
		await setStorageValue('tts_enabled', settings.enabled);
		await setStorageValue('tts_api_key', settings.apiKey);
		await setStorageValue('tts_voice', settings.selectedVoice);
		await setStorageValue('tts_model', settings.selectedModel);
		await setStorageValue('tts_auto_speak', settings.autoSpeak);
		await setStorageValue('tts_speak_only_quotes', settings.speakOnlyQuotes);

		// Update button visibility based on enabled state
		await updateButtonVisibility();
	}

	async function showSettingsModal() {
		const settings = await getSettings();

		const modal = document.createElement('div');
		modal.className = 'claude-modal-backdrop';

		const modalContent = document.createElement('div');
		modalContent.className = 'claude-modal';
		modalContent.style.maxWidth = '32rem';

		modalContent.innerHTML = `
            <h3 class="claude-modal-heading">TTS Settings</h3>
            
            <div class="space-y-4">
                <div id="enabledToggleContainer"></div>
                
                <div>
                    <label class="claude-label">ElevenLabs API Key</label>
                    <input type="password" id="apiKeyInput" class="claude-input" 
                           value="${settings.apiKey}" placeholder="Enter your API key">
                </div>
                
                <div>
                    <label class="claude-label">Voice</label>
                    <select id="voiceSelect" class="claude-select">
                        <option value="">Select a voice...</option>
                    </select>
                </div>
                
                <div>
                    <label class="claude-label">Model</label>
                    <select id="modelSelect" class="claude-select">
                        <option value="eleven_multilingual_v2">Multilingual v2</option>
                        <option value="eleven_turbo_v2_5">Turbo v2.5</option>
                        <option value="eleven_monolingual_v1">Monolingual v1</option>
                    </select>
                </div>
                
                <div id="autoSpeakContainer"></div>
                <div id="speakOnlyQuotesContainer"></div>
                
                <div>
                    <label class="claude-label">Voice Override for This Chat</label>
                    <select id="voiceOverrideSelect" class="claude-select">
                        <option value="">Use default voice</option>
                    </select>
                </div>
            </div>
            
            <div class="flex justify-end gap-2 mt-6">
                <button class="claude-btn-secondary" id="cancelSettings">Cancel</button>
                <button class="claude-btn-primary" id="saveSettings">Save</button>
            </div>
        `;

		modal.appendChild(modalContent);
		document.body.appendChild(modal);
		applyClaudeStyling(modal);

		// Add toggles
		const enabledToggle = createClaudeToggle('Enable TTS', settings.enabled);
		modalContent.querySelector('#enabledToggleContainer').appendChild(enabledToggle.container);

		const autoSpeakToggle = createClaudeToggle('Auto-speak new messages', settings.autoSpeak);
		modalContent.querySelector('#autoSpeakContainer').appendChild(autoSpeakToggle.container);

		const quotesToggle = createClaudeToggle('Speak only text in quotes', settings.speakOnlyQuotes);
		modalContent.querySelector('#speakOnlyQuotesContainer').appendChild(quotesToggle.container);

		// Set current values
		modalContent.querySelector('#modelSelect').value = settings.selectedModel;

		// Load voices if API key exists
		const apiKeyInput = modalContent.querySelector('#apiKeyInput');
		const voiceSelect = modalContent.querySelector('#voiceSelect');
		const voiceOverrideSelect = modalContent.querySelector('#voiceOverrideSelect');

		async function loadVoices() {
			const apiKey = apiKeyInput.value;
			if (!apiKey) return;

			try {
				const voices = await fetchVoices(apiKey);

				// Clear and populate voice selects
				voiceSelect.innerHTML = '<option value="">Select a voice...</option>';
				voiceOverrideSelect.innerHTML = '<option value="">Use default voice</option>';

				voices.forEach(voice => {
					const option = `<option value="${voice.voice_id}">${voice.name} (${voice.voice_id})</option>`;
					voiceSelect.innerHTML += option;
					voiceOverrideSelect.innerHTML += option;
				});

				// Set current selections
				voiceSelect.value = settings.selectedVoice || '';

				const conversationId = getConversationId();
				if (conversationId) {
					const override = await getStorageValue(`voice_override_${conversationId}`, '');
					voiceOverrideSelect.value = override;
				}
			} catch (error) {
				console.error('Failed to load voices:', error);
			}
		}

		// Load voices on modal open and API key change
		loadVoices();
		apiKeyInput.addEventListener('change', loadVoices);

		// Event handlers
		modalContent.querySelector('#saveSettings').onclick = async () => {
			const newSettings = {
				enabled: enabledToggle.input.checked,
				apiKey: apiKeyInput.value,
				selectedVoice: voiceSelect.value,
				selectedModel: modalContent.querySelector('#modelSelect').value,
				autoSpeak: autoSpeakToggle.input.checked,
				speakOnlyQuotes: quotesToggle.input.checked
			};

			await saveSettings(newSettings);

			// Save voice override if set
			const conversationId = getConversationId();
			if (conversationId) {
				const override = voiceOverrideSelect.value;
				if (override) {
					await setStorageValue(`voice_override_${conversationId}`, override);
				} else {
					await deleteStorageValue(`voice_override_${conversationId}`);
				}
			}

			modal.remove();
		};

		modalContent.querySelector('#cancelSettings').onclick = () => {
			modal.remove();
		};

		modal.onclick = (e) => {
			if (e.target === modal) {
				modal.remove();
			}
		};
	}

	// ======== TOP-RIGHT BUTTON ========
	function createSettingsButton() {
		const button = document.createElement('button');
		button.className = 'claude-icon-btn tts-settings-button';

		button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20">
        <path fill="currentColor" d="M10.5 5.5l-4 3H4a1 1 0 00-1 1v1a1 1 0 001 1h2.5l4 3V5.5zM14 8a2 2 0 010 4V8zM16 6v8a4 4 0 000-8z"/>
        <path fill="currentColor" opacity="0.5" d="M17 3l-1.5 1.5M17 17l-1.5-1.5M3 10h1"/>
    </svg>`;

		applyClaudeStyling(button);
		createClaudeTooltip(button, 'TTS Settings');

		button.onclick = showSettingsModal;

		return button;
	}


	function tryAddSettingsButton() {
		const BUTTON_PRIORITY = [
			'style-selector-button',
			'tts-settings-button',
			'stt-settings-button',
			'export-button'
		];

		const container = document.querySelector('.right-3.flex.gap-2');
		if (!container || container.querySelector('.tts-settings-button')) {
			return;
		}

		const button = createSettingsButton();

		// Find insertion point based on priority
		const myIndex = BUTTON_PRIORITY.indexOf('tts-settings-button');
		for (let i = myIndex - 1; i >= 0; i--) {
			const previousButton = container.querySelector('.' + BUTTON_PRIORITY[i]);
			if (previousButton) {
				container.insertBefore(button, previousButton.nextSibling);
				return;
			}
		}

		container.insertBefore(button, container.firstChild);
	}

	// ======== AUTO-SPEAK FUNCTIONALITY ========
	const pendingMessages = new Map(); // conversationId:messageId -> timestamp

	const originalFetch = window.fetch;
	window.fetch = async (...args) => {
		const [input, config] = args;

		let url = typeof input === 'string' ? input : input.url;

		// Intercept completion requests
		if (config?.method === 'POST' &&
			(url.includes('/completion') || url.includes('/retry_completion'))) {

			const settings = await getSettings();
			if (settings.enabled && settings.autoSpeak) {
				const urlParts = url.split('/');
				const conversationId = urlParts[urlParts.indexOf('chat_conversations') + 1];
				const key = conversationId;

				pendingMessages.set(key, Date.now());
			}
		}

		// Call original fetch
		const response = await originalFetch(...args);

		// Intercept completion responses
		if (url.includes('/chat_conversations/') &&
			url.includes('tree=True') &&
			url.includes('render_all_tools=true')) {

			const urlParts = url.split('/');
			const conversationId = urlParts[urlParts.indexOf('chat_conversations') + 1]?.split('?')[0];

			if (pendingMessages.has(conversationId)) {
				const requestTime = pendingMessages.get(conversationId);
				pendingMessages.delete(conversationId);

				// Clone response to read it
				const clonedResponse = response.clone();
				try {
					const data = await clonedResponse.json();

					// Find the latest assistant message
					const assistantMessages = data.chat_messages?.filter(m => m.sender === 'assistant') || [];
					const latestMessage = assistantMessages[assistantMessages.length - 1];

					if (latestMessage) {
						// Check if message is newer than our request
						const messageTime = new Date(latestMessage.created_at).getTime();
						if (messageTime > requestTime - 5000) { // 5 second tolerance
							// Extract text from content
							const text = extractTextFromAPIResponse(latestMessage.content || []);

							if (text) {
								// Apply filters and generate TTS
								const settings = await getSettings();
								let finalText = text;

								if (settings.speakOnlyQuotes) {
									const quotes = text.match(/"[^"]+"/g) || [];
									finalText = quotes.join(' ');
								}

								if (finalText) {
									const voiceOverride = await getStorageValue(`voice_override_${conversationId}`, null);
									const voiceId = voiceOverride || settings.selectedVoice;

									if (voiceId) {
										try {
											const audioBlob = await generateTTS(settings.apiKey, finalText, voiceId, settings.selectedModel);

											// Wait a bit for DOM to update, then play
											setTimeout(() => {
												audioController.play(audioBlob);
											}, 500);
										} catch (error) {
											console.error('Auto-speak TTS failed:', error);
										}
									}
								}
							}
						}
					}
				} catch (error) {
					console.error('Failed to process response for auto-speak:', error);
				}
			}
		}

		return response;
	};

	// ======== UTILITIES ========
	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	// ======== INITIALIZATION ========
	function initialize() {
		// Add settings button
		tryAddSettingsButton();
		setInterval(tryAddSettingsButton, 5000);

		// Manage speaker buttons based on settings
		updateButtonVisibility();
		setInterval(updateButtonVisibility, 3000);

		// Handle URL changes (stop audio when navigating)
		let lastUrl = window.location.href;
		const urlObserver = new MutationObserver(() => {
			if (window.location.href !== lastUrl) {
				lastUrl = window.location.href;
				audioController.stop();
				// Clear any pending auto-speak messages for old conversation
				pendingMessages.clear();
			}
		});
		urlObserver.observe(document, { subtree: true, childList: true });

		// Add CSS animations
		const style = document.createElement('style');
		style.textContent = `
			.tts-speaker-button.playing {
				color: var(--accent-main-100);
			}
		`;
		document.head.appendChild(style);
	}

	initialize();
})();