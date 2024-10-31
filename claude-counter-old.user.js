// ==UserScript==
// @name         Claude Counter
// @namespace    Violentmonkey Scripts
// @match        https://claude.ai/*
// @version      1.0
// @author       lugia19
// @description  Counts tokens in chat messages
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
	'use strict';

	// Storage and Constants
	const STORAGE_KEY = 'chatTokenCounter_v1';
	const MODEL_SELECTOR = '[data-testid="model-selector-dropdown"]';
	const POLL_INTERVAL_MS = 1000;
	const DELAY_MS = 500;

	// Model-specific token limits - just guesstimates for now
	const MODEL_TOKENS = {
		'3.5 Sonnet (New)': 3500000,
		'3.5 Haiku': 2500000,
		'3 Opus': 1500000
	};

	const WARNING_THRESHOLD = 0.9;
	const MAX_FILE_FETCH_ATTEMPTS = 10
	const FILE_FETCH_WAIT_MS = 200
	// Selectors and identifiers
	const SELECTORS = {
		MAIN_INPUT: 'div[aria-label="Write your prompt to Claude"]',
		REGENERATE_BUTTON_PATH: 'M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z',
		SAVE_BUTTON: 'button[type="submit"]',
		EDIT_TEXTAREA: '.font-user-message textarea',
		USER_MESSAGE: '[data-testid="user-message"]',
		AI_MESSAGE: '.font-claude-message',
		SEND_BUTTON: 'button[aria-label="Send Message"]',
		FILE_CONTENT: '.whitespace-pre-wrap.break-all.text-xs',
		CLOSE_BUTTON: '[data-testid="close-file-preview"]',
		FILE_TITLE: '.font-styrene-display.truncate',
	};


	let totalTokenCount = 0;
	let currentTokenCount = 0;
	let currentModel = getCurrentModel();

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	async function getFileTokens(fileButton) {
		try {
			const fileContainer = fileButton.closest('div[data-testid]');
			if (!fileContainer) {
				console.log('Could not find file container');
				return 0;
			}

			const filename = fileContainer.getAttribute('data-testid');
			console.log('Processing file:', filename);

			const conversationId = getConversationId();
			if (!conversationId) {
				console.log('Not in a conversation, skipping file');
				return 0;
			}

			const storageKey = `${STORAGE_KEY}_file_${conversationId}_${filename}`;

			// Check cache
			const storedTokens = GM_getValue(storageKey);
			if (storedTokens !== undefined) {
				console.log(`Using cached tokens for file: ${filename}`);
				return storedTokens;
			}

			console.log(`Calculating tokens for file: ${filename}`);
			fileButton.click();

			// Wait for sidebar with correct file to appear
			const sidebar = await new Promise((resolve) => {
				let attempts = 0;
				const maxAttempts = 5;

				function checkSidebar() {
					const content = document.querySelector(SELECTORS.FILE_CONTENT);
					const titleElement = document.querySelector(SELECTORS.FILE_TITLE);

					console.log('Checking sidebar attempt', attempts + 1);
					console.log('Found content:', content);
					console.log('Found title:', titleElement);

					if (content && titleElement && titleElement.textContent.includes(filename)) {
						console.log('Found correct file content');
						resolve(content);
						return;
					}

					attempts++;
					if (attempts >= maxAttempts) {
						console.log('Failed to find correct file content');
						resolve(null);
						return;
					}

					setTimeout(checkSidebar, 100);
				}

				checkSidebar();
			});

			if (!sidebar) {
				console.log('Could not load sidebar content');
				return 0;
			}

			const text = sidebar.textContent || '';
			const tokens = calculateTokens(text);

			// Only store if we got actual content
			if (tokens > 0) {
				console.log(`Storing ${tokens} tokens for file ${filename}`);
				GM_setValue(storageKey, tokens);
			}

			// Close the sidebar
			const closeButton = document.querySelector(SELECTORS.CLOSE_BUTTON);
			if (closeButton) {
				closeButton.click();
			}

			return tokens;
		} catch (error) {
			console.error('Error processing file:', error);
			return 0;
		}
	}



	function getCurrentModel() {
		const modelSelector = document.querySelector(MODEL_SELECTOR);
		if (!modelSelector) return 'default';

		const modelText = modelSelector.querySelector('.whitespace-nowrap')?.textContent?.trim() || 'default';
		console.log('Current model:', modelText);
		return modelText;
	}

	function getMaxTokens() {
		return MODEL_TOKENS[currentModel] || MODEL_TOKENS.default;
	}

	function getStorageKey() {
		return `${STORAGE_KEY}_${currentModel.replace(/\s+/g, '_')}`;
	}

	function pollForModelChanges() {
		setInterval(() => {
			const newModel = getCurrentModel();
			if (newModel !== currentModel) {
				console.log(`Model changed from ${currentModel} to ${newModel}`);
				currentModel = newModel;
				currentTokenCount = 0;
				const { total } = initializeOrLoadStorage();  // Get the total for the new model
				totalTokenCount = total;
				updateProgressBar(totalTokenCount, 0);
			}
		}, POLL_INTERVAL_MS);
	}

	function createProgressBar() {
		const container = document.createElement('div');
		container.style.cssText = `
			position: fixed;
			bottom: 20px;
			right: 20px;
			width: 200px;
			padding: 10px;
			background: #2D2D2D;
			border: 1px solid #3B3B3B;
			border-radius: 8px;
			z-index: 9999;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
			cursor: move; /* Show move cursor */
			user-select: none; /* Prevent text selection while dragging */
		`;

		const currentCountDisplay = document.createElement('div');
		currentCountDisplay.id = 'current-token-count';
		currentCountDisplay.style.cssText = `
			color: white;
			font-size: 12px;
			margin-bottom: 8px;
		`;
		currentCountDisplay.textContent = 'Last message: 0 tokens';

		const progressContainer = document.createElement('div');
		progressContainer.style.cssText = `
			background: #3B3B3B;
			height: 6px;
			border-radius: 3px;
			overflow: hidden;
		`;

		const progress = document.createElement('div');
		progress.id = 'token-progress-bar';
		progress.style.cssText = `
			width: 0%;
			height: 100%;
			background: #3b82f6;
			transition: width 0.3s ease, background-color 0.3s ease;
		`;

		const tooltip = document.createElement('div');
		tooltip.id = 'token-progress-tooltip';
		tooltip.style.cssText = `
			position: absolute;
			bottom: 100%;
			left: 50%;
			transform: translateX(-50%);
			background: rgba(0, 0, 0, 0.9);
			color: white;
			padding: 4px 8px;
			border-radius: 4px;
			font-size: 12px;
			opacity: 0;
			transition: opacity 0.2s;
			pointer-events: none;
			margin-bottom: 4px;
			white-space: nowrap;
		`;

		progressContainer.appendChild(progress);
		container.appendChild(currentCountDisplay);
		container.appendChild(progressContainer);
		container.appendChild(tooltip);
		document.body.appendChild(container);

		// Dragging functionality
		let isDragging = false;
		let currentX;
		let currentY;
		let initialX;
		let initialY;

		container.addEventListener('mousedown', (e) => {
			isDragging = true;
			initialX = e.clientX - container.offsetLeft;
			initialY = e.clientY - container.offsetTop;
			container.style.cursor = 'grabbing';
		});

		document.addEventListener('mousemove', (e) => {
			if (!isDragging) return;
			e.preventDefault();
			currentX = e.clientX - initialX;
			currentY = e.clientY - initialY;
			// Ensure the container stays within viewport bounds
			const maxX = window.innerWidth - container.offsetWidth;
			const maxY = window.innerHeight - container.offsetHeight;
			currentX = Math.min(Math.max(0, currentX), maxX);
			currentY = Math.min(Math.max(0, currentY), maxY);
			container.style.left = `${currentX}px`;
			container.style.top = `${currentY}px`;
			container.style.right = 'auto';
			container.style.bottom = 'auto';
		});

		document.addEventListener('mouseup', () => {
			isDragging = false;
			container.style.cursor = 'move';
		});

		container.addEventListener('mouseenter', () => {
			tooltip.style.opacity = '1';
		});
		container.addEventListener('mouseleave', () => {
			tooltip.style.opacity = '0';
		});
	}

	function updateProgressBar(currentTotal, lastCount) {
		const progress = document.getElementById('token-progress-bar');
		const tooltip = document.getElementById('token-progress-tooltip');
		const currentDisplay = document.getElementById('current-token-count');
		if (!progress || !tooltip || !currentDisplay) return;

		const maxTokens = getMaxTokens();
		const percentage = (currentTotal / maxTokens) * 100;
		progress.style.width = `${Math.min(percentage, 100)}%`;

		if (currentTotal >= maxTokens * WARNING_THRESHOLD) {
			progress.style.background = '#ef4444';
		} else {
			progress.style.background = '#3b82f6';
		}

		tooltip.textContent = `${currentTotal.toLocaleString()} / ${maxTokens.toLocaleString()} tokens (${percentage.toFixed(1)}%)`;
		currentDisplay.textContent = `Last message: ${lastCount.toLocaleString()} tokens`;
	}

	function calculateTokens(text) {
		const charCount = text.length;
		return Math.ceil((charCount / 4) * 1.2);
	}

	function getResetTime(currentTime) {
		const hourStart = new Date(currentTime);
		hourStart.setMinutes(0, 0, 0);
		const resetTime = new Date(hourStart);
		resetTime.setHours(hourStart.getHours() + 5);
		return resetTime;
	}

	function initializeOrLoadStorage() {
		const stored = GM_getValue(getStorageKey());

		if (stored) {
			const currentTime = new Date();
			const resetTime = new Date(stored.resetTimestamp);

			if (currentTime >= resetTime) {
				return { total: 0, isInitialized: false };
			} else {
				return { total: stored.total, isInitialized: true };
			}
		}
		return { total: 0, isInitialized: false };
	}

	function saveToStorage(count) {
		const currentTime = new Date();
		const { isInitialized } = initializeOrLoadStorage();

		if (!isInitialized) {
			const resetTime = getResetTime(currentTime);
			GM_setValue(getStorageKey(), {
				total: count,
				resetTimestamp: resetTime.getTime()
			});
		} else {
			const existing = GM_getValue(getStorageKey());
			GM_setValue(getStorageKey(), {
				total: count,
				resetTimestamp: existing.resetTimestamp
			});
		}
	}

	async function countTokens() {
		const userMessages = document.querySelectorAll(SELECTORS.USER_MESSAGE);
		const aiMessages = document.querySelectorAll(SELECTORS.AI_MESSAGE);
		const fileButtons = document.querySelectorAll('[data-testid="file-thumbnail"]');

		console.log('Found user messages:', userMessages);
		console.log('Found AI messages:', aiMessages);
		console.log('Found file attachments:', fileButtons);

		let currentCount = 0;

		userMessages.forEach((msg, index) => {
			const text = msg.textContent || '';
			const tokens = calculateTokens(text);
			console.log(`User message ${index}:`, msg);
			console.log(`Text: "${text}"`);
			console.log(`Tokens: ${tokens}`);
			currentCount += tokens;
		});

		aiMessages.forEach((msg, index) => {
			const text = msg.textContent || '';
			const tokens = calculateTokens(text);
			console.log(`AI message ${index}:`, msg);
			console.log(`Text: "${text}"`);
			console.log(`Tokens: ${tokens}`);
			currentCount += tokens;
		});

		// Add file tokens
		// Handle files
		let file_idx = 0
		for (const button of fileButtons) {
			console.log(`Getting tokens for file`)
			console.log(button)
			const fileTokens = await getFileTokens(button);
			console.log(`File ${file_idx} tokens:`, fileTokens);
			currentCount += fileTokens;
			file_idx += 1;
		}

		const { total, isInitialized } = initializeOrLoadStorage();
		console.log(`Loaded total: ${total}`)
		totalTokenCount = isInitialized ? total + currentCount : currentCount;
		currentTokenCount = currentCount;

		saveToStorage(totalTokenCount);

		const stored = GM_getValue(getStorageKey());
		const resetTime = new Date(stored.resetTimestamp);

		console.log(`Current conversation tokens: ${currentCount}`);
		console.log(`Total accumulated tokens: ${totalTokenCount}`);
		console.log(`Next reset at: ${resetTime.toLocaleTimeString()}`);

		updateProgressBar(totalTokenCount, currentCount);
	}

	function setupTokenTracking() {
		console.log("Setting up tracking...")
		document.addEventListener('click', async (e) => {
			const regenerateButton = e.target.closest(`button:has(path[d="${SELECTORS.REGENERATE_BUTTON_PATH}"])`);
			const saveButton = e.target.closest(SELECTORS.SAVE_BUTTON);
			const sendButton = e.target.closest('button[aria-label="Send Message"]');
			if (regenerateButton || saveButton || sendButton) {
				console.log('Clicked:', e.target);
				console.log('Event details:', e);
				await new Promise(resolve => setTimeout(resolve, DELAY_MS));
				await countTokens();
				return;
			}
		});

		document.addEventListener('keydown', async (e) => {
			const mainInput = e.target.closest(SELECTORS.MAIN_INPUT);
			const editArea = e.target.closest(SELECTORS.EDIT_TEXTAREA);
			if ((mainInput || editArea) && e.key === 'Enter' && !e.shiftKey) {
				console.log('Enter pressed in:', e.target);
				console.log('Event details:', e);
				await new Promise(resolve => setTimeout(resolve, DELAY_MS));
				await countTokens();
				return;
			}
		});
	}

	function initialize() {
		console.log('Initializing Chat Token Counter...');
		const { total } = initializeOrLoadStorage();
		totalTokenCount = total;
		currentTokenCount = 0;
		setupTokenTracking();
		createProgressBar();
		updateProgressBar(totalTokenCount, currentTokenCount);
		pollForModelChanges();
		console.log('Initialization complete. Ready to track tokens.');
	}

	initialize();
})();
