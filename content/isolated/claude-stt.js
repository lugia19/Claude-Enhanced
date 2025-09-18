// stt-input.js
(function () {
	'use strict';

	// ======== STATE AND SETTINGS ========
	let mediaRecorder = null;
	let audioChunks = [];
	let audioStream = null;
	let micButton = null;
	let currentState = 'idle'; // idle, recording, loading

	// ======== SETTINGS MANAGEMENT ========
	async function showSettingsModal() {
		const storage = await chrome.storage.local.get(['groq_api_key', 'stt_auto_send', 'stt_enabled', 'stt_audio_device']);
		const apiKey = storage.groq_api_key || '';
		const autoSend = storage.stt_auto_send || false;
		const sttEnabled = storage.stt_enabled || false;
		const savedAudioDevice = storage.stt_audio_device || 'default';

		// Get available audio devices - request permission if needed
		let audioDevices = [];
		try {
			// First, enumerate devices to check if we have labels
			let devices = await navigator.mediaDevices.enumerateDevices();
			const audioInputs = devices.filter(device => device.kind === 'audioinput');

			// Check if we have permission by seeing if labels are present
			const hasPermission = audioInputs.some(device => device.label && device.label.length > 0);

			if (!hasPermission && audioInputs.length > 0) {
				// We don't have permission yet - request it
				try {
					console.log('Requesting microphone permission for device list...');
					const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
					// Immediately stop the stream - we just needed it for permission
					stream.getTracks().forEach(track => track.stop());

					// Now enumerate again with permission
					devices = await navigator.mediaDevices.enumerateDevices();
				} catch (permError) {
					console.error('User denied microphone permission:', permError);
					// Continue anyway - we'll just show "Use default"
				}
			}

			audioDevices = devices.filter(device => device.kind === 'audioinput');
		} catch (error) {
			console.error('Error enumerating devices:', error);
		}

		// Build device options
		const deviceOptions = [{ value: 'default', label: 'Use default' }];

		// Only add devices that have labels (meaning we have permission)
		audioDevices.forEach(device => {
			if (device.deviceId && device.deviceId !== 'default' && device.label) {
				deviceOptions.push({
					value: device.deviceId,
					label: device.label
				});
			}
		});

		// If we only have "Use default", add a helper message
		const needsPermission = deviceOptions.length === 1;

		return new Promise((resolve) => {
			// Build modal content
			const contentDiv = document.createElement('div');

			// STT Enabled toggle
			const sttEnabledContainer = document.createElement('div');
			sttEnabledContainer.className = 'mb-4';
			const sttEnabledToggle = createClaudeToggle('Enable Speech-to-Text', sttEnabled);
			sttEnabledContainer.appendChild(sttEnabledToggle.container);
			contentDiv.appendChild(sttEnabledContainer);

			// API Key input
			const apiKeyContainer = document.createElement('div');
			apiKeyContainer.className = 'mb-4';

			const apiKeyLabel = document.createElement('label');
			apiKeyLabel.className = CLAUDE_STYLES.LABEL;
			apiKeyLabel.textContent = 'Groq API Key';
			apiKeyContainer.appendChild(apiKeyLabel);

			const apiKeyInput = createClaudeInput({
				type: 'password',
				placeholder: 'gsk_...',
				value: apiKey
			});
			apiKeyInput.id = 'groqApiKey';
			apiKeyContainer.appendChild(apiKeyInput);
			contentDiv.appendChild(apiKeyContainer);

			// Audio Device dropdown
			const audioDeviceContainer = document.createElement('div');
			audioDeviceContainer.className = 'mb-4';

			const audioDeviceLabel = document.createElement('label');
			audioDeviceLabel.className = CLAUDE_STYLES.LABEL;
			audioDeviceLabel.textContent = 'Audio Input Device';
			audioDeviceContainer.appendChild(audioDeviceLabel);

			const audioDeviceSelect = createClaudeSelect(deviceOptions, savedAudioDevice);
			audioDeviceContainer.appendChild(audioDeviceSelect);

			// Add permission message if needed
			if (needsPermission) {
				const permissionNote = document.createElement('div');
				permissionNote.className = CLAUDE_STYLES.TEXT_MUTED + ' mt-1';
				permissionNote.textContent = 'Grant microphone permission to see available devices';
				audioDeviceContainer.appendChild(permissionNote);

				// Add a button to request permission using the proper helper
				const requestPermButton = createClaudeButton(
					'Request Microphone Access',
					'secondary',
					async () => {
						try {
							const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
							stream.getTracks().forEach(track => track.stop());
							// Close and reopen the modal to refresh the device list
							modal.remove();
							await showSettingsModal();
						} catch (err) {
							alert('Microphone permission denied. Please allow microphone access in your browser settings.');
						}
					}
				);
				requestPermButton.className += ' mt-2'; // Add top margin
				audioDeviceContainer.appendChild(requestPermButton);
			}

			contentDiv.appendChild(audioDeviceContainer);

			// Auto-send toggle
			const autoSendContainer = document.createElement('div');
			autoSendContainer.className = 'mb-4';
			const autoSendToggle = createClaudeToggle('Auto-send after transcription', autoSend);
			autoSendContainer.appendChild(autoSendToggle.container);
			contentDiv.appendChild(autoSendContainer);

			// Create modal with custom handling
			const modal = createClaudeModal({
				title: 'STT Settings',
				content: contentDiv,
				confirmText: 'Save',
				cancelText: 'Cancel',
				onCancel: () => {
					resolve(false);
				},
				onConfirm: async () => {
					const newKey = apiKeyInput.value.trim();
					const newAutoSend = autoSendToggle.input.checked;
					const newEnabled = sttEnabledToggle.input.checked;
					const newAudioDevice = audioDeviceSelect.value;

					if (newKey && newKey !== apiKey) {
						// Validate the API key
						const isValid = await validateApiKey(newKey);
						if (!isValid) {
							alert('Invalid API key. Please check and try again.');
							// Don't close modal - re-add it since onConfirm removes it
							document.body.appendChild(modal);
							return;
						}
					}

					await chrome.storage.local.set({
						groq_api_key: newKey,
						stt_auto_send: newAutoSend,
						stt_enabled: newEnabled,
						stt_audio_device: newAudioDevice
					});

					resolve(true);
				}
			});

			document.body.appendChild(modal);
		});
	}

	async function validateApiKey(apiKey) {
		try {
			const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`
				},
				body: new FormData() // Empty form data to trigger error
			});
			// If we get a 400 (missing file) that's actually good - auth worked
			return response.status === 400 || response.status === 200;
		} catch (error) {
			return false;
		}
	}

	// ======== RECORDING FUNCTIONS ========
	async function startRecording() {
		try {
			// Get the saved audio device preference
			const storage = await chrome.storage.local.get('stt_audio_device');
			const audioDevice = storage.stt_audio_device || 'default';

			// Build constraints based on selected device
			const constraints = {
				audio: audioDevice === 'default' ? true : { deviceId: { exact: audioDevice } }
			};

			audioStream = await navigator.mediaDevices.getUserMedia(constraints);
			mediaRecorder = new MediaRecorder(audioStream, {
				mimeType: 'audio/webm'
			});

			audioChunks = [];

			mediaRecorder.ondataavailable = (event) => {
				audioChunks.push(event.data);
			};

			mediaRecorder.start();
			currentState = 'recording';
			updateMicButton();
		} catch (error) {
			console.error('Error starting recording:', error);

			// If the exact device fails, try with default
			if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
				try {
					console.log('Selected device not available, falling back to default');
					audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
					mediaRecorder = new MediaRecorder(audioStream, {
						mimeType: 'audio/webm'
					});

					audioChunks = [];

					mediaRecorder.ondataavailable = (event) => {
						audioChunks.push(event.data);
					};

					mediaRecorder.start();
					currentState = 'recording';
					updateMicButton();

					// Clear the saved device preference since it's not available
					await chrome.storage.local.set({ stt_audio_device: 'default' });
				} catch (fallbackError) {
					console.error('Error with fallback recording:', fallbackError);
					alert('Failed to access microphone. Please check permissions.');
				}
			} else {
				alert('Failed to access microphone. Please check permissions.');
			}
		}
	}

	function stopRecording() {
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.stop();
			mediaRecorder.onstop = async () => {
				currentState = 'loading';
				updateMicButton();

				try {
					const transcription = await transcribeAudio();
					const storage = await chrome.storage.local.get('stt_auto_send');
					const autoSend = storage.stt_auto_send || false;
					insertTextAndSend(transcription, autoSend);

					audioChunks = [];
					currentState = 'idle';
					updateMicButton();
				} catch (error) {
					alert('Transcription failed. Please try again.');
					console.error(error);
					audioChunks = [];
					currentState = 'idle';
					updateMicButton();
				}
			};

			if (audioStream) {
				audioStream.getTracks().forEach(track => track.stop());
				audioStream = null;
			}
		}
	}

	async function transcribeAudio() {
		const storage = await chrome.storage.local.get('groq_api_key');
		const apiKey = storage.groq_api_key;

		if (!apiKey) {
			alert('Please set your Groq API key in settings first.');
			throw new Error('No API key');
		}

		const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
		const formData = new FormData();
		formData.append('file', audioBlob, 'recording.webm');
		formData.append('model', 'whisper-large-v3-turbo');
		formData.append('temperature', '0');
		formData.append('response_format', 'text');

		const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`
			},
			body: formData
		});

		if (response.ok) {
			return await response.text();
		} else {
			console.error('Transcription failed:', response);
			throw new Error('Transcription failed');
		}
	}

	// ======== TEXT INSERTION ========
	function insertTextAndSend(text, autoSend) {
		// Check if we're using the simple textarea (from typing lag fix)
		const simpleTextarea = document.querySelector('.claude-simple-input');
		if (simpleTextarea) {
			simpleTextarea.value = text;
			simpleTextarea.dispatchEvent(new Event('input', { bubbles: true }));

			if (autoSend) {
				// Find and click the custom or original submit button
				const submitButton = document.querySelector('.claude-custom-submit') ||
					document.querySelector('button[aria-label="Send message"]');
				if (submitButton && !submitButton.disabled) {
					submitButton.click();
				}
			}
		} else {
			// Original ProseMirror approach
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
		createClaudeTooltip(button, 'STT Settings');

		return button;
	}

	function createMicButton() {
		// Create container that will hold either one button or two
		const container = document.createElement('div');
		container.className = 'stt-mic-container inline-flex gap-1 mr-2';
		container.style.display = 'inline-flex'; // Ensure inline to stay on same line

		updateMicButton(container);
		return container;
	}

	function updateMicButton(container) {
		if (!container) {
			container = document.querySelector('.stt-mic-container');
			if (!container) return;
		}

		// Clear container
		container.innerHTML = '';

		// Create the button element
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
		// Check if STT is enabled
		const storage = await chrome.storage.local.get('stt_enabled');
		const enabled = storage.stt_enabled || false;

		if (!enabled) {
			// Remove button if it exists
			const existing = document.querySelector('.stt-mic-container');
			if (existing) existing.remove();
			return;
		}

		// Check if button already exists
		if (document.querySelector('.stt-mic-container')) return;

		// Find the send button
		const sendButton = document.querySelector('button[aria-label="Send message"]');
		if (!sendButton) return;

		const container = sendButton.parentElement;
		if (!container) return;

		const micContainer = createMicButton();

		// Make sure parent is flex to keep buttons on same line
		container.style.display = 'flex';
		container.style.alignItems = 'center';

		// Insert before send button to put it on the left
		container.insertBefore(micContainer, sendButton);
	}

	// ======== INITIALIZATION ========
	function initialize() {
		// Add spinner CSS once
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

		// Check every second for both buttons
		setInterval(async () => {
			tryAddTopRightButton("stt-settings-button", createSettingsButton);
			await tryAddMicButton();
		}, 1000);
	}

	// Wait for DOM to be ready before initializing
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		// DOM is already ready
		initialize();
	}
})();