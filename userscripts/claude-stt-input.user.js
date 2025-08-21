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

	// ======== POLYGLOT SETUP ========
	if (typeof unsafeWindow === 'undefined') unsafeWindow = window;

	let setStorageValue, getStorageValue, deleteStorageValue, makeHttpRequest;

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

		makeHttpRequest = GM_xmlhttpRequest;
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

		// Polyfill for GM_xmlhttpRequest in extension mode
		makeHttpRequest = (details) => {
			return new Promise((resolve) => {
				const requestId = Math.random().toString(36).substr(2, 9);

				const listener = (event) => {
					if (event.data.type === 'GM_xmlhttpRequest_response' &&
						event.data.requestId === requestId) {
						window.removeEventListener('message', listener);

						if (event.data.error) {
							details.onerror && details.onerror(new Error(event.data.error));
						} else {
							details.onload && details.onload({
								responseText: event.data.responseText,
								status: event.data.status,
								statusText: event.data.statusText,
								responseHeaders: event.data.responseHeaders
							});
						}
						resolve();
					}
				};

				window.addEventListener('message', listener);

				window.postMessage({
					type: 'GM_xmlhttpRequest',
					requestId: requestId,
					details: details  // FormData passes through as-is
				}, '*');
			});
		};
	}

	// ======== STATE AND SETTINGS ========
	let mediaRecorder = null;
	let audioChunks = [];
	let audioStream = null;
	let micButton = null;
	let currentState = 'idle'; // idle, recording, review

	// ======== SETTINGS MANAGEMENT ========
	async function showSettingsModal() {
		const apiKey = await getStorageValue('groq_api_key', '');
		const autoSend = await getStorageValue('stt_auto_send', false);
		const sttEnabled = await getStorageValue('stt_enabled', false);

		const modal = document.createElement('div');
		modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';

		modal.innerHTML = `
            <div class="bg-bg-100 rounded-lg p-6 shadow-xl max-w-md w-full mx-4 border border-border-300">
                <h3 class="text-lg font-semibold mb-4 text-text-100">STT Settings</h3>

                <div class="mb-4">
					<label class="flex items-center text-text-100">
						<input type="checkbox" 
							id="sttEnabled" 
							${sttEnabled ? 'checked' : ''} 
							class="mr-2">
						Enable Speech-to-Text
					</label>
				</div>

                <div class="mb-4">
                    <label class="block text-sm font-medium text-text-200 mb-1">Groq API Key</label>
                    <input type="password" 
                           id="groqApiKey" 
                           value="${apiKey}"
                           placeholder="gsk_..." 
                           class="w-full p-2 rounded bg-bg-200 text-text-100 border border-border-300">
                </div>
                
                <div class="mb-4">
                    <label class="flex items-center text-text-100">
                        <input type="checkbox" 
                               id="autoSendCheck" 
                               ${autoSend ? 'checked' : ''} 
                               class="mr-2">
                        Auto-send after transcription
                    </label>
                </div>
                
                <div class="flex justify-end gap-2">
                    <button class="px-4 py-2 text-text-200 hover:bg-bg-500/40 rounded" id="cancelSettings">Cancel</button>
                    <button class="px-4 py-2 bg-accent-main-100 text-oncolor-100 rounded" id="saveSettings">Save</button>
                </div>
            </div>
        `;

		document.body.appendChild(modal);

		return new Promise((resolve) => {
			modal.querySelector('#cancelSettings').onclick = () => {
				modal.remove();
				resolve(false);
			};

			modal.querySelector('#saveSettings').onclick = async () => {
				const newKey = modal.querySelector('#groqApiKey').value.trim();
				const newAutoSend = modal.querySelector('#autoSendCheck').checked;
				const newEnabled = modal.querySelector('#sttEnabled').checked;

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
			mediaRecorder.onstop = () => {
				currentState = 'review';
				updateMicButton();
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
		button.className = `inline-flex items-center justify-center relative shrink-0 ring-offset-2 ring-offset-bg-300 
            ring-accent-main-100 focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none 
            disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none text-text-200 border-transparent 
            transition-colors font-styrene active:bg-bg-400 hover:bg-bg-500/40 hover:text-text-100 h-9 w-9 
            rounded-md active:scale-95 shrink-0`;

		button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>`;

		// Add tooltip
		const tooltipWrapper = document.createElement('div');
		tooltipWrapper.setAttribute('data-radix-popper-content-wrapper', '');
		tooltipWrapper.style.cssText = `
            position: fixed;
            left: 0px;
            top: 0px;
            min-width: max-content;
            z-index: 50;
            display: none;
        `;

		tooltipWrapper.innerHTML = `
            <div class="px-2 py-1 text-xs font-normal font-ui leading-tight rounded-md shadow-md text-white bg-black/80 backdrop-blur break-words z-tooltip max-w-[13rem]">
                STT Settings
            </div>
        `;

		button.addEventListener('mouseenter', () => {
			tooltipWrapper.style.display = 'block';
			const rect = button.getBoundingClientRect();
			const tooltipRect = tooltipWrapper.getBoundingClientRect();
			const centerX = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
			tooltipWrapper.style.transform = `translate(${centerX}px, ${rect.bottom + 5}px)`;
		});

		button.addEventListener('mouseleave', () => {
			tooltipWrapper.style.display = 'none';
		});

		button.onclick = showSettingsModal;

		document.body.appendChild(tooltipWrapper);
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

		switch (currentState) {
			case 'idle':
			case 'recording':
			case 'loading':
				// Single button for these states
				const button = document.createElement('button');
				button.className = `inline-flex items-center justify-center relative shrink-0 
                disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none 
                disabled:drop-shadow-none text-white transition-colors h-8 w-8 rounded-lg active:scale-95`;
				button.style.backgroundColor = '#2c84db';
				button.style.cssText += 'background-color: #2c84db !important;';

				button.onmouseover = () => button.style.backgroundColor = '#2573c4';
				button.onmouseout = () => button.style.backgroundColor = '#2c84db';

				if (currentState === 'idle') {
					button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
						<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
						<line x1="12" y1="19" x2="12" y2="23"></line>
						<line x1="8" y1="23" x2="16" y2="23"></line>
					</svg>`;
					button.onclick = startRecording;
				} else if (currentState === 'recording') {
					button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2"></rect>
                </svg>`;
					button.onclick = stopRecording;
				} else if (currentState === 'loading') {
					button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                </svg>`;
					button.disabled = true;
				}

				container.appendChild(button);
				break;

			case 'review':
				// Two separate buttons for review
				const trashButton = document.createElement('button');
				trashButton.className = `inline-flex items-center justify-center relative shrink-0 
                disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none 
                disabled:drop-shadow-none text-white transition-colors h-8 w-8 rounded-lg active:scale-95`;
				trashButton.style.cssText = 'background-color: #ef4444 !important;';

				trashButton.onmouseover = () => trashButton.style.backgroundColor = '#dc2626 !important';
				trashButton.onmouseout = () => trashButton.style.backgroundColor = '#ef4444 !important';

				trashButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18"></path>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                <path d="M10 11v6"></path>
                <path d="M14 11v6"></path>
            </svg>`;
				trashButton.onclick = () => {
					audioChunks = [];
					currentState = 'idle';
					updateMicButton();
				};

				const sendButton = document.createElement('button');
				sendButton.className = `inline-flex items-center justify-center relative shrink-0 
                disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none 
                disabled:drop-shadow-none text-white transition-colors h-8 w-8 rounded-lg active:scale-95`;
				sendButton.style.backgroundColor = '#2c84db';
				sendButton.style.cssText += 'background-color: #2c84db !important;';

				sendButton.onmouseover = () => sendButton.style.backgroundColor = '#2573c4';
				sendButton.onmouseout = () => sendButton.style.backgroundColor = '#2c84db';

				// Using the airplane/send icon instead of arrow
				sendButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 2L11 13"></path>
                <path d="M22 2L15 22L11 13L2 9L22 2Z"></path>
            </svg>`;
				sendButton.onclick = async () => {
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
						currentState = 'idle';
						updateMicButton();
					}
				};

				container.appendChild(trashButton);
				container.appendChild(sendButton);
				break;
		}
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