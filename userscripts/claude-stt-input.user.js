// ==UserScript==
// @name         Claude STT (BYOK Groq)
// @namespace    lugia19.com
// @match        https://claude.ai/*
// @version      1.0.0
// @author       lugia19
// @license      MIT
// @description  Adds speech-to-text to Claude using Groq's Whisper API (bring your own key)
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      api.groq.com
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


	// ======== STATE AND SETTINGS ========
	let mediaRecorder = null;
	let audioChunks = [];
	let audioStream = null;
	let micButton = null;
	let currentState = 'idle'; // idle, recording, loading

	// ======== SETTINGS MANAGEMENT ========
	async function showSettingsModal() {
		const apiKey = await getStorageValue('groq_api_key', '');
		const autoSend = await getStorageValue('stt_auto_send', false);
		const sttEnabled = await getStorageValue('stt_enabled', false);

		const modal = document.createElement('div');
		modal.className = 'claude-modal-backdrop';

		modal.innerHTML = `
    	<div class="claude-modal">
        <h3 class="claude-modal-heading">STT Settings</h3>

        <div class="mb-4" id="sttEnabledContainer"></div>
			<div class="mb-4">
				<label class="claude-label">Groq API Key</label>
				<input type="password" 
					id="groqApiKey" 
					value="${apiKey}"
					placeholder="gsk_..." 
					class="claude-input">
			</div>
			
			<div class="mb-4" id="autoSendContainer"></div>
			
			<div class="flex justify-end gap-2">
				<button class="claude-btn-secondary" id="cancelSettings">Cancel</button>
				<button class="claude-btn-primary" id="saveSettings">Save</button>
			</div>
		</div>
        `;

		document.body.appendChild(modal);
		// Create and insert toggles
		const sttEnabledToggle = createClaudeToggle('Enable Speech-to-Text', sttEnabled);
		modal.querySelector('#sttEnabledContainer').appendChild(sttEnabledToggle.container);

		const autoSendToggle = createClaudeToggle('Auto-send after transcription', autoSend);
		modal.querySelector('#autoSendContainer').appendChild(autoSendToggle.container);
		applyClaudeStyling(modal);

		return new Promise((resolve) => {
			modal.querySelector('#cancelSettings').onclick = () => {
				modal.remove();
				resolve(false);
			};

			modal.querySelector('#saveSettings').onclick = async () => {
				const newKey = modal.querySelector('#groqApiKey').value.trim();
				const newAutoSend = autoSendToggle.input.checked;
				const newEnabled = sttEnabledToggle.input.checked;

				if (newKey && newKey !== apiKey) {
					// Validate the API key
					const isValid = await validateApiKey(newKey);
					if (!isValid) {
						alert('Invalid API key. Please check and try again.');
						return;
					}
				}

				await setStorageValue('groq_api_key', newKey);
				await setStorageValue('stt_auto_send', newAutoSend);
				await setStorageValue('stt_enabled', newEnabled);

				modal.remove();
				resolve(true);
			};

			modal.onclick = (e) => {
				if (e.target === modal) {
					modal.remove();
					resolve(false);
				}
			};
		});
	}

	async function validateApiKey(apiKey) {
		return new Promise((resolve) => {
			makeHttpRequest({
				method: 'POST',
				url: 'https://api.groq.com/openai/v1/audio/transcriptions',
				headers: {
					'Authorization': `Bearer ${apiKey}`
				},
				data: new FormData(), // Empty form data to trigger error
				onload: function (response) {
					// If we get a 400 (missing file) that's actually good - auth worked
					resolve(response.status === 400 || response.status === 200);
				},
				onerror: function () {
					resolve(false);
				}
			});
		});
	}

	// ======== RECORDING FUNCTIONS ========
	async function startRecording() {
		try {
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
		} catch (error) {
			console.error('Error starting recording:', error);
			alert('Failed to access microphone. Please check permissions.');
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
					const autoSend = await getStorageValue('stt_auto_send', false);
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
		const apiKey = await getStorageValue('groq_api_key', '');
		if (!apiKey) {
			alert('Please set your Groq API key in settings first.');
			return;
		}

		const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
		const formData = new FormData();
		formData.append('file', audioBlob, 'recording.webm');
		formData.append('model', 'whisper-large-v3-turbo');
		formData.append('temperature', '0');
		formData.append('response_format', 'text');

		return new Promise((resolve, reject) => {
			makeHttpRequest({
				method: 'POST',
				url: 'https://api.groq.com/openai/v1/audio/transcriptions',
				headers: {
					'Authorization': `Bearer ${apiKey}`
				},
				data: formData,
				onload: function (response) {
					if (response.status === 200) {
						resolve(response.responseText);
					} else {
						console.error('Transcription failed:', response);
						reject(new Error('Transcription failed'));
					}
				},
				onerror: function (error) {
					console.error('Request failed:', error);
					reject(error);
				}
			});
		});
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
		const button = document.createElement('button');
		button.className = 'claude-icon-btn';

		button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>`;

		applyClaudeStyling(button);
		createClaudeTooltip(button, 'STT Settings');

		button.onclick = showSettingsModal;

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
		applyClaudeStyling(button);
	}

	// ======== BUTTON INSERTION ========
	function tryAddTopButton() {
		const buttonCreationFunction = createSettingsButton;
		const buttonClass = 'stt-settings-button';

		const BUTTON_PRIORITY = [
			'style-selector-button',
			'export-button',
			'stt-settings-button'
		];

		const container = document.querySelector(".right-3.flex.gap-2");
		if (!container || container.querySelector('.' + buttonClass) || container.querySelectorAll("button").length == 0) {
			return;
		}

		const button = buttonCreationFunction();
		button.classList.add(buttonClass);

		const myIndex = BUTTON_PRIORITY.indexOf(buttonClass);

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

		container.insertBefore(button, container.firstChild);
	}

	async function tryAddMicButton() {
		// Check if STT is enabled
		const enabled = await getStorageValue('stt_enabled', true);

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
			tryAddTopButton();
			await tryAddMicButton();
		}, 1000);
	}

	initialize();
})();