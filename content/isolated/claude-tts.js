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

	//#region Provider Instance
	let ttsProvider = null;

	function initializeProvider(providerKey, onStateChange) {
		const providerInfo = window.TTSProviders.TTS_PROVIDERS[providerKey];
		if (!providerInfo) {
			console.error('Unknown provider:', providerKey);
			return null;
		}
		return new providerInfo.class(onStateChange);
	}

	// Initialize with default
	(async () => {
		const settings = await loadSettings();
		ttsProvider = initializeProvider(settings.provider, (state, isProcessing) => {
			updateSettingsButton(state, isProcessing);
		});
	})();

	function updateSettingsButton(state, isProcessing) {
		console.log('[updateSettingsButton] Called with:', { state, isProcessing });

		const button = document.querySelector('.tts-settings-button');
		if (!button) {
			console.log('[updateSettingsButton] Button not found in DOM');
			return;
		}

		console.log('[updateSettingsButton] Button found, updating...');

		if (state === 'loading' || state === 'stopping') {
			console.log('[updateSettingsButton] Setting loading/stopping state');
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
			button.tooltip?.updateText(state === 'loading' ? 'Loading audio...' : 'Stopping...');
		} else if (state === 'playing' || isProcessing) {
			console.log('[updateSettingsButton] Setting playing state');
			button.innerHTML = PAUSE_ICON;
			button.tooltip?.updateText('Stop playback');
		} else {
			console.log('[updateSettingsButton] Setting idle state');
			button.innerHTML = SPEAKER_ICON;
			button.tooltip?.updateText('TTS Settings');
		}
	}
	//#endregion

	//#region Actor Mode Implementation
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
			return ttsProvider.play(text, defaultVoiceId, settings.model, settings.apiKey);
		}

		// Actor mode is enabled - get character configurations
		const charactersResult = await chrome.storage.local.get(`chatCharacters_${conversationId}`);
		const characters = charactersResult[`chatCharacters_${conversationId}`] || [];

		if (characters.length === 0) {
			console.log('Actor mode enabled but no characters configured, using default voice');
			return ttsProvider.play(text, defaultVoiceId, settings.model, settings.apiKey);
		}

		try {
			// Start actor mode session
			const sessionId = await ttsProvider.startSession();

			console.log('Getting dialogue attribution for actor mode...');

			// Start the attribution request but DON'T await it yet
			const attributionPromise = ttsProvider.attributeDialogueToCharacters(text, characters, settings.model);

			// Check periodically if we've been interrupted while waiting
			const checkInterval = setInterval(() => {
				if (ttsProvider.getCurrentSessionId() !== sessionId) {
					clearInterval(checkInterval);
					console.log('Attribution cancelled - user interrupted');
				}
			}, 100);

			// Now await the attribution
			const segments = await attributionPromise;
			clearInterval(checkInterval);

			// Check if we should still use these results
			if (ttsProvider.getCurrentSessionId() !== sessionId) {
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

			// Merge consecutive segments from the same character with matching extra
			const mergedSegments = [];
			let currentSegment = null;

			for (const segment of segments) {
				const characterName = segment.character.toLowerCase();
				const extraStr = JSON.stringify(segment.extra || {});

				if (currentSegment &&
					currentSegment.character === characterName &&
					currentSegment.extraStr === extraStr) {
					currentSegment.text += ' ' + segment.text;
				} else {
					if (currentSegment) {
						mergedSegments.push(currentSegment);
					}
					currentSegment = {
						character: characterName,
						text: segment.text,
						extra: segment.extra || {},
						extraStr: extraStr
					};
				}
			}

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

				await ttsProvider.queue(
					segment.text,
					voice,
					settings.model,
					settings.apiKey,
					segment.extra
				);
			}

			// Wait for all segments to complete
			await ttsProvider.waitForCompletion();

		} catch (error) {
			console.error('Actor mode failed, falling back to regular playback:', error);
			return ttsProvider.play(text, defaultVoiceId, settings.model, settings.apiKey);
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
				showClaudeAlert('Error', 'Failed to capture message text');
				return;
			}

			// Get settings
			const settings = await loadSettings();
			const conversationId = getConversationId();


			const quotesResult = await chrome.storage.local.get(`chatQuotesOnly_${conversationId}`);
			const quotesOnly = quotesResult[`chatQuotesOnly_${conversationId}`] === true; // Explicitly check for true

			if (ttsProvider && ttsProvider.requiresApiKey && settings.apiKey) {
				const isValid = await ttsProvider.testApiKey(settings.apiKey);
				if (!isValid) {
					showClaudeAlert('API Key Error', 'Invalid API key.');
					return;
				}
			} else if (ttsProvider.requiresApiKey && !settings.apiKey) {
				showClaudeAlert('API Key Required', 'Provider requires an API key. Please enter one.');
				return;
			}

			// Process text with per-chat quotes setting
			const finalText = cleanupText(text, quotesOnly);
			if (!finalText) {
				showClaudeAlert('No Text Available', 'No text to speak' + (quotesOnly ? ' (no quoted text found)' : ''));
				return;
			}

			// Start playback (will handle stopping existing playback internally)
			try {
				await playText(finalText, settings, conversationId);
			} catch (error) {
				showClaudeAlert('Playback Error', 'Failed to play audio: ' + error.message);
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
				showClaudeAlert('Error', 'Could not find copy button');
				return;
			}

			// Rest of the code remains the same...
			isCapturingText = true;
			capturedText = null;

			copyButton.click();

			await new Promise(resolve => setTimeout(resolve, 100));

			isCapturingText = false;

			if (!capturedText) {
				showClaudeAlert('Error', 'Failed to capture artifact text');
				return;
			}

			const settings = await loadSettings();
			const conversationId = getConversationId();


			const quotesResult = await chrome.storage.local.get(`chatQuotesOnly_${conversationId}`);
			const quotesOnly = quotesResult[`chatQuotesOnly_${conversationId}`] === true;

			if (ttsProvider && ttsProvider.requiresApiKey && settings.apiKey) {
				const isValid = await ttsProvider.testApiKey(settings.apiKey);
				if (!isValid) {
					showClaudeAlert('API Key Error', 'Invalid API key.');
					return;
				}
			} else if (ttsProvider.requiresApiKey && !settings.apiKey) {
				showClaudeAlert('API Key Required', 'Provider requires an API key. Please enter one.');
				return;
			}

			const finalText = cleanupText(capturedText, quotesOnly);
			if (!finalText) {
				showClaudeAlert('No Text Available', 'No text to speak' + (quotesOnly ? ' (no quoted text found)' : ''));
				return;
			}

			try {
				await playText(finalText, settings, conversationId);
			} catch (error) {
				showClaudeAlert('Playback Error', 'Failed to play audio: ' + error.message);
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
	//#region Settings Modal
	async function createSettingsModal() {
		// Show loading modal immediately
		const loadingModal = createLoadingModal('Loading settings...');
		loadingModal.show();

		try {
			const settings = await loadSettings();
			const conversationId = getConversationId();

			// Load per-chat settings
			const [quotesResult, voiceResult, actorResult] = await Promise.all([
				chrome.storage.local.get(`chatQuotesOnly_${conversationId}`),
				chrome.storage.local.get(`chatVoice_${conversationId}`),
				chrome.storage.local.get(`chatActorMode_${conversationId}`)
			]);

			const providerOptions = Object.entries(window.TTSProviders.TTS_PROVIDERS).map(([key, info]) => ({
				value: key,
				label: info.name
			}));
			const currentProviderInfo = window.TTSProviders.TTS_PROVIDERS[settings.provider];

			const chatQuotesOnly = quotesResult[`chatQuotesOnly_${conversationId}`] === true;
			const chatVoiceOverride = voiceResult[`chatVoice_${conversationId}`] || '';
			const actorModeEnabled = actorResult[`chatActorMode_${conversationId}`] === true;

			// Load voices and models if API key exists
			let voices = [];
			let models = [];
			if (settings.apiKey && currentProviderInfo.requiresApiKey) {
				const tempProvider = initializeProvider(settings.provider, null);
				[voices, models] = await Promise.all([
					tempProvider.getVoices(settings.apiKey),
					tempProvider.getModels(settings.apiKey)
				]);
			} else if (!currentProviderInfo.requiresApiKey) {
				const tempProvider = initializeProvider(settings.provider, null);
				[voices, models] = await Promise.all([
					tempProvider.getVoices(),
					tempProvider.getModels()
				]);
			}

			// Close loading modal and show the actual settings modal
			loadingModal.destroy();

			// Build content
			const content = document.createElement('div');

			// Enable TTS toggle
			const enableSection = document.createElement('div');
			enableSection.className = 'mb-4';
			const enabledToggle = createClaudeToggle('Enable TTS', settings.enabled, null);
			enableSection.appendChild(enabledToggle.container);
			content.appendChild(enableSection);

			// Provider select
			const providerSection = document.createElement('div');
			providerSection.className = 'mb-4';
			const providerLabel = document.createElement('label');
			providerLabel.className = CLAUDE_CLASSES.LABEL;
			providerLabel.textContent = 'TTS Provider';
			providerSection.appendChild(providerLabel);
			const providerSelect = createClaudeSelect(providerOptions, settings.provider);
			providerSelect.id = 'providerSelect';
			providerSection.appendChild(providerSelect);
			content.appendChild(providerSection);

			// API Key input
			const apiKeySection = document.createElement('div');
			apiKeySection.className = 'mb-4';
			apiKeySection.id = 'apiKeySection';
			apiKeySection.style.display = currentProviderInfo.requiresApiKey ? 'block' : 'none';
			const apiKeyLabel = document.createElement('label');
			apiKeyLabel.className = CLAUDE_CLASSES.LABEL;
			apiKeyLabel.textContent = 'API Key';
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

			const voiceOptions = voices.length > 0
				? voices.map(v => ({ value: v.voice_id, label: v.name || `${v.name} (${v.voice_id})` }))
				: [{ value: '', label: currentProviderInfo.requiresApiKey ? 'Set an API key...' : 'Loading...' }];
			const voiceSelect = createClaudeSelect(voiceOptions, settings.voice || '');
			voiceSelect.id = 'voiceSelect';
			voiceSelect.disabled = currentProviderInfo.requiresApiKey && !settings.apiKey;
			voiceSection.appendChild(voiceSelect);
			content.appendChild(voiceSection);

			// Model select
			const modelSection = document.createElement('div');
			modelSection.className = 'mb-4';
			const modelLabel = document.createElement('label');
			modelLabel.className = CLAUDE_CLASSES.LABEL;
			modelLabel.textContent = 'Model';
			modelSection.appendChild(modelLabel);

			const modelOptions = models.length > 0
				? models.map(m => ({ value: m.model_id, label: m.name }))
				: [{ value: '', label: currentProviderInfo.requiresApiKey ? 'Set an API key...' : 'Loading...' }];
			const modelSelect = createClaudeSelect(modelOptions, settings.model || '');
			modelSelect.id = 'modelSelect';
			modelSelect.disabled = currentProviderInfo.requiresApiKey && !settings.apiKey;
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
			createClaudeTooltip(quotesOnlyToggle.container, 'Quick dialogue-only playback using regex (instant, no API call)');
			quotesSection.appendChild(quotesOnlyToggle.container);
			perChatSection.appendChild(quotesSection);

			// Voice override select
			const overrideSection = document.createElement('div');
			overrideSection.className = 'mb-4';
			const overrideLabel = document.createElement('label');
			overrideLabel.className = CLAUDE_CLASSES.LABEL;
			overrideLabel.textContent = 'Voice Override';
			overrideSection.appendChild(overrideLabel);

			const overrideOptions = [
				{ value: '', label: 'Use default voice' },
				...voiceOptions.filter(opt => opt.value) // Exclude "Set an API key..." option
			];
			const chatVoiceOverrideSelect = createClaudeSelect(overrideOptions, chatVoiceOverride);
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
			createClaudeTooltip(actorModeToggle.container, 'Multi-voice character assignment with AI attribution (+latency)');
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

			// Create modal with new class
			const modal = new ClaudeModal('TTS Settings', content);

			modal.addCancel('Cancel');
			modal.addConfirm('Save', async () => {
				const newSettings = {
					enabled: enabledToggle.input.checked,
					provider: providerSelect.value,
					apiKey: apiKeyInput.value.trim(),
					voice: voiceSelect.value,
					model: modelSelect.value,
					autoSpeak: autoSpeakToggle.input.checked
				};

				// Verify API key if provider requires it
				const providerInfo = window.TTSProviders.TTS_PROVIDERS[newSettings.provider];
				if (providerInfo.requiresApiKey && newSettings.apiKey) {
					const tempProvider = initializeProvider(newSettings.provider, null);
					const isValid = await tempProvider.testApiKey(newSettings.apiKey);

					if (!isValid) {
						showClaudeAlert('API Key Error', `Invalid ${providerInfo.name} API key. Please check your key and try again.`);
						return; // Don't save, keep modal open
					}
				} else if (providerInfo.requiresApiKey && !newSettings.apiKey) {
					showClaudeAlert('API Key Required', `${providerInfo.name} requires an API key. Please enter one.`);
					return; // Don't save, keep modal open
				}

				// Handle per-chat settings
				if (conversationId) {
					// Enforce mutual exclusivity: if both are checked (shouldn't happen due to UI logic),
					// prioritize actor mode
					const quotesOnlyValue = quotesOnlyToggle.input.checked;
					const actorModeValue = actorModeToggle.input.checked;

					if (quotesOnlyValue && actorModeValue) {
						// Shouldn't happen, but if it does, prefer actor mode
						await chrome.storage.local.set({
							[`chatQuotesOnly_${conversationId}`]: false,
							[`chatActorMode_${conversationId}`]: true
						});
					} else {
						await chrome.storage.local.set({
							[`chatQuotesOnly_${conversationId}`]: quotesOnlyValue,
							[`chatActorMode_${conversationId}`]: actorModeValue
						});
					}

					const chatOverride = chatVoiceOverrideSelect.value;
					if (chatOverride) {
						await chrome.storage.local.set({ [`chatVoice_${conversationId}`]: chatOverride });
					} else {
						await chrome.storage.local.remove(`chatVoice_${conversationId}`);
					}
				}

				// Reinitialize provider if changed
				if (newSettings.provider !== settings.provider) {
					ttsProvider = initializeProvider(newSettings.provider, (state, isProcessing) => {
						updateSettingsButton(state, isProcessing);
					});
				}

				await saveSettings(newSettings);

				// Update button visibility based on enabled state
				if (!newSettings.enabled) {
					removeAllSpeakButtons();
				}
			});

			// Handle mutual exclusivity between quotes-only and actor mode
			quotesOnlyToggle.input.addEventListener('change', (e) => {
				if (e.target.checked) {
					// Turn off actor mode when quotes-only is enabled
					actorModeToggle.input.checked = false;
					configureActorsBtn.style.display = 'none';
				}
			});

			actorModeToggle.input.addEventListener('change', (e) => {
				if (e.target.checked) {
					// Turn off quotes-only when actor mode is enabled
					quotesOnlyToggle.input.checked = false;
				}
				// Also update configure button visibility
				configureActorsBtn.style.display = e.target.checked ? 'block' : 'none';
			});

			// Configure actors button
			configureActorsBtn.onclick = async () => {
				const currentApiKey = apiKeyInput.value.trim();
				const currentProviderKey = providerSelect.value;
				await createActorConfigModal(currentApiKey, currentProviderKey);
			};

			// Handle provider change
			providerSelect.addEventListener('change', async (e) => {
				const newProviderKey = e.target.value;
				const newProviderInfo = window.TTSProviders.TTS_PROVIDERS[newProviderKey];

				// Show/hide API key section
				apiKeySection.style.display = newProviderInfo.requiresApiKey ? 'block' : 'none';

				// Reset voices and models
				voiceSelect.innerHTML = '<option value="">Loading...</option>';
				voiceSelect.disabled = true;
				modelSelect.innerHTML = '<option value="">Loading...</option>';
				modelSelect.disabled = true;

				const tempProvider = initializeProvider(newProviderKey, null);

				try {
					let newVoices, newModels;
					if (newProviderInfo.requiresApiKey) {
						const currentApiKey = apiKeyInput.value.trim();
						if (!currentApiKey) {
							voiceSelect.innerHTML = '<option value="">Set an API key...</option>';
							modelSelect.innerHTML = '<option value="">Set an API key...</option>';
							return;
						}
						[newVoices, newModels] = await Promise.all([
							tempProvider.getVoices(currentApiKey),
							tempProvider.getModels(currentApiKey)
						]);
					} else {
						[newVoices, newModels] = await Promise.all([
							tempProvider.getVoices(),
							tempProvider.getModels()
						]);
					}

					const newVoiceOptions = newVoices.map(v => ({
						value: v.voice_id,
						label: v.name || `${v.name} (${v.voice_id})`
					}));
					populateSelect(voiceSelect, newVoiceOptions);

					const newModelOptions = newModels.map(m => ({ value: m.model_id, label: m.name }));
					populateSelect(modelSelect, newModelOptions);
				} catch (error) {
					console.error('Failed to load provider data:', error);
					voiceSelect.innerHTML = '<option value="">Failed to load</option>';
					modelSelect.innerHTML = '<option value="">Failed to load</option>';
				}
			});

			// Handle API key changes
			apiKeyInput.addEventListener('change', async (e) => {
				const newKey = e.target.value.trim();
				const currentProviderKey = providerSelect.value;
				const currentProviderInfo = window.TTSProviders.TTS_PROVIDERS[currentProviderKey];

				if (!currentProviderInfo.requiresApiKey) return;

				if (newKey) {
					// Show inline loading state
					voiceSelect.innerHTML = '<option value="">Loading...</option>';
					voiceSelect.disabled = true;
					modelSelect.innerHTML = '<option value="">Loading...</option>';
					modelSelect.disabled = true;
					chatVoiceOverrideSelect.innerHTML = '<option value="">Loading...</option>';
					chatVoiceOverrideSelect.disabled = true;

					const tempProvider = initializeProvider(currentProviderKey, null);
					const isValid = await tempProvider.testApiKey(newKey);
					if (isValid) {
						const [newVoices, newModels] = await Promise.all([
							tempProvider.getVoices(newKey),
							tempProvider.getModels(newKey)
						]);

						const newVoiceOptions = newVoices.map(v => ({
							value: v.voice_id,
							label: `${v.name} (${v.voice_id})`
						}));
						populateSelect(voiceSelect, newVoiceOptions);

						chatVoiceOverrideSelect.innerHTML = '<option value="">Use default voice</option>';
						newVoiceOptions.forEach(opt => {
							const option = document.createElement('option');
							option.value = opt.value;
							option.textContent = opt.label;
							chatVoiceOverrideSelect.appendChild(option);
						});
						chatVoiceOverrideSelect.disabled = false;

						const newModelOptions = newModels.map(m => ({ value: m.model_id, label: m.name }));
						populateSelect(modelSelect, newModelOptions);
					} else {
						showClaudeAlert('API Key Error', 'Invalid API key');
						e.target.value = settings.apiKey || '';

						// Restore original state
						populateSelect(voiceSelect, voiceOptions, settings.voice);
						populateSelect(modelSelect, modelOptions, settings.model);
						chatVoiceOverrideSelect.innerHTML = '<option value="">Use default voice</option>';
						voiceOptions.filter(opt => opt.value).forEach(opt => {
							const option = document.createElement('option');
							option.value = opt.value;
							option.textContent = opt.label;
							chatVoiceOverrideSelect.appendChild(option);
						});
						chatVoiceOverrideSelect.value = chatVoiceOverride;
						chatVoiceOverrideSelect.disabled = !settings.apiKey;
					}
				}
			});

			modal.show();

		} catch (error) {
			loadingModal.destroy();
			showClaudeAlert('Error', 'Failed to load settings: ' + error.message);
			console.error('Settings modal error:', error);
		}
	}

	async function createActorConfigModal(apiKey, providerKey) {
		// Show loading modal immediately
		const loadingModal = createLoadingModal('Loading voices...');
		loadingModal.show();

		try {
			const conversationId = getConversationId();
			const charactersResult = await chrome.storage.local.get(`chatCharacters_${conversationId}`);
			let characters = charactersResult[`chatCharacters_${conversationId}`] || [];

			// Ensure narrator exists
			if (!characters.find(c => c.name.toLowerCase() === 'narrator')) {
				characters = [{ name: 'Narrator', gender: 'other', voice: '' }, ...characters];
			}

			// Load available voices
			const tempProvider = initializeProvider(providerKey, null);
			const providerInfo = window.TTSProviders.TTS_PROVIDERS[providerKey];

			let voices = [];
			if (providerInfo.requiresApiKey && apiKey) {
				voices = await tempProvider.getVoices(apiKey);
			} else if (!providerInfo.requiresApiKey) {
				voices = await tempProvider.getVoices();
			}

			// Close loading modal
			loadingModal.destroy();

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

			const removeBtn = createClaudeButton(
				'<span class="flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 16 16"><path d="M3 8h10" stroke-linecap="round"/></svg>Remove Last</span>',
				'secondary',
				null,
				true
			);

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
				warningDiv.textContent = 'Could not load voices. Please check your API key.';
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
			const narratorChar = characters.find(c => c.name.toLowerCase() === 'narrator') ||
				{ name: 'Narrator', gender: 'other', voice: '' };
			charactersList.appendChild(createCharacterRow(narratorChar, true));

			characters.filter(c => c.name.toLowerCase() !== 'narrator').forEach(character => {
				charactersList.appendChild(createCharacterRow(character, false));
			});

			if (characters.filter(c => c.name.toLowerCase() !== 'narrator').length === 0) {
				charactersList.appendChild(createCharacterRow());
			}

			// Add character button
			addBtn.onclick = () => {
				charactersList.appendChild(createCharacterRow());
			};

			// Remove character button
			removeBtn.onclick = () => {
				const rows = charactersList.querySelectorAll('.character-row:not(.narrator-row)');
				if (rows.length > 1) {
					rows[rows.length - 1].remove();
				} else if (rows.length === 1) {
					rows[0].querySelector('.character-name').value = '';
					rows[0].querySelector('.character-gender').value = 'male';
					rows[0].querySelector('.character-voice').value = '';
				}
			};

			// Create the modal
			const modal = new ClaudeModal('Character Voice Configuration', contentContainer);

			modal.addCancel('Cancel');
			modal.addConfirm('Save', async () => {
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
			});

			// Adjust modal width
			modal.modal.style.maxWidth = '700px';
			modal.modal.style.width = '90%';

			modal.show();

		} catch (error) {
			loadingModal.destroy();
			showClaudeAlert('Error', 'Failed to load character configuration: ' + error.message);
			console.error('Actor config modal error:', error);
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

	async function loadSettings() {
		const result = await chrome.storage.local.get([
			'tts_enabled',
			'tts_provider',  // NEW
			'tts_apiKey',
			'tts_voice',
			'tts_model',
			'tts_autoSpeak'
		]);

		return {
			enabled: result.tts_enabled || false,
			provider: result.tts_provider || 'elevenlabs',  // NEW - default to elevenlabs
			apiKey: result.tts_apiKey || '',
			voice: result.tts_voice || '',
			model: result.tts_model || 'eleven_multilingual_v2',
			autoSpeak: result.tts_autoSpeak || false
		};
	}

	async function saveSettings(settings) {
		await chrome.storage.local.set({
			'tts_enabled': settings.enabled,
			'tts_provider': settings.provider,  // NEW
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
			if (ttsProvider && ttsProvider.isActive()) {
				ttsProvider.stop();
			} else {
				await createSettingsModal();
			}
		});

		button.classList.add('tts-settings-button'); // Keep for identification/priority
		return button;
	}
	//#endregion

	//#region Initialization
	let currentUrl = window.location.href;

	setInterval(() => {
		if (window.location.href !== currentUrl) {
			currentUrl = window.location.href;
			// Stop playback on navigation
			if (ttsProvider.isActive()) {
				ttsProvider.stop();
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
		tryAddTopRightButton("tts-settings-button", createSettingsButton, "TTS Settings", true);
		setInterval(() => tryAddTopRightButton('tts-settings-button', createSettingsButton, "TTS Settings", true), 1000);
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