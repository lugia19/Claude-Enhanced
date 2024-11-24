// ==UserScript==
// @name         Claude Usage Tracker
// @namespace    lugia19.com
// @match        https://claude.ai/*
// @version      1.4.0
// @author       lugia19
// @license      GPLv3
// @description  Helps you track your claude.ai usage caps.
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function () {
	'use strict';

	//#region Config
	// Declare variables at the top level
	let STORAGE_KEY;
	let COLLAPSED_STATE_KEY;
	let POLL_INTERVAL_MS;
	let DELAY_MS;
	let OUTPUT_TOKEN_MULTIPLIER;
	let MODEL_TOKENS;
	let MESSAGE_CAPS;
	let WARNING_THRESHOLD;
	let SELECTORS;
	let MODELS;

	const CONFIG_URL = 'https://raw.githubusercontent.com/lugia19/Claude-Toolbox/refs/heads/main/constants.json';
	const DEFAULT_CONFIG = {
		STORAGE_KEY: 'claudeUsageTracker_v2',
		POLL_INTERVAL_MS: 5000,
		DELAY_MS: 100,
		OUTPUT_TOKEN_MULTIPLIER: 10,
		MODEL_TOKENS: {
			'Opus': 1500000,
			'Sonnet': 1600000,
			'Haiku': 4000000,
			'default': 1
		},
		MESSAGE_CAPS: {
			'Opus': 50,
			'Sonnet': 200,
			'Haiku': 1000,
			'default': -1
		},
		WARNING_THRESHOLD: 0.9,
		SELECTORS: {
			MAIN_INPUT: 'div[aria-label="Write your prompt to Claude"]',
			REGENERATE_BUTTON_PATH: 'M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z',
			SAVE_BUTTON: 'button[type="submit"]',
			EDIT_TEXTAREA: '.font-user-message textarea',
			USER_MESSAGE: '[data-testid="user-message"]',
			AI_MESSAGE: '.font-claude-message',
			SEND_BUTTON: 'button[aria-label="Send Message"]',
			SIDEBAR_BUTTON: '[data-testid="chat-controls"]',
			FILE_BUTTONS: 'button[data-testid="file-thumbnail"]',
			PROJECT_FILES_CONTAINER: '.border-border-400.rounded-lg.border',
			PROJECT_FILES: 'button[data-testid="file-thumbnail"]',
			MODAL: '[role="dialog"]',
			MODAL_CONTENT: '.whitespace-pre-wrap.break-all.text-xs',
			MODAL_CLOSE: 'button:has(svg path[d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"])',
			BACK_BUTTON: 'button:has(svg path[d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"])',
			SIDEBAR_CONTENT: '.bg-bg-100.border-0\\.5.border-border-300.flex-1',
			FILE_VIEW_CONTAINER: '.flex.h-full.flex-col.pb-1.pl-5.pt-3',
			FILE_CONTENT: '.whitespace-pre-wrap.break-all.text-xs',
			MODEL_PICKER: '[data-testid="model-selector-dropdown"]',
			MOBILE_MENU_BUTTON: 'button[aria-haspopup="menu"]:has(svg path[d="M112,60a16,16,0,1,1,16,16A16,16,0,0,1,112,60Zm16,52a16,16,0,1,0,16,16A16,16,0,0,0,128,112Zm0,68a16,16,0,1,0,16,16A16,16,0,0,0,128,180Z"])'
		},
	};
	//#endregion

	//State variables
	let isProcessingEvent = false;
	let currentTokenCount = 0;
	let currentModel = 'default';
	let modelSections = {};
	let currentConversationId = null;
	let currentMessageCount = 0;


	//#region Utils
	const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function getCurrentModel() {
		const modelSelector = document.querySelector(SELECTORS.MODEL_PICKER);
		if (!modelSelector) return 'default';

		const modelText = modelSelector.querySelector('.whitespace-nowrap')?.textContent?.trim() || 'default';
		return getModelType(modelText);
	}

	async function waitForElement(selector, maxAttempts = 5) {
		let attempts = 0;
		while (attempts < maxAttempts) {
			const element = document.querySelector(selector);
			if (element) return element;

			await sleep(100);
			attempts++;
		}
		return null;
	}

	function formatTimeRemaining(resetTime) {
		const now = new Date();
		const diff = resetTime - now;

		if (diff <= 0) return 'Reset pending...';

		const hours = Math.floor(diff / (1000 * 60 * 60));
		const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

		if (hours > 0) {
			return `Reset in: ${hours}h ${minutes}m`;
		} else {
			return `Reset in: ${minutes}m`;
		}
	}

	function calculateTokens(text) {
		const charCount = text.length;
		return Math.ceil(charCount / 4);
	}

	function calculateMessagesLeft(modelTotal, conversationLength) {
		if (currentModel == "default") return "Loading...";

		const maxTokens = MODEL_TOKENS[currentModel] || MODEL_TOKENS.default;
		const messageCap = MESSAGE_CAPS[currentModel] || MESSAGE_CAPS.default;

		// Get current message count
		const stored = GM_getValue(getStorageKey());
		const currentMessageCount = stored?.messageCount || 0;

		if (conversationLength === 0) {
			// Just return remaining message cap instead of infinity
			return Math.max(0, messageCap - currentMessageCount).toFixed(1);
		}

		// Calculate remaining messages based on tokens
		const remainingTokens = maxTokens - modelTotal;
		const messagesLeftByTokens = remainingTokens / conversationLength;

		// Calculate remaining messages based on message cap
		const messagesLeftByCap = messageCap - currentMessageCount;

		// Use the more restrictive limit
		const actualMessagesLeft = Math.min(messagesLeftByTokens, messagesLeftByCap);

		// Return 0 if negative, otherwise show one decimal place
		return Math.max(0, actualMessagesLeft).toFixed(1);
	}



	function getResetTime(currentTime) {
		const hourStart = new Date(currentTime);
		hourStart.setMinutes(0, 0, 0);
		const resetTime = new Date(hourStart);
		resetTime.setHours(hourStart.getHours() + 5);
		return resetTime;
	}

	function getModelType(fullModelName) {
		if (!fullModelName || fullModelName === 'default') return 'default';

		fullModelName = fullModelName.toLowerCase();
		const modelTypes = Object.keys(MODEL_TOKENS).filter(key => key !== 'default');

		for (const modelType of modelTypes) {
			if (fullModelName.includes(modelType.toLowerCase())) {
				return modelType;
			}
		}

		return 'default';
	}
	//#endregion

	//#region Storage
	function getStorageKey() {
		return `${STORAGE_KEY}_${currentModel}`;
	}

	function getFileStorageKey(filename, isProjectFile = false) {
		const conversationId = getConversationId();
		return `${STORAGE_KEY}_${isProjectFile ? 'project' : 'content'}_${conversationId}_${filename}`;
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

	function saveToStorage(count, messageCount) {
		const currentTime = new Date();
		const { isInitialized } = initializeOrLoadStorage();
		console.log(`Saving count to ${getStorageKey()}!`)

		if (!isInitialized) {
			const resetTime = getResetTime(currentTime);
			GM_setValue(getStorageKey(), {
				total: count,
				messageCount: messageCount,
				resetTimestamp: resetTime.getTime()
			});
		} else {
			const existing = GM_getValue(getStorageKey());
			GM_setValue(getStorageKey(), {
				total: count,
				messageCount: messageCount,
				resetTimestamp: existing.resetTimestamp
			});
		}
	}
	//#endregion

	//#region File Processing
	function isMobileView() {
		const mobileMenuButton = document.querySelector(SELECTORS.MOBILE_MENU_BUTTON);
		if (!mobileMenuButton) return false;

		// Check if the button is actually in the DOM flow (has offsetParent)
		return mobileMenuButton.offsetParent !== null;
	}


	async function ensureSidebarLoaded() {
		/*if (isMobileView()) {
			console.warn("Mobile view detected (menu button visible), skipping project file processing");
			return false;
		}*/

		const sidebar = document.querySelector(SELECTORS.SIDEBAR_CONTENT);

		// If sidebar exists and has been processed before, we're done
		if (sidebar && sidebar.getAttribute('data-files-processed')) {
			console.log("Sidebar was processed! Skipping opening it.")
			return true;
		}

		// If we get here, we need to open/reload the sidebar
		const sidebarButton = document.querySelector(SELECTORS.SIDEBAR_BUTTON);
		if (!sidebarButton) {
			console.log('Could not find sidebar button');
			return false;
		}

		sidebarButton.click();


		// Wait for sidebar to become visible and mark it as processed
		let attempts = 0;
		while (attempts < 5) {
			let sidebar = document.querySelector(SELECTORS.SIDEBAR_CONTENT);
			if (sidebar) {
				const style = window.getComputedStyle(sidebar);
				const matrixMatch = style.transform.match(/matrix\(([\d.-]+,\s*){5}[\d.-]+\)/);
				const isHidden = matrixMatch && style.transform.includes('428');

				if (!isHidden && style.opacity !== '0') {
					console.log("Sidebar is visible, wait 1 sec.")
					sidebar.setAttribute('data-files-processed', 'true');
					await sleep(1000);

					//Ensure we have actually updated data.
					sidebar = document.querySelector(SELECTORS.SIDEBAR_CONTENT);

					// Close the sidebar since we only needed it to load the content
					const closeButton = document.querySelector('button[data-testid="close-file-preview"]');
					if (closeButton) {
						closeButton.click();
					}

					return true;
				}
			}
			await sleep(100);
			attempts++;
		}
		console.log('Sidebar did not show/load properly');
		return false;
	}

	async function getProjectFileTokens(button) {
		try {
			const fileContainer = button.closest('div[data-testid]');
			if (!fileContainer) {
				console.log('Could not find project file container');
				return 0;
			}

			const filename = fileContainer.getAttribute('data-testid');
			console.log('Processing project file:', filename);

			const storageKey = getFileStorageKey(filename, true);
			const stored = GM_getValue(storageKey);
			if (stored !== undefined) {
				console.log(`Using cached tokens for project file: ${filename}`);
				return stored;
			}

			console.log(`Calculating tokens for project file: ${filename}`);
			button.click();

			// Wait for modal with correct filename
			let attempts = 0;
			let modal = null;
			let modalTitle = null;

			while (attempts < 5) {
				modal = document.querySelector(SELECTORS.MODAL);
				if (modal) {
					modalTitle = modal.querySelector('h2');
					if (modalTitle && modalTitle.textContent === filename) {
						console.log(`Found modal with title ${filename}`)
						break;
					}
				}
				await new Promise(resolve => setTimeout(resolve, 200));
				attempts++;
			}

			if (!modal || !modalTitle || modalTitle.textContent !== filename) {
				console.log('Could not find modal with matching filename');
				return 0;
			}



			const content = modal.querySelector(SELECTORS.MODAL_CONTENT);
			if (!content) {
				console.log('Could not find modal content');
				return 0;
			}

			const text = content.textContent || '';
			console.log(`First 100 chars of content: "${text.substring(0, 100)}"`);
			const tokens = calculateTokens(content.textContent || '');
			console.log(`Project file ${filename} tokens:`, tokens);

			if (tokens > 0) {
				GM_setValue(storageKey, tokens);
			}



			const closeButton = modal.querySelector(SELECTORS.MODAL_CLOSE);
			if (closeButton) {
				closeButton.click();
			}

			console.log("Eeeping.")
			await sleep(200);

			return tokens;
		} catch (error) {
			console.error('Error processing project file:', error);
			return 0;
		}
	}

	async function getContentFileTokens(button) {
		try {
			const fileContainer = button.closest('div[data-testid]');
			if (!fileContainer) {
				console.log('Could not find content file container');
				return 0;
			}

			// Check for image
			const hasImage = button.parentElement.querySelector('img');
			if (hasImage) {
				console.log('File is an image, skipping token count');
				return 0;
			}

			const filename = fileContainer.getAttribute('data-testid');
			if (!filename) {
				console.log('Could not find content file name');
				return 0;
			}

			console.log('Processing content file:', filename);

			const storageKey = getFileStorageKey(filename, false);
			const stored = GM_getValue(storageKey);
			if (stored !== undefined) {
				console.log(`Using cached tokens for content file: ${filename}`);
				return stored;
			}

			console.log(`Calculating tokens for content file: ${filename}`);
			button.click();

			const fileView = await waitForElement(SELECTORS.FILE_VIEW_CONTAINER);
			if (!fileView) {
				console.log('Could not find file view');
				return 0;
			}

			const content = fileView.querySelector(SELECTORS.FILE_CONTENT);
			if (!content) {
				console.log('Could not find file content');
				return 0;
			}
			const text = content.textContent || '';
			//console.log(`First 100 chars of content: "${text.substring(0, 100)}"`);
			const tokens = calculateTokens(content.textContent || '');
			console.log(`Content file ${filename} tokens:`, tokens);

			if (tokens > 0) {
				GM_setValue(storageKey, tokens);
			}

			const backButton = fileView.querySelector(SELECTORS.BACK_BUTTON);
			if (backButton) {
				backButton.click();
			}

			return tokens;
		} catch (error) {
			console.error('Error processing content file:', error);
			return 0;
		}
	}
	//#endregion

	//#region UI elements
	function createModelSection(modelName, isActive) {
		const container = document.createElement('div');
		container.style.cssText = `
            margin-bottom: 12px;
            border-bottom: 1px solid #3B3B3B;
            padding-bottom: 8px;
            opacity: ${isActive ? '1' : '0.7'};
            transition: opacity 0.2s;
        `;

		container.style.cssText += `
        	position: relative;
    	`;

		const header = document.createElement('div');
		header.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            color: white;
            font-size: 12px;
        `;

		const arrow = document.createElement('div');
		arrow.innerHTML = '▼';
		arrow.style.cssText = `
            cursor: pointer;
            transition: transform 0.2s;
            font-size: 10px;
        `;

		const title = document.createElement('div');
		title.textContent = modelName;
		title.style.cssText = `flex-grow: 1;`;

		const activeIndicator = document.createElement('div');
		activeIndicator.style.cssText = `
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #3b82f6;
            opacity: ${isActive ? '1' : '0'};
            transition: opacity 0.2s;
        `;

		header.appendChild(arrow);
		header.appendChild(title);
		header.appendChild(activeIndicator);

		const content = document.createElement('div');

		// Remove currentCountDisplay, only keep resetTimeDisplay and progress bar
		const resetTimeDisplay = document.createElement('div');
		resetTimeDisplay.style.cssText = `
			color: #888;
			font-size: 11px;
			margin-bottom: 8px;
		`;
		resetTimeDisplay.textContent = 'Reset in: Not set.';


		const progressContainer = document.createElement('div');
		progressContainer.style.cssText = `
            background: #3B3B3B;
            height: 6px;
            border-radius: 3px;
            overflow: hidden;
        `;

		const progressBar = document.createElement('div');
		progressBar.style.cssText = `
            width: 0%;
            height: 100%;
            background: #3b82f6;
            transition: width 0.3s ease, background-color 0.3s ease;
        `;

		const tooltip = document.createElement('div');
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
			z-index: 10000;
		`;

		// Add hover events to the section container
		container.addEventListener('mouseenter', () => {
			tooltip.style.opacity = '1';
		});
		container.addEventListener('mouseleave', () => {
			tooltip.style.opacity = '0';
		});

		progressContainer.appendChild(progressBar);

		const messageCounter = document.createElement('div');
		messageCounter.style.cssText = `
			color: #888;
			font-size: 11px;
			margin-top: 4px;
		`;
		messageCounter.textContent = 'Messages: 0';
		content.appendChild(messageCounter);  // Add the counter

		content.appendChild(resetTimeDisplay);
		content.appendChild(progressContainer);
		content.appendChild(tooltip);

		container.appendChild(header);
		container.appendChild(content);

		// Add collapsed state tracking
		let isCollapsed = !isActive; // Start collapsed if not active
		content.style.display = isCollapsed ? 'none' : 'block';
		arrow.style.transform = isCollapsed ? 'rotate(-90deg)' : '';

		// Toggle section collapse/expand
		arrow.addEventListener('click', (e) => {
			e.stopPropagation();
			isCollapsed = !isCollapsed;
			content.style.display = isCollapsed ? 'none' : 'block';
			arrow.style.transform = isCollapsed ? 'rotate(-90deg)' : '';
		});

		return {
			container,
			progressBar,
			resetTimeDisplay,
			tooltip,
			messageCounter,
			setActive: (active) => {
				activeIndicator.style.opacity = active ? '1' : '0';
				container.style.opacity = active ? '1' : '0.7';
				// Expand if active, collapse if not
				if (active) {
					isCollapsed = false;
					content.style.display = 'block';
					arrow.style.transform = '';
				} else {
					isCollapsed = true;
					content.style.display = 'none';
					arrow.style.transform = 'rotate(-90deg)';
				}
			}
		};
	}


	function createProgressBar() {
		const container = document.createElement('div');
		container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #2D2D2D;
            border: 1px solid #3B3B3B;
            border-radius: 8px;
            z-index: 9999;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            cursor: move;
            user-select: none;
        `;

		// Header (always visible)
		const header = document.createElement('div');
		header.style.cssText = `
			display: flex;
			align-items: center;
			padding: 8px 10px;
			color: white;
			font-size: 12px;
			gap: 8px;
		`;

		const arrow = document.createElement('div');
		arrow.innerHTML = '▼';
		arrow.style.cssText = `
			cursor: pointer;
			transition: transform 0.2s;
		`;

		header.appendChild(arrow);
		header.appendChild(document.createTextNode('Usage Tracker'));

		// Counters (always visible)
		const conversationCounter = document.createElement('div');
		conversationCounter.style.cssText = `
			color: white;
			font-size: 12px;
			padding: 0 10px;
			margin-bottom: 8px;
			border-bottom: 1px solid #3B3B3B;
			padding-bottom: 8px;
		`;

		const estimateDisplay = document.createElement('div');
		estimateDisplay.id = 'messages-left-estimate';
		estimateDisplay.style.cssText = `
			color: white;
			font-size: 12px;
		`;
		estimateDisplay.textContent = 'Est. messages left: ∞';

		const lengthDisplay = document.createElement('div');
		lengthDisplay.id = 'conversation-token-count';
		lengthDisplay.style.cssText = `
			color: #888;
			font-size: 11px;
			margin-top: 4px;
		`;
		lengthDisplay.textContent = 'Current length: 0 tokens';

		conversationCounter.appendChild(estimateDisplay);
		conversationCounter.appendChild(lengthDisplay);

		// Content container (collapsible)
		const content = document.createElement('div');
		content.style.cssText = `
			padding: 0 10px 10px 10px;
			width: 250px;
		`;

		// Create sections for each model
		MODELS.forEach(model => {
			const isActive = model === currentModel;
			const section = createModelSection(model, isActive);
			modelSections[model] = section;
			content.appendChild(section.container);
		});

		container.appendChild(header);
		container.appendChild(conversationCounter);
		container.appendChild(content);
		document.body.appendChild(container);

		// Get stored collapse state
		let isCollapsed = GM_getValue(COLLAPSED_STATE_KEY, false);
		content.style.display = isCollapsed ? 'none' : 'block';
		arrow.style.transform = isCollapsed ? 'rotate(-90deg)' : '';

		// Toggle collapse/expand
		arrow.addEventListener('click', (e) => {
			e.stopPropagation();
			isCollapsed = !isCollapsed;
			content.style.display = isCollapsed ? 'none' : 'block';
			arrow.style.transform = isCollapsed ? 'rotate(-90deg)' : '';
			// Store the new state
			GM_setValue(COLLAPSED_STATE_KEY, isCollapsed);
		});

		// Dragging functionality
		let isDragging = false;
		let currentX;
		let currentY;
		let initialX;
		let initialY;

		header.addEventListener('mousedown', (e) => {
			if (e.target === arrow) return;
			isDragging = true;
			initialX = e.clientX - container.offsetLeft;
			initialY = e.clientY - container.offsetTop;
			header.style.cursor = 'grabbing';
		});

		document.addEventListener('mousemove', (e) => {
			if (!isDragging) return;
			e.preventDefault();
			currentX = e.clientX - initialX;
			currentY = e.clientY - initialY;
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
			header.style.cursor = 'move';
		});
	}

	function updateProgressBar(currentTokens, updateLength = true, shouldCollapse = false) {
		// Update each model section
		console.log("Updating progress bar...", currentTokens)

		const lengthDisplay = document.getElementById('conversation-token-count');
		if (lengthDisplay && updateLength) {
			lengthDisplay.textContent = `Current length: ${currentTokens.toLocaleString()} tokens`;
		}

		// Update messages left estimate
		const estimateDisplay = document.getElementById('messages-left-estimate');
		if (estimateDisplay && updateLength) {
			const modelStorageKey = `${STORAGE_KEY}_${currentModel.replace(/\s+/g, '_')}`;
			const stored = GM_getValue(modelStorageKey);
			const modelTotal = stored ? stored.total : 0;

			const estimate = calculateMessagesLeft(modelTotal, currentTokens);
			estimateDisplay.textContent = `Est. messages left: ${estimate}`;
		}

		// Update each model section
		MODELS.forEach(modelName => {
			const section = modelSections[modelName];
			if (!section) return;

			const isActiveModel = modelName === currentModel;
			if (shouldCollapse) {  // Only call setActive when we actually want to collapse
				section.setActive(isActiveModel);
			}

			const modelStorageKey = `${STORAGE_KEY}_${modelName.replace(/\s+/g, '_')}`;
			const stored = GM_getValue(modelStorageKey);
			const messageCap = MESSAGE_CAPS[modelName] || MESSAGE_CAPS.default;

			if (stored) {
				const modelTotal = stored.total;
				const messageCount = stored.messageCount || 0;
				const maxTokens = MODEL_TOKENS[modelName] || MODEL_TOKENS.default;
				const percentage = (modelTotal / maxTokens) * 100;

				section.progressBar.style.width = `${Math.min(percentage, 100)}%`;
				section.progressBar.style.background = modelTotal >= maxTokens * WARNING_THRESHOLD ? '#ef4444' : '#3b82f6';
				section.tooltip.textContent = `${modelTotal.toLocaleString()} / ${maxTokens.toLocaleString()} tokens (${percentage.toFixed(1)}%)`;
				section.messageCounter.textContent = `Messages: ${messageCount}`;

				const resetTime = new Date(stored.resetTimestamp);
				section.resetTimeDisplay.textContent = formatTimeRemaining(resetTime);
			} else {
				section.progressBar.style.width = '0%';
				section.tooltip.textContent = `0 / ${MODEL_TOKENS[modelName].toLocaleString()} tokens (0.0%)`;
				section.messageCounter.textContent = `Messages: 0`;
				section.resetTimeDisplay.textContent = 'Reset in: Not set';
			}
		});
	}
	//#endregion

	//#region Token Count
	async function getOutputMessage(maxWaitSeconds = 60) {
		console.log("Waiting for AI response...");
		const startTime = Date.now();
		let consecutiveSuccesses = 0;

		// Wait for complete set of messages
		while (Date.now() - startTime < maxWaitSeconds * 1000) {
			const messages = document.querySelectorAll(SELECTORS.AI_MESSAGE);
			const userMessages = document.querySelectorAll(SELECTORS.USER_MESSAGE);

			if (messages.length >= userMessages.length) {
				// Check if all messages have explicitly finished streaming
				let allFinished = true;
				messages.forEach(msg => {
					const parent = msg.closest('[data-is-streaming]');
					if (!parent || parent.getAttribute('data-is-streaming') !== 'false') {
						allFinished = false;
					}
				});

				if (allFinished) {
					consecutiveSuccesses++;
					console.log(`All messages marked complete, success ${consecutiveSuccesses}/3`);
					if (consecutiveSuccesses >= 3) {
						console.log("Three consecutive successes, returning last response");
						return messages[messages.length - 1];
					}
				} else {
					if (consecutiveSuccesses > 0) {
						console.log(`Reset success counter from ${consecutiveSuccesses} to 0`);
					}
					consecutiveSuccesses = 0;
				}
			}
			await sleep(100);
		}

		console.log("No complete response received within timeout");
		return null;
	}

	async function countTokens() {
		const userMessages = document.querySelectorAll(SELECTORS.USER_MESSAGE);
		const aiMessages = document.querySelectorAll(SELECTORS.AI_MESSAGE);
		if (!aiMessages || !userMessages || userMessages.length === 0) {
			return null;
		}

		console.log('Found user messages:', userMessages);
		console.log('Found AI messages:', aiMessages);

		let currentCount = 0;
		let AI_output = null;

		// Count user messages
		userMessages.forEach((msg, index) => {
			const text = msg.textContent || '';
			const tokens = calculateTokens(text);
			console.log(`User message ${index}, length ${tokens}:`, msg);
			//console.log(`Text: "${text}"`);
			currentCount += tokens;
		});

		// Check if we have a complete set of AI messages
		if (aiMessages.length !== 0) {
			const lastMessage = aiMessages[aiMessages.length - 1];
			const lastParent = lastMessage.closest('[data-is-streaming]');

			if (aiMessages.length >= userMessages.length &&
				lastParent && lastParent.getAttribute('data-is-streaming') === 'false') {
				console.log("Found complete set of messages, last AI message is complete");
				AI_output = lastMessage;
			}
		}



		// Count all AI messages except the final output (if already present)
		aiMessages.forEach((msg, index) => {
			// Skip if this is the final output we're saving for later
			if (msg === AI_output) {
				console.log(`Skipping AI message ${index} - will process later as final output`);
				return;
			}

			const parent = msg.closest('[data-is-streaming]');
			if (parent && parent.getAttribute('data-is-streaming') === 'false') {
				const text = msg.textContent || '';
				const tokens = calculateTokens(text); // No multiplication for intermediate responses
				console.log(`AI message ${index}, length ${tokens}:`, msg);
				currentCount += tokens;
			} else {
				console.log(`Skipping AI message ${index} - still streaming`);
			}
		});


		// Handle project files from sidebar first
		const projectFiles = new Set(); // Keep track of project files we've processed

		if (await ensureSidebarLoaded()) {
			const projectContainer = document.querySelector(SELECTORS.PROJECT_FILES_CONTAINER);
			const projectFileButtons = projectContainer?.querySelectorAll(SELECTORS.PROJECT_FILES) || [];
			console.log('Found project files in sidebar:', projectFileButtons);

			for (const button of projectFileButtons) {
				projectFiles.add(button);
				const tokens = await getProjectFileTokens(button);
				currentCount += tokens;
			}
		}

		// Now handle all file thumbnails that aren't in the project files set
		const allFileButtons = document.querySelectorAll(SELECTORS.FILE_BUTTONS);
		console.log('Found all file buttons:', allFileButtons);

		for (const button of allFileButtons) {
			if (!projectFiles.has(button)) { // Skip if it's a project file
				console.log("Found non-project file button", button)
				const tokens = await getContentFileTokens(button);
				currentCount += tokens;
			}
		}

		// Ensure sidebar is closed before waiting...
		console.log("Closing sidebar...")
		const sidebar = document.querySelector(SELECTORS.SIDEBAR_CONTENT);
		if (sidebar) {
			const style = window.getComputedStyle(sidebar);
			// If sidebar is visible (not transformed away)
			const matrixMatch = style.transform.match(/matrix\(([\d.-]+,\s*){5}[\d.-]+\)/);
			const isHidden = matrixMatch && style.transform.includes('428');
			if (!isHidden && style.opacity !== '0') {
				const closeButton = document.querySelector(SELECTORS.SIDEBAR_BUTTON);
				if (closeButton) { // Check if button is visible
					console.log("Closing...")
					closeButton.click();
				}
			}
		}


		if (!AI_output) {
			console.log("No complete AI output found, waiting...");
			AI_output = await getOutputMessage();
		}

		// Process the AI output if we have it (with multiplication)
		if (AI_output) {
			const text = AI_output.textContent || '';
			const tokens = calculateTokens(text) * OUTPUT_TOKEN_MULTIPLIER;
			console.log("Processing final AI output:");
			console.log(`Text: "${text}"`);
			console.log(`Tokens: ${tokens}`);
			currentCount += tokens;
		}

		return currentCount;
	}

	async function updateTokenTotal() {
		const newCount = await countTokens();
		if (!newCount)
			return

		const maxTokens = MODEL_TOKENS[currentModel] || MODEL_TOKENS.default;
		const messageCap = MESSAGE_CAPS[currentModel] || MESSAGE_CAPS.default;
		const minimumWeight = Math.ceil(maxTokens / messageCap);
		const adjustedCount = newCount < minimumWeight ? minimumWeight : newCount;

		const { total, isInitialized } = initializeOrLoadStorage();
		const stored = GM_getValue(getStorageKey());
		const currentMessageCount = (stored?.messageCount || 0) + 1;  // Increment message count

		let totalTokenCount = isInitialized ? total + adjustedCount : adjustedCount;

		saveToStorage(totalTokenCount, currentMessageCount);

		const resetTime = new Date(stored?.resetTimestamp || Date.now());

		console.log(`Current conversation tokens: ${adjustedCount}`);
		console.log(`Total accumulated tokens: ${totalTokenCount}`);
		console.log(`Messages used: ${currentMessageCount}/${messageCap}`);
		console.log(`Next reset at: ${resetTime.toLocaleTimeString()}`);

		updateProgressBar(adjustedCount, false);
	}
	//#endregion

	//#region Event Handlers
	function pollUpdates() {
		setInterval(async () => {
			if (isProcessingEvent) {
				console.log('Event processing in progress, skipping poll');
				return;
			}
			const newModel = getCurrentModel();
			const currentTime = new Date();
			let needsUpdate = false;

			// Check conversation state
			const conversationId = getConversationId();
			if (conversationId == null) {
				currentTokenCount = 0;
				console.log("No conversation active, updating progressbar...")
				needsUpdate = true;
			}
			const messages = document.querySelectorAll(`${SELECTORS.USER_MESSAGE}, ${SELECTORS.AI_MESSAGE}`);

			if ((conversationId !== currentConversationId && conversationId !== null) || messages.length !== currentMessageCount) {
				console.log('Conversation changed, recounting tokens');
				currentConversationId = conversationId;
				currentMessageCount = messages.length;
				let newTokenCount = await countTokens();
				if (!newTokenCount)
					return
				currentTokenCount = newTokenCount;
				needsUpdate = true;
			}

			// Check for model change
			if (newModel !== currentModel) {
				console.log(`Model changed from ${currentModel} to ${newModel}`);
				currentModel = newModel;
				// Update all sections - will collapse inactive ones
				MODELS.forEach(modelName => {
					const section = modelSections[modelName];
					if (section) {
						section.setActive(modelName === currentModel);
					}
				});
				needsUpdate = true;
			}

			// Check each model's reset time, update countdown, and check for total changes
			MODELS.forEach(model => {
				const storageKey = `${STORAGE_KEY}_${model.replace(/\s+/g, '_')}`;
				const stored = GM_getValue(storageKey);
				const section = modelSections[model];

				if (stored) {
					const resetTime = new Date(stored.resetTimestamp);
					if (currentTime >= resetTime) {
						console.log(`Reset time reached for ${model}, clearing total`);
						GM_setValue(storageKey, null);
						needsUpdate = true;
					} else {
						// Update countdown
						section.resetTimeDisplay.textContent = formatTimeRemaining(resetTime);

						// Check if stored total is different from displayed total
						const displayedTotal = parseInt(section.tooltip.textContent
							.split('/')[0]
							.replace(/[,\.]/g, '')  // Remove both dots and commas
							.trim());
						if (stored.total !== displayedTotal) {
							console.log(`Detected change in total for ${model}: ${displayedTotal} -> ${stored.total}`);
							needsUpdate = true;
						}
					}
				} else {
					section.resetTimeDisplay.textContent = 'Reset in: Not set';
					if (!section.tooltip.textContent.startsWith('0')) {
						console.log("Tooltip wasn't updated properly, resetting...")
						needsUpdate = true;
					}
				}
			});

			// Update UI if needed
			if (needsUpdate) {
				console.log("Updating bar from poll event...")
				updateProgressBar(currentTokenCount, true, newModel !== currentModel);
			}
		}, POLL_INTERVAL_MS);
	}


	async function handleTokenCount() {
		isProcessingEvent = true;
		try {
			const delay = getConversationId() ? DELAY_MS : 5000;
			console.log(`Waiting ${delay}ms before counting tokens`);
			await sleep(delay);
			await updateTokenTotal();
		} finally {
			isProcessingEvent = false;
		}
	}

	function setupEvents() {
		console.log("Setting up tracking...")
		document.addEventListener('click', async (e) => {
			const regenerateButton = e.target.closest(`button:has(path[d="${SELECTORS.REGENERATE_BUTTON_PATH}"])`);
			const saveButton = e.target.closest(SELECTORS.SAVE_BUTTON);
			const sendButton = e.target.closest('button[aria-label="Send Message"]');

			if (saveButton) {
				const renameChatDialog = saveButton.closest('div[role="dialog"]')?.querySelector('h2');
				if (renameChatDialog?.textContent === 'Rename chat') {
					console.log('Save button clicked in rename dialog, ignoring');
					return;
				}
			}

			if (regenerateButton || saveButton || sendButton) {
				console.log('Clicked:', e.target);
				console.log('Event details:', e);
				await handleTokenCount();
				return;
			}
		});

		document.addEventListener('keydown', async (e) => {
			const mainInput = e.target.closest(SELECTORS.MAIN_INPUT);
			const editArea = e.target.closest(SELECTORS.EDIT_TEXTAREA);

			// For edit areas, only proceed if it's within a user message
			if (editArea) {
				const renameChatDialog = editArea.closest('div[role="dialog"]')?.querySelector('h2');
				if (renameChatDialog?.textContent === 'Rename chat') {
					console.log('Enter pressed in rename dialog, ignoring');
					return;
				}
			}

			if ((mainInput || editArea) && e.key === 'Enter' && !e.shiftKey) {
				console.log('Enter pressed in:', e.target);
				console.log('Event details:', e);
				await handleTokenCount();
				return;
			}
		});
	}
	//#endregion

	async function loadConfig() {
		try {
			const response = await fetch(CONFIG_URL);
			if (!response.ok) {
				console.warn('Failed to load remote config, using defaults');
				return DEFAULT_CONFIG;
			}

			const remoteConfig = await response.json();
			console.log('Loaded remote config:', remoteConfig);
			// Deep merge the remote config with defaults
			const mergeDeep = (target, source) => {
				for (const key in source) {
					if (source[key] instanceof Object && key in target) {
						target[key] = mergeDeep(target[key], source[key]);
					} else {
						target[key] = source[key];
					}
				}
				return target;
			};

			return mergeDeep(structuredClone(DEFAULT_CONFIG), remoteConfig);
		} catch (error) {
			console.warn('Error loading remote config:', error);
			return DEFAULT_CONFIG;
		}
	}

	async function initialize() {
		console.log('Initializing Chat Token Counter...');

		// Load and assign configuration to global variables
		const config = await loadConfig();
		STORAGE_KEY = config.STORAGE_KEY;
		COLLAPSED_STATE_KEY = `${STORAGE_KEY}_collapsed`;
		POLL_INTERVAL_MS = config.POLL_INTERVAL_MS;
		DELAY_MS = config.DELAY_MS;
		OUTPUT_TOKEN_MULTIPLIER = config.OUTPUT_TOKEN_MULTIPLIER;
		MODEL_TOKENS = config.MODEL_TOKENS;
		MODELS = Object.keys(MODEL_TOKENS).filter(key => key !== 'default');
		MESSAGE_CAPS = config.MESSAGE_CAPS;
		WARNING_THRESHOLD = config.WARNING_THRESHOLD;
		SELECTORS = config.SELECTORS;

		// Initialize everything else
		currentModel = getCurrentModel();
		initializeOrLoadStorage();
		currentTokenCount = 0;
		setupEvents();
		createProgressBar();
		updateProgressBar(currentTokenCount);
		pollUpdates();
		console.log('Initialization complete. Ready to track tokens.');
	}

	(async () => {
		try {
			await initialize();
		} catch (error) {
			console.error('Failed to initialize Chat Token Counter:', error);
		}
	})();
})();
