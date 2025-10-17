// stt-input.js
(function () {
	'use strict';

	// ======== STT PROVIDERS CONFIGURATION ========
	const STT_PROVIDERS = {
		browser: {
			name: 'Browser (Free)',
			requiresApiKey: false,
			class: BrowserSTTProvider
		},
		groq: {
			name: 'Groq (Fast & Cheap)',
			requiresApiKey: true,
			class: GroqSTTProvider
		},
		openai: {
			name: 'OpenAI (Expensive)',
			requiresApiKey: true,
			class: OpenAISTTProvider
		}
	};

	// ======== STATE AND SETTINGS ========
	let sttProvider = null;
	let micButton = null;
	let currentState = 'idle'; // idle, recording, loading

	// ======== SETTINGS MANAGEMENT ========
	async function showSettingsModal() {
		const storage = await chrome.storage.local.get([
			'stt_provider',
			'stt_api_key',
			'stt_auto_send',
			'stt_enabled',
			'stt_audio_device'
		]);
		const selectedProvider = storage.stt_provider || (BrowserSTTProvider.isAvailable() ? 'browser' : 'groq');
		const apiKey = storage.stt_api_key || '';
		const autoSend = storage.stt_auto_send || false;
		const sttEnabled = storage.stt_enabled || false;
		const savedAudioDevice = storage.stt_audio_device || 'default';

		// Get available audio devices - request permission if needed
		let audioDevices = [];
		try {
			let devices = await navigator.mediaDevices.enumerateDevices();
			const audioInputs = devices.filter(device => device.kind === 'audioinput');

			const hasPermission = audioInputs.some(device => device.label && device.label.length > 0);

			if (!hasPermission && audioInputs.length > 0) {
				try {
					console.log('Requesting microphone permission for device list...');
					const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
					stream.getTracks().forEach(track => track.stop());
					devices = await navigator.mediaDevices.enumerateDevices();
				} catch (permError) {
					console.error('User denied microphone permission:', permError);
				}
			}

			audioDevices = devices.filter(device => device.kind === 'audioinput');
		} catch (error) {
			console.error('Error enumerating devices:', error);
		}

		// Build device options
		const deviceOptions = [{ value: 'default', label: 'Use default' }];

		audioDevices.forEach(device => {
			if (device.deviceId && device.deviceId !== 'default' && device.label) {
				deviceOptions.push({
					value: device.deviceId,
					label: device.label
				});
			}
		});

		const needsPermission = deviceOptions.length === 1;

		// Build modal content
		const contentDiv = document.createElement('div');

		// STT Enabled toggle
		const sttEnabledContainer = document.createElement('div');
		sttEnabledContainer.className = 'mb-4';
		const sttEnabledToggle = createClaudeToggle('Enable Speech-to-Text', sttEnabled);
		sttEnabledContainer.appendChild(sttEnabledToggle.container);
		contentDiv.appendChild(sttEnabledContainer);

		// Provider dropdown
		const providerContainer = document.createElement('div');
		providerContainer.className = 'mb-4';

		const providerLabel = document.createElement('label');
		providerLabel.className = CLAUDE_CLASSES.LABEL;
		providerLabel.textContent = 'STT Provider';
		providerContainer.appendChild(providerLabel);

		const providerOptions = Object.entries(STT_PROVIDERS)
			.filter(([key, config]) => {
				return config.class.isAvailable();
			})
			.map(([key, config]) => ({
				value: key,
				label: config.name
			}));

		const providerSelect = createClaudeSelect(providerOptions, selectedProvider);
		providerContainer.appendChild(providerSelect);
		contentDiv.appendChild(providerContainer);

		// API Key input
		const apiKeyContainer = document.createElement('div');
		apiKeyContainer.className = 'mb-4';

		const apiKeyLabel = document.createElement('label');
		apiKeyLabel.className = CLAUDE_CLASSES.LABEL;
		apiKeyLabel.textContent = 'API Key';
		apiKeyContainer.appendChild(apiKeyLabel);

		const apiKeyInput = createClaudeInput({
			type: 'password',
			placeholder: 'Enter API key...',
			value: apiKey
		});
		apiKeyInput.id = 'sttApiKey';
		apiKeyContainer.appendChild(apiKeyInput);
		contentDiv.appendChild(apiKeyContainer);

		// Update API key field visibility based on provider
		function updateApiKeyVisibility() {
			const provider = STT_PROVIDERS[providerSelect.value];
			if (provider.requiresApiKey) {
				apiKeyContainer.style.display = 'block';
			} else {
				apiKeyContainer.style.display = 'none';
			}
		}
		updateApiKeyVisibility();

		providerSelect.addEventListener('change', updateApiKeyVisibility);

		// Audio Device dropdown
		const audioDeviceContainer = document.createElement('div');
		audioDeviceContainer.className = 'mb-4';

		const audioDeviceLabel = document.createElement('label');
		audioDeviceLabel.className = CLAUDE_CLASSES.LABEL;
		audioDeviceLabel.textContent = 'Audio Input Device';
		audioDeviceContainer.appendChild(audioDeviceLabel);

		const audioDeviceSelect = createClaudeSelect(deviceOptions, savedAudioDevice);
		audioDeviceContainer.appendChild(audioDeviceSelect);

		// Add permission message if needed
		if (needsPermission) {
			const permissionNote = document.createElement('div');
			permissionNote.className = CLAUDE_CLASSES.TEXT_MUTED + ' mt-1';
			permissionNote.textContent = 'Grant microphone permission to see available devices';
			audioDeviceContainer.appendChild(permissionNote);

			const requestPermButton = createClaudeButton(
				'Request Microphone Access',
				'secondary',
				async () => {
					try {
						const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
						stream.getTracks().forEach(track => track.stop());
						modal.destroy();
						await showSettingsModal();
					} catch (err) {
						showClaudeAlert('Permission Denied', 'Microphone permission denied. Please allow microphone access in your browser settings.');
					}
				}
			);
			requestPermButton.className += ' mt-2';
			audioDeviceContainer.appendChild(requestPermButton);
		}

		contentDiv.appendChild(audioDeviceContainer);

		// Auto-send toggle
		const autoSendContainer = document.createElement('div');
		autoSendContainer.className = 'mb-4';
		const autoSendToggle = createClaudeToggle('Auto-send after transcription', autoSend);
		autoSendContainer.appendChild(autoSendToggle.container);
		contentDiv.appendChild(autoSendContainer);

		// Create modal
		const modal = new ClaudeModal('STT Settings', contentDiv);
		modal.addCancel('Cancel');
		modal.addConfirm('Save', async (btn, modal) => {
			const newProvider = providerSelect.value;
			const newKey = apiKeyInput.value.trim();
			const newAutoSend = autoSendToggle.input.checked;
			const newEnabled = sttEnabledToggle.input.checked;
			const newAudioDevice = audioDeviceSelect.value;

			const provider = STT_PROVIDERS[newProvider];

			// Validate API key if provider requires it
			if (provider.requiresApiKey && newKey) {
				// Show loading state
				btn.disabled = true;
				btn.textContent = 'Validating...';

				const isValid = await provider.class.validateApiKey(newKey);

				if (!isValid) {
					// Show error state
					btn.style.backgroundColor = '#c51c1c';
					btn.textContent = 'Invalid Key';

					// Restore after 2 seconds
					setTimeout(() => {
						btn.style.backgroundColor = '';
						btn.textContent = 'Save';
						btn.disabled = false;
					}, 2000);

					return false; // Keep modal open
				}
			}

			await chrome.storage.local.set({
				stt_provider: newProvider,
				stt_api_key: newKey,
				stt_auto_send: newAutoSend,
				stt_enabled: newEnabled,
				stt_audio_device: newAudioDevice
			});

			return true; // Close modal
		});

		modal.show();
	}

	// ======== RECORDING FUNCTIONS ========
	async function startRecording() {
		try {
			const storage = await chrome.storage.local.get(['stt_provider', 'stt_api_key', 'stt_audio_device']);
			const providerKey = storage.stt_provider || (BrowserSTTProvider.isAvailable() ? 'browser' : 'groq');
			const apiKey = storage.stt_api_key || '';
			const audioDevice = storage.stt_audio_device || 'default';

			const providerConfig = STT_PROVIDERS[providerKey];

			if (!providerConfig) {
				throw new Error('Invalid provider');
			}

			// Check if API key is required but missing
			if (providerConfig.requiresApiKey && !apiKey) {
				showClaudeAlert('API Key Required', 'Please set your API key in settings first.');
				return;
			}

			// Instantiate the provider
			sttProvider = new providerConfig.class(apiKey);

			// Start recording
			await sttProvider.startRecording(audioDevice);
			currentState = 'recording';
			updateMicButton();

		} catch (error) {
			console.error('Error starting recording:', error);
			showClaudeAlert('Microphone Error', 'Failed to access microphone. Please check permissions.');
		}
	}

	async function stopRecording() {
		if (!sttProvider) {
			return;
		}

		try {
			currentState = 'loading';
			updateMicButton();

			const transcription = await sttProvider.stopRecording();

			const storage = await chrome.storage.local.get('stt_auto_send');
			const autoSend = storage.stt_auto_send || false;
			insertTextAndSend(transcription, autoSend);

			sttProvider = null;
			currentState = 'idle';
			updateMicButton();

		} catch (error) {
			console.error('Transcription error:', error);
			sttProvider = null;
			currentState = 'idle';
			updateMicButton();

			// Show error modal
			showClaudeAlert('Transcription Failed', 'An error occurred during transcription. Please try again.');
		}
	}

	// ======== TEXT INSERTION ========
	function insertTextAndSend(text, autoSend) {
		const simpleTextarea = document.querySelector('.claude-simple-input');
		if (simpleTextarea) {
			simpleTextarea.value = text;
			simpleTextarea.dispatchEvent(new Event('input', { bubbles: true }));

			if (autoSend) {
				const submitButton = document.querySelector('.claude-custom-submit') ||
					document.querySelector('button[aria-label="Send message"]');
				if (submitButton && !submitButton.disabled) {
					submitButton.click();
				}
			}
		} else {
			const proseMirrorDiv = document.querySelector('.ProseMirror');
			if (proseMirrorDiv) {
				proseMirrorDiv.innerHTML = '';
				const lines = text.split('\n');
				lines.forEach(line => {
					const p = document.createElement('p');
					p.textContent = line || '\u00A0';
					proseMirrorDiv.appendChild(p);
				});

				proseMirrorDiv.dispatchEvent(new Event('input', { bubbles: true }));
				proseMirrorDiv.dispatchEvent(new Event('change', { bubbles: true }));

				if (autoSend) {
					setTimeout(() => {
						const submitButton = document.querySelector('button[aria-label="Send message"]');
						if (submitButton && !submitButton.disabled) {
							submitButton.click();
						}
					}, 100);
				}
			}
		}
	}

	// ======== UI CREATION ========
	function createSettingsButton() {
		const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
    </svg>`;

		const button = createClaudeButton(svgContent, 'icon', showSettingsModal);

		return button;
	}

	function createMicButton() {
		const container = document.createElement('div');
		container.className = 'stt-mic-container inline-flex gap-1 mr-2';
		container.style.display = 'inline-flex';

		updateMicButton(container);
		return container;
	}

	function updateMicButton(container) {
		if (!container) {
			container = document.querySelector('.stt-mic-container');
			if (!container) return;
		}

		container.innerHTML = '';

		const button = document.createElement('button');
		button.className = `inline-flex items-center justify-center relative shrink-0 
            disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none 
            disabled:drop-shadow-none text-white transition-colors h-8 w-8 rounded-lg active:scale-95`;
		button.style.backgroundColor = '#2c84db';
		button.style.cssText += 'background-color: #2c84db !important;';

		button.onmouseover = () => button.style.backgroundColor = '#2573c4';
		button.onmouseout = () => button.style.backgroundColor = '#2c84db';

		switch (currentState) {
			case 'idle':
				button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>`;
				button.onclick = startRecording;
				break;

			case 'recording':
				button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2"></rect>
                </svg>`;
				button.onclick = stopRecording;
				break;

			case 'loading':
				button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                </svg>`;
				button.disabled = true;
				button.onclick = null;
				break;
		}

		container.appendChild(button);
	}

	// ======== BUTTON INSERTION ========
	async function tryAddMicButton() {
		const storage = await chrome.storage.local.get('stt_enabled');
		const enabled = storage.stt_enabled || false;

		if (!enabled) {
			const existing = document.querySelector('.stt-mic-container');
			if (existing) existing.remove();
			return;
		}

		if (document.querySelector('.stt-mic-container')) return;

		const sendButton = document.querySelector('button[aria-label="Send message"]');
		if (!sendButton) return;

		const container = sendButton.parentElement;
		if (!container) return;

		const micContainer = createMicButton();

		container.style.display = 'flex';
		container.style.alignItems = 'center';

		container.insertBefore(micContainer, sendButton);
	}

	// ======== INITIALIZATION ========
	function initialize() {
		const style = document.createElement('style');
		style.id = 'stt-spinner-style';
		style.textContent = `
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .animate-spin {
                animation: spin 1s linear infinite;
            }
        `;
		if (!document.querySelector('#stt-spinner-style')) {
			document.head.appendChild(style);
		}

		setInterval(async () => {
			tryAddTopRightButton("stt-settings-button", createSettingsButton, 'STT Settings');
			await tryAddMicButton();
		}, 1000);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		initialize();
	}
})();