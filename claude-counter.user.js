// ==UserScript==
// @name         Claude Usage Tracker
// @namespace    lugia19.com
// @match        https://claude.ai/*
// @version      1.8.1
// @author       lugia19
// @license      GPLv3
// @description  Helps you track your claude.ai usage caps.
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==

if (window.claudeTrackerInstance) {
	console.log('Instance already running, stopping');
	return;
}
window.claudeTrackerInstance = true;

(function () {
	'use strict';

	//#region Config
	// Declare variables at the top level
	let config;
	const STORAGE_KEY = "claudeUsageTracker_v3"

	const CONFIG_URL = 'https://raw.githubusercontent.com/lugia19/Claude-Toolbox/refs/heads/main/constants.json';
	const DEFAULT_CONFIG = {
		POLL_INTERVAL_MS: 5000,
		DELAY_MS: 100,
		OUTPUT_TOKEN_MULTIPLIER: 10,
		MODEL_TOKENS: {
			'Opus': 1500000,
			'Sonnet': 1600000,
			'Haiku': 4000000,
			'default': 1
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
			MOBILE_MENU_BUTTON: 'button[aria-haspopup="menu"]:has(svg path[d="M112,60a16,16,0,1,1,16,16A16,16,0,0,1,112,60Zm16,52a16,16,0,1,0,16,16A16,16,0,0,0,128,112Zm0,68a16,16,0,1,0,16,16A16,16,0,0,0,128,180Z"])',
			USER_MENU_BUTTON: 'button[data-testid="user-menu-button"]',
			PDF_ICON: `path[d="M224,152a8,8,0,0,1-8,8H192v16h16a8,8,0,0,1,0,16H192v16a8,8,0,0,1-16,0V152a8,8,0,0,1,8-8h32A8,8,0,0,1,224,152ZM92,172a28,28,0,0,1-28,28H56v8a8,8,0,0,1-16,0V152a8,8,0,0,1,8-8H64A28,28,0,0,1,92,172Zm-16,0a12,12,0,0,0-12-12H56v24h8A12,12,0,0,0,76,172Zm88,8a36,36,0,0,1-36,36H112a8,8,0,0,1-8-8V152a8,8,0,0,1,8-8h16A36,36,0,0,1,164,180Zm-16,0a20,20,0,0,0-20-20h-8v40h8A20,20,0,0,0,148,180ZM40,112V40A16,16,0,0,1,56,24h96a8,8,0,0,1,5.66,2.34l56,56A8,8,0,0,1,216,88v24a8,8,0,0,1-16,0V96H152a8,8,0,0,1-8-8V40H56v72a8,8,0,0,1-16,0ZM160,80h28.69L160,51.31Z"]`,
			ARTIFACT_VERSION_SELECT: 'button[type="button"][aria-haspopup="menu"]'
		},
		CHECKBOX_OPTIONS: {
			'personal_preferences_enabled': { text: 'Preferences in profile and enabled', cost: 800 },
			'artifacts_enabled': { text: 'Artifacts enabled', cost: 5500 },
			'analysis_enabled': { text: 'Analysis Tool enabled', cost: 2000 },
			'latex_enabled': { text: 'LaTeX Rendering enabled', cost: 200 },
		},
		BASE_SYSTEM_PROMPT_LENGTH: (2600 + 300),	//Base + style_info
		FIREBASE_BASE_URL: 'https://claude-usage-tracker-default-rtdb.europe-west1.firebasedatabase.app'
	};
	//#endregion

	//#region Storage Manager
	class StorageManager {
		constructor() {
			this.syncInterval = 20000; // 20s
			this.startSync();
		}

		startSync() {
			setInterval(() => this.syncWithFirebase(), this.syncInterval);
		}

		async syncWithFirebase() {
			console.log("=== FIREBASE SYNC STARTING ===");

			const userId = await getUserId();
			if (!userId) {
				throw new Error("Could not get user ID");
			}
			console.log("Using hashed ID:", userId);

			try {
				// Get local data
				const localModels = GM_getValue(`${STORAGE_KEY}_models`);
				console.log("Local models:", localModels);

				// Get remote data
				const url = `${config.FIREBASE_BASE_URL}/users/${userId}/models.json`;
				console.log("Fetching from:", url);

				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}
				const firebaseModels = await response.json() || {};
				console.log("Firebase models:", firebaseModels);

				// Merge data
				const mergedModels = this.mergeModelData(localModels, firebaseModels);
				console.log("Merged result:", mergedModels);

				// Write merged data back
				console.log("Writing merged data back to Firebase...");
				const writeResponse = await fetch(url, {
					method: 'PUT',
					body: JSON.stringify(mergedModels)
				});

				if (!writeResponse.ok) {
					throw new Error(`Write failed! status: ${writeResponse.status}`);
				}

				// Update local storage
				console.log("Updating local storage...");
				GM_setValue(`${STORAGE_KEY}_models`, mergedModels);
				console.log("=== SYNC COMPLETED SUCCESSFULLY ===");

			} catch (error) {
				console.error('=== SYNC FAILED ===');
				console.error('Error details:', error);
				console.error('Stack:', error.stack);
			}
		}

		mergeModelData(localModels = {}, firebaseModels = {}) {
			console.log("MERGING...")
			const merged = {};
			const allModelKeys = new Set([
				...Object.keys(localModels),
				...Object.keys(firebaseModels)
			]);

			allModelKeys.forEach(model => {
				const local = localModels[model];
				const remote = firebaseModels[model];

				if (!remote) {
					merged[model] = local;
				} else if (!local) {
					merged[model] = remote;
				} else {
					// If reset times match, take the highest counts
					if (local.resetTimestamp === remote.resetTimestamp) {
						console.log("TIMESTAMP MATCHES, TAKING HIGHEST COUNTS!")
						merged[model] = {
							total: Math.max(local.total, remote.total),
							messageCount: Math.max(local.messageCount, remote.messageCount),
							resetTimestamp: local.resetTimestamp
						};
					}
					// Otherwise take all values from whichever has the later reset time
					else {
						console.log("TIMESTAMP DOES NOT MATCH, TAKING NEWEST COUNTS!")
						merged[model] = local.resetTimestamp > remote.resetTimestamp ? local : remote;
					}
				}
			});

			return merged;
		}


		getCheckboxStates() {
			return GM_getValue(`${STORAGE_KEY}_checkbox_states`, {});
		}

		setCheckboxState(key, checked) {
			const states = this.getCheckboxStates();
			states[key] = checked;
			GM_setValue(`${STORAGE_KEY}_checkbox_states`, states);
		}

		getExtraCost() {
			const states = this.getCheckboxStates();
			return Object.entries(config.CHECKBOX_OPTIONS)
				.reduce((total, [key, option]) =>
					total + (states[key] ? option.cost : 0), 0);
		}

		getCollapsedState() {
			return GM_getValue(`${STORAGE_KEY}_collapsed`, false);
		}

		setCollapsedState(isCollapsed) {
			GM_setValue(`${STORAGE_KEY}_collapsed`, isCollapsed);
		}

		#checkAndCleanExpiredData() {
			const allModelData = GM_getValue(`${STORAGE_KEY}_models`);
			if (!allModelData) return;

			const currentTime = new Date();
			let hasChanges = false;

			for (const model in allModelData) {
				const resetTime = new Date(allModelData[model].resetTimestamp);
				if (currentTime >= resetTime) {
					delete allModelData[model];
					hasChanges = true;
				}
			}

			if (hasChanges) {
				GM_setValue(`${STORAGE_KEY}_models`, allModelData);
			}
		}

		getModelData(model) {
			this.#checkAndCleanExpiredData();
			const allModelData = GM_getValue(`${STORAGE_KEY}_models`);
			return allModelData?.[model] || null;
		}

		initializeOrLoadStorage(model) {
			const stored = this.getModelData(model);
			if (!stored) {
				return { total: 0, isInitialized: false };
			}
			return { total: stored.total, isInitialized: true };
		}

		saveModelData(model, rawCount) {
			const maxTokens = config.MODEL_TOKENS[model] || config.MODEL_TOKENS.default;
			let allModelData = GM_getValue(`${STORAGE_KEY}_models`, {});
			const stored = allModelData[model];

			const currentMessageCount = (stored?.messageCount || 0) + 1;
			const totalTokenCount = stored ? stored.total + rawCount : rawCount;

			allModelData[model] = {
				total: totalTokenCount,
				messageCount: currentMessageCount,
				resetTimestamp: stored?.resetTimestamp || this.#getResetTime(new Date()).getTime()
			};

			GM_setValue(`${STORAGE_KEY}_models`, allModelData);

			return {
				totalTokenCount,
				messageCount: currentMessageCount
			};
		}

		clearModelData(model) {
			let allModelData = GM_getValue(`${STORAGE_KEY}_models`, {});
			delete allModelData[model];
			GM_setValue(`${STORAGE_KEY}_models`, allModelData);
		}

		#getResetTime(currentTime) {
			const hourStart = new Date(currentTime);
			hourStart.setMinutes(0, 0, 0);
			const resetTime = new Date(hourStart);
			resetTime.setHours(hourStart.getHours() + 5);
			return resetTime;
		}

		getFormattedTimeRemaining(model) {
			const stored = this.getModelData(model);
			if (!stored) return 'Reset in: Not set';

			const now = new Date();
			const resetTime = new Date(stored.resetTimestamp);
			const diff = resetTime - now;

			if (diff <= 0) return 'Reset pending...';

			const hours = Math.floor(diff / (1000 * 60 * 60));
			const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

			return hours > 0 ? `Reset in: ${hours}h ${minutes}m` : `Reset in: ${minutes}m`;
		}

		calculateMessagesLeft(model, conversationLength = 0) {
			console.log("Calculating messages left for model:", model);
			console.log("Conversation length:", conversationLength);
			if (model === "default") return "Loading...";

			const maxTokens = config.MODEL_TOKENS[model] || config.MODEL_TOKENS.default;
			const stored = this.getModelData(model);
			const modelTotal = stored?.total || 0;
			const remainingTokens = maxTokens - modelTotal;

			if (conversationLength === 0) {
				return "Loading...";
			}

			return Math.max(0, remainingTokens / conversationLength).toFixed(1);
		}

		// File storage methods
		#getFileKey(conversationId) {
			return `${STORAGE_KEY}_files_${conversationId}`;
		}

		getFileTokens(conversationId, filename, fileType) {
			const allFileData = GM_getValue(this.#getFileKey(conversationId), {});
			const fileKey = `${fileType}_${filename}`;
			return allFileData[fileKey];
		}

		saveFileTokens(conversationId, filename, tokens, fileType) {
			if (tokens <= 0) return;

			const allFileData = GM_getValue(this.#getFileKey(conversationId), {});
			const fileKey = `${fileType}_${filename}`;

			allFileData[fileKey] = tokens;
			GM_setValue(this.#getFileKey(conversationId), allFileData);
		}
	}

	let storageManager;
	//#endregion

	//State variables
	let isProcessingEvent = false;
	let currentlyDisplayedModel = 'default';
	let modelSections = {};
	let currentConversationId = null;
	let currentMessageCount = 0;
	let lastCheckboxState = {};

	//#region Utils
	async function getUserId() {
		const userMenuButton = document.querySelector(config.SELECTORS.USER_MENU_BUTTON);
		if (!userMenuButton) {
			console.error("Could not find user menu button");
			return null;
		}

		const emailDiv = userMenuButton.querySelector('.min-w-0.flex-1.truncate');
		if (!emailDiv) {
			console.error("Could not find email element");
			return null;
		}

		const email = emailDiv.textContent.trim();
		const msgBuffer = new TextEncoder().encode(email);
		const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function getCurrentModel() {
		const modelSelector = document.querySelector(config.SELECTORS.MODEL_PICKER);
		if (!modelSelector) return 'default';

		let fullModelName = modelSelector.querySelector('.whitespace-nowrap')?.textContent?.trim() || 'default';

		if (!fullModelName || fullModelName === 'default') return 'default';

		fullModelName = fullModelName.toLowerCase();
		const modelTypes = Object.keys(config.MODEL_TOKENS).filter(key => key !== 'default');

		for (const modelType of modelTypes) {
			if (fullModelName.includes(modelType.toLowerCase())) {
				return modelType;
			}
		}

		return 'default';
	}

	function calculateTokens(text) {
		const charCount = text.length;
		return Math.ceil(charCount / 4);
	}

	function isMobileView() {
		// First check if we're on a chat page
		if (!window.location.pathname.startsWith('/chat/')) {
			return false;
		}

		// Check if height > width (portrait orientation)
		return window.innerHeight > window.innerWidth;
	}

	//#endregion

	//#region File Processing
	async function ensureSidebarLoaded() {
		const sidebar = document.querySelector(config.SELECTORS.SIDEBAR_CONTENT);

		//Ensure we're not inside a modal
		const backButton = document.querySelector(config.SELECTORS.BACK_BUTTON);
		if (backButton) {
			console.log("Found back button, clicking it");
			backButton.click();
			await sleep(200);
		}

		// If sidebar exists and has been processed before, we're done
		if (sidebar && sidebar.getAttribute('data-files-processed')) {
			console.log("Sidebar was processed! Skipping opening it.")
			return true;
		}

		// If we get here, we need to open/reload the sidebar
		const sidebarButton = document.querySelector(config.SELECTORS.SIDEBAR_BUTTON);
		if (!sidebarButton) {
			console.log('Could not find sidebar button');
			return false;
		}

		sidebarButton.click();


		// Wait for sidebar to become visible and mark it as processed
		let attempts = 0;
		while (attempts < 5) {
			let sidebar = document.querySelector(config.SELECTORS.SIDEBAR_CONTENT);
			if (sidebar) {
				const style = window.getComputedStyle(sidebar);
				const matrixMatch = style.transform.match(/matrix\(([\d.-]+,\s*){5}[\d.-]+\)/);
				const isHidden = matrixMatch && style.transform.includes('428');

				if (!isHidden && style.opacity !== '0') {
					console.log("Sidebar is visible, wait 1 sec.")
					sidebar.setAttribute('data-files-processed', 'true');
					await sleep(1000);

					//Ensure we have actually updated data.
					sidebar = document.querySelector(config.SELECTORS.SIDEBAR_CONTENT);

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

	async function handleProjectFile(button) {
		try {
			const fileContainer = button.closest('div[data-testid]');
			if (!fileContainer) {
				console.log('Could not find project file container');
				return 0;
			}

			const filename = fileContainer.getAttribute('data-testid');
			console.log('Processing project file:', filename);

			const stored = storageManager.getFileTokens(getConversationId(), filename, "project");
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
				modal = document.querySelector(config.SELECTORS.MODAL);
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



			const content = modal.querySelector(config.SELECTORS.MODAL_CONTENT);
			if (!content) {
				console.log('Could not find modal content');
				return 0;
			}

			const text = content.textContent || '';
			console.log(`First 100 chars of content: "${text.substring(0, 100)}"`);
			const tokens = calculateTokens(content.textContent || '');
			console.log(`Project file ${filename} tokens:`, tokens);

			if (tokens > 0) {
				storageManager.saveFileTokens(getConversationId(), filename, tokens, "project");
			}



			const closeButton = modal.querySelector(config.SELECTORS.MODAL_CLOSE);
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

	async function getProjectTokens() {
		const projectContainer = document.querySelector(config.SELECTORS.PROJECT_FILES_CONTAINER);
		const projectFileButtons = projectContainer?.querySelectorAll(config.SELECTORS.PROJECT_FILES) || [];
		console.log('Found project files in sidebar:', projectFileButtons);

		let totalTokens = 0;
		for (const button of projectFileButtons) {
			const tokens = await handleProjectFile(button);
			totalTokens += tokens;
		}

		return totalTokens;
	}

	async function handleTextFile(button) {
		const filename = button.querySelector('.break-words')?.textContent;
		if (!filename) {
			console.log('Could not find filename for text file');
			return 0;
		}

		const stored = storageManager.getFileTokens(getConversationId(), filename, "content");
		if (stored !== undefined) {
			console.log(`Using cached tokens for text file: ${filename}`);
			return stored;
		}

		button.click();
		await sleep(200);

		const content = document.querySelector(config.SELECTORS.FILE_CONTENT);
		if (!content) {
			console.log('Could not find file content');
			return 0;
		}

		const tokens = calculateTokens(content.textContent || '');
		console.log(`Text file ${filename} tokens:`, tokens);

		if (tokens > 0) {
			storageManager.saveFileTokens(getConversationId(), filename, tokens, "content");
		}

		const closeButton = document.querySelector(config.SELECTORS.MODAL_CLOSE);
		if (closeButton) {
			closeButton.click();
			await sleep(200);
		}

		return tokens;
	}

	async function handleImageFile(button) {
		const filename = button.querySelector('.break-words')?.textContent;
		if (!filename) {
			console.log('Could not find filename for image');
			return 0;
		}

		const stored = storageManager.getFileTokens(getConversationId(), filename, "content");
		if (stored !== undefined) {
			console.log(`Using cached tokens for image: ${filename}`);
			return stored;
		}

		button.click();
		await sleep(200);

		const modalImage = document.querySelector('[role="dialog"] img[alt^="Preview of"]');
		if (!modalImage) {
			console.log('Could not find image in modal');
			return 0;
		}

		const width = parseInt(modalImage.getAttribute('width'));
		const height = parseInt(modalImage.getAttribute('height'));

		if (!width || !height) {
			console.log('Could not get image dimensions');
			return 0;
		}

		const tokens = Math.min(1600, Math.ceil((width * height) / 750));
		console.log(`Image ${filename} (${width}x${height}) tokens:`, tokens);

		if (tokens > 0) {
			storageManager.saveFileTokens(getConversationId(), filename, tokens, "content");
		}

		const closeButton = document.querySelector('[data-testid="close-file-preview"]');
		if (closeButton) {
			closeButton.click();
			await sleep(200);
		}

		return tokens;
	}

	async function handlePDFFile(button) {
		const filename = button.querySelector('.break-words')?.textContent;
		if (!filename) {
			console.log('Could not find filename for PDF');
			return 0;
		}

		const stored = storageManager.getFileTokens(getConversationId(), filename, "content");
		if (stored !== undefined) {
			console.log(`Using cached tokens for PDF: ${filename}`);
			return stored;
		}

		button.click();
		await sleep(200);

		const pageText = document.querySelector('[role="dialog"] .text-text-300 p')?.textContent;
		if (!pageText) {
			console.log('Could not find page count text');
			return 0;
		}

		const pageCount = parseInt(pageText);
		if (isNaN(pageCount)) {
			console.log('Could not parse page count from:', pageText);
			return 0;
		}

		const tokens = pageCount * 2250;
		console.log(`PDF ${filename} (${pageCount} pages) tokens:`, tokens);

		if (tokens > 0) {
			storageManager.saveFileTokens(getConversationId(), filename, tokens, "content");
		}

		const closeButton = document.querySelector(`[role="dialog"] ${config.SELECTORS.MODAL_CLOSE}`);
		if (closeButton) {
			closeButton.click();
			await sleep(200);
		}

		return tokens;
	}

	async function getContentTokens() {
		let totalTokens = 0;

		const sidebar = document.querySelector(config.SELECTORS.SIDEBAR_CONTENT);
		if (!sidebar) {
			console.log('Could not find sidebar');
			return 0;
		}

		// Find project files container if it exists
		const projectContainer = sidebar.querySelector(config.SELECTORS.PROJECT_FILES_CONTAINER);

		// Find all uls in the sidebar that aren't inside the project container
		const uls = Array.from(sidebar.querySelectorAll('ul')).filter(ul => {
			if (!projectContainer) return true;
			return !projectContainer.contains(ul);
		});

		// Find the files ul - it should be the one following the "Content" heading
		const contentUl = uls.find(ul => {
			const prevHeader = ul.previousElementSibling;
			return prevHeader?.tagName === 'H3' && prevHeader.textContent === 'Content';
		});

		if (!contentUl) {
			console.log('Could not find content file list');
			return 0;
		}

		for (const li of contentUl.querySelectorAll('li')) {
			const button = li.querySelector('button');
			if (!button) continue;

			const isImage = !!button.querySelector('img');
			const isPDF = !!button.querySelector(config.SELECTORS.PDF_ICON);

			let tokens = 0;
			try {
				if (isImage) {
					tokens = await handleImageFile(button);
				} else if (isPDF) {
					tokens = await handlePDFFile(button);
				} else {
					tokens = await handleTextFile(button);
				}
			} catch (error) {
				console.error('Error counting tokens for file:', error);
			}
			totalTokens += tokens;
		}

		return totalTokens;
	}

	async function handleArtifact(button, artifactName, versionCount) {
		console.log("Handling artifact", artifactName);

		// Check cache first
		const stored = storageManager.getFileTokens(
			getConversationId(),
			`${artifactName}_v${versionCount}`,
			'artifact'
		);
		if (stored !== undefined) {
			console.log(`Using cached tokens for artifact: ${artifactName} (${versionCount} versions)`);
			return stored;
		}

		// Open the artifact
		button.click();
		await sleep(200);

		const modalContainer = document.querySelector(config.SELECTORS.SIDEBAR_CONTENT);
		if (!modalContainer) {
			console.log('Could not find modal container');
			return 0;
		}
		console.log("Ensuring code mode...")
		// Ensure we're in code view if toggle exists
		const toggle = modalContainer.querySelector('[role="group"]');
		if (toggle) {
			const codeButton = toggle.querySelector('[data-testid="undefined-code"]');
			if (codeButton && codeButton.getAttribute('data-state') === 'off') {
				codeButton.click();
				await sleep(100);
			}
		}

		console.log("Going left...")
		// First navigate all the way left
		while (true) {
			const versionButton = modalContainer.querySelector(config.SELECTORS.ARTIFACT_VERSION_SELECT);
			if (!versionButton) break;

			const leftArrow = versionButton.previousElementSibling;
			if (!leftArrow || leftArrow.hasAttribute('disabled')) break;

			leftArrow.click();
			await sleep(200);
		}


		let totalTokens = 0;
		let currentVersion = 1;
		console.log("Going right...")
		// Now go through all versions from left to right
		while (true) {
			// Count tokens for current version
			const codeBlock = modalContainer.querySelector('.code-block__code code');
			if (codeBlock) {
				const versionTokens = calculateTokens(codeBlock.textContent || '');
				totalTokens += versionTokens;
				console.log(`${artifactName} - Version ${currentVersion}/${versionCount}: ${versionTokens} tokens`);
				currentVersion++;
			}

			// Try to go right
			const versionButton = modalContainer.querySelector(config.SELECTORS.ARTIFACT_VERSION_SELECT);
			if (!versionButton) break;

			const rightArrow = versionButton.nextElementSibling;
			if (!rightArrow || rightArrow.hasAttribute('disabled')) break;

			rightArrow.click();
			await sleep(100);
		}

		console.log(`${artifactName} - Total tokens across all versions: ${totalTokens}`);

		if (totalTokens > 0) {
			storageManager.saveFileTokens(
				getConversationId(),
				`${artifactName}_v${versionCount}`,
				totalTokens,
				'artifact'
			);
		}

		// Close the artifact view
		const backButton = modalContainer.querySelector(config.SELECTORS.BACK_BUTTON);
		if (backButton) {
			backButton.click();
			await sleep(200);
		}

		return totalTokens;
	}

	async function getArtifactTokens() {
		let totalTokens = 0;
		const processedNames = new Set();

		while (true) {
			const sidebar = document.querySelector(config.SELECTORS.SIDEBAR_CONTENT);
			if (!sidebar) {
				console.log('Could not find sidebar');
				break;
			}

			// Find artifacts list again (since it may have been recreated)
			const artifactsUl = Array.from(sidebar.querySelectorAll('ul')).find(ul => {
				const prevHeader = ul.previousElementSibling;
				return prevHeader?.tagName === 'H3' && prevHeader.textContent === 'Artifacts';
			});

			if (!artifactsUl) {
				console.log('Could not find artifacts list');
				break;
			}

			// Find an unprocessed artifact
			let foundNew = false;
			for (const li of artifactsUl.querySelectorAll('li')) {
				const button = li.querySelector('button');
				if (!button) continue;

				const name = button.querySelector('.break-words')?.textContent;
				if (!name || processedNames.has(name)) continue;
				console.log('Processing artifact:', name);

				const description = button.querySelector('.text-text-400')?.textContent;
				const versionMatch = description?.match(/(\d+) versions?$/);
				const versionCount = versionMatch ? parseInt(versionMatch[1]) : 1;
				console.log("Version count:", versionCount);

				// Found a new artifact to process
				processedNames.add(name);
				foundNew = true;
				let newTokens = await handleArtifact(button, name, versionCount);
				console.log("Artifact tokens:", newTokens);
				totalTokens += newTokens
				break;
			}

			// If we didn't find any new artifacts, we're done
			if (!foundNew) break;
		}

		return totalTokens;
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
			${isMobileView() && !isActive ? 'display: none;' : ''}
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

		function setActive(active) {
			activeIndicator.style.opacity = active ? '1' : '0';
			container.style.opacity = active ? '1' : '0.7';

			if (isMobileView()) {
				// In mobile, completely hide inactive sections
				container.style.display = active ? 'block' : 'none';
			} else {
				// In desktop, just collapse inactive sections
				container.style.display = 'block';
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
		}

		return {
			container,
			progressBar,
			resetTimeDisplay,
			tooltip,
			messageCounter,
			setActive
		};
	}

	function createSettingsButton() {
		const button = document.createElement('div');
		button.innerHTML = `
			<svg viewBox="0 0 24 24" width="20" height="20" style="cursor: pointer;">
				<path fill="currentColor" d="M12,15.5A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Zm0-5A1.5,1.5,0,1,0,13.5,12,1.5,1.5,0,0,0,12,10.5Zm7.11,4.13a7.92,7.92,0,0,0,.14-1.64s0-.08,0-.12l1.87-.93a.34.34,0,0,0,.14-.45l-1.36-2.36a.34.34,0,0,0-.44-.14l-1.94,1a7.49,7.49,0,0,0-1.42-.82l-.22-2.16a.34.34,0,0,0-.34-.3H12.36a.34.34,0,0,0-.34.3l-.22,2.16a7.49,7.49,0,0,0-1.42.82l-1.94-1a.34.34,0,0,0-.44.14L6.64,11.89a.34.34,0,0,0,.14.45l1.87.93c0,.04,0,.08,0,.12a7.92,7.92,0,0,0,.14,1.64l-1.87.93a.34.34,0,0,0-.14.45l1.36,2.36a.34.34,0,0,0,.44.14l1.94-1a7.49,7.49,0,0,0,1.42.82l.22,2.16a.34.34,0,0,0,.34.3h2.72a.34.34,0,0,0,.34-.3l.22-2.16a7.49,7.49,0,0,0,1.42-.82l1.94,1a.34.34,0,0,0,.44-.14l1.36-2.36a.34.34,0,0,0-.14-.45Z"/>
			</svg>
		`;
		button.style.cssText = `
			margin-left: auto;
			display: flex;
			align-items: center;
			color: #3b82f6;
		`;
		return button;
	}

	function createSettingsPopup() {
		const popup = document.createElement('div');
		popup.style.cssText = `
			position: absolute;
			bottom: 100%;
			right: 0;
			background: #2D2D2D;
			border: 1px solid #3B3B3B;
			border-radius: 8px;
			padding: 12px;
			margin-bottom: 8px;
			z-index: 10000;
			max-height: 300px;
			overflow-y: auto;
			width: 250px;
		`;

		const checkboxContainer = document.createElement('div');
		checkboxContainer.style.cssText = `
			display: flex;
			flex-direction: column;
			gap: 8px;
		`;

		const states = storageManager.getCheckboxStates();

		Object.entries(config.CHECKBOX_OPTIONS).forEach(([key, option]) => {
			const wrapper = document.createElement('div');
			wrapper.style.cssText = `
				display: flex;
				align-items: center;
				gap: 8px;
			`;

			const checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.checked = states[key] || false;
			checkbox.addEventListener('change', async (e) => {
				storageManager.setCheckboxState(key, e.target.checked);
				updateProgressBar(await countTokens(), true);  // Update UI to reflect new costs
			});

			const label = document.createElement('label');
			label.style.cssText = `
				color: white;
				font-size: 12px;
				flex-grow: 1;
			`;
			label.textContent = `${option.text} (+${option.cost})`;

			wrapper.appendChild(checkbox);
			wrapper.appendChild(label);
			checkboxContainer.appendChild(wrapper);
		});

		popup.appendChild(checkboxContainer);
		return popup;
	}


	function createUI() {
		const currentModel = getCurrentModel();
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
			cursor: move;
		`;

		const arrow = document.createElement('div');
		arrow.innerHTML = '▼';
		arrow.style.cssText = `
			cursor: pointer;
			transition: transform 0.2s;
		`;

		const settingsButton = createSettingsButton();
		let settingsPopup = null;

		settingsButton.addEventListener('click', (e) => {
			e.stopPropagation();

			if (settingsPopup) {
				settingsPopup.remove();
				settingsPopup = null;
				return;
			}

			settingsPopup = createSettingsPopup();
			header.appendChild(settingsPopup);
		});

		header.appendChild(arrow);
		header.appendChild(document.createTextNode('Usage Tracker'));
		header.appendChild(settingsButton);

		// Counters
		const currentConversationDisplay = document.createElement('div');
		currentConversationDisplay.style.cssText = `
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
		estimateDisplay.textContent = 'Est. messages left: Loading...';

		const lengthDisplay = document.createElement('div');
		lengthDisplay.id = 'conversation-token-count';
		lengthDisplay.style.cssText = `
			color: #888;
			font-size: 11px;
			margin-top: 4px;
		`;
		lengthDisplay.textContent = 'Current length: 0 tokens';

		currentConversationDisplay.appendChild(estimateDisplay);
		currentConversationDisplay.appendChild(lengthDisplay);

		// Content container (collapsible)
		const content = document.createElement('div');
		content.style.cssText = `
			padding: 0 10px 10px 10px;
			width: 250px;
		`;

		// Create sections for each model
		config.MODELS.forEach(model => {
			const isActive = model === currentModel;
			const section = createModelSection(model, isActive);
			modelSections[model] = section;
			content.appendChild(section.container);
		});

		container.appendChild(header);
		container.appendChild(currentConversationDisplay);
		container.appendChild(content);
		document.body.appendChild(container);

		// Get stored collapse state
		let isCollapsed = storageManager.getCollapsedState();
		content.style.display = isCollapsed ? 'none' : 'block';
		arrow.style.transform = isCollapsed ? 'rotate(-90deg)' : '';

		// Toggle collapse/expand
		arrow.addEventListener('click', (e) => {
			e.stopPropagation();
			isCollapsed = !isCollapsed;
			content.style.display = isCollapsed ? 'none' : 'block';
			arrow.style.transform = isCollapsed ? 'rotate(-90deg)' : '';
			// Store the new state
			storageManager.setCollapsedState(isCollapsed);
		});

		// Dragging functionality
		let isDragging = false;
		let currentX;
		let currentY;
		let initialX;
		let initialY;

		function handleDragStart(e) {
			if (e.target === arrow) return;

			isDragging = true;
			if (e.type === "mousedown") {
				initialX = e.clientX - container.offsetLeft;
				initialY = e.clientY - container.offsetTop;
			} else if (e.type === "touchstart") {
				initialX = e.touches[0].clientX - container.offsetLeft;
				initialY = e.touches[0].clientY - container.offsetTop;
			}
			header.style.cursor = 'grabbing';
		}

		function handleDragMove(e) {
			if (!isDragging) return;
			e.preventDefault();

			if (e.type === "mousemove") {
				currentX = e.clientX - initialX;
				currentY = e.clientY - initialY;
			} else if (e.type === "touchmove") {
				currentX = e.touches[0].clientX - initialX;
				currentY = e.touches[0].clientY - initialY;
			}

			const maxX = window.innerWidth - container.offsetWidth;
			const maxY = window.innerHeight - container.offsetHeight;
			currentX = Math.min(Math.max(0, currentX), maxX);
			currentY = Math.min(Math.max(0, currentY), maxY);

			container.style.left = `${currentX}px`;
			container.style.top = `${currentY}px`;
			container.style.right = 'auto';
			container.style.bottom = 'auto';
		}

		function handleDragEnd() {
			isDragging = false;
			header.style.cursor = 'move';
		}

		// Mouse events
		header.addEventListener('mousedown', handleDragStart);
		document.addEventListener('mousemove', handleDragMove);
		document.addEventListener('mouseup', handleDragEnd);

		// Touch events
		header.addEventListener('touchstart', handleDragStart, { passive: false });
		document.addEventListener('touchmove', handleDragMove, { passive: false });
		document.addEventListener('touchend', handleDragEnd);
		document.addEventListener('touchcancel', handleDragEnd);
	}

	function updateProgressBar(conversationLength, updateLength = true, shouldCollapse = false) {
		// Update each model section
		console.log("Updating progress bar...", conversationLength)

		const lengthDisplay = document.getElementById('conversation-token-count');
		if (lengthDisplay && updateLength) {
			lengthDisplay.textContent = `Current length: ${conversationLength.toLocaleString()} tokens`;
		}

		// Update messages left estimate
		const estimateDisplay = document.getElementById('messages-left-estimate');
		if (estimateDisplay && updateLength) {
			const estimate = storageManager.calculateMessagesLeft(currentlyDisplayedModel, conversationLength);
			estimateDisplay.textContent = `Est. messages left: ${estimate}`;
		}

		// Update each model section
		config.MODELS.forEach(modelName => {
			const section = modelSections[modelName];
			if (!section) return;

			const isActiveModel = modelName === currentlyDisplayedModel;
			if (shouldCollapse || isMobileView()) {  // Only call setActive when we actually want to collapse OR if we're on mobile.
				section.setActive(isActiveModel);
			}

			const stored = storageManager.getModelData(modelName);

			if (stored) {
				const modelTotal = stored.total;
				const messageCount = stored.messageCount || 0;
				const maxTokens = config.MODEL_TOKENS[modelName] || config.MODEL_TOKENS.default;
				const percentage = (modelTotal / maxTokens) * 100;

				section.progressBar.style.width = `${Math.min(percentage, 100)}%`;
				section.progressBar.style.background = modelTotal >= maxTokens * config.WARNING_THRESHOLD ? '#ef4444' : '#3b82f6';
				section.tooltip.textContent = `${modelTotal.toLocaleString()} / ${maxTokens.toLocaleString()} tokens (${percentage.toFixed(1)}%)`;
				section.messageCounter.textContent = `Messages: ${messageCount}`;

				section.resetTimeDisplay.textContent = storageManager.getFormattedTimeRemaining(modelName);
			} else {
				section.progressBar.style.width = '0%';
				section.tooltip.textContent = `0 / ${config.MODEL_TOKENS[modelName].toLocaleString()} tokens (0.0%)`;
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
			const messages = document.querySelectorAll(config.SELECTORS.AI_MESSAGE);
			const userMessages = document.querySelectorAll(config.SELECTORS.USER_MESSAGE);

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
		const userMessages = document.querySelectorAll(config.SELECTORS.USER_MESSAGE);
		const aiMessages = document.querySelectorAll(config.SELECTORS.AI_MESSAGE);
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
		let analysisToolUsed = false;
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

				const button = msg.querySelector('button.flex.justify-start.items-center.pt-2');
				if (button && button.textContent.trim() === 'View analysis') {
					console.log('Found the "View analysis" button in AI message', index);
					analysisToolUsed = true;
				}
			} else {
				console.log(`Skipping AI message ${index} - still streaming`);
			}
		});

		if (analysisToolUsed && !storageManager.getCheckboxStates().analysis_enabled) {
			console.log("Analysis tool used but checkbox disabled, adding analysis cost");
			currentCount += config.CHECKBOX_OPTIONS.analysis_enabled.cost
		}

		// Handle files from sidebar
		if (await ensureSidebarLoaded()) {
			try {
				currentCount += await getContentTokens();
				currentCount += await getProjectTokens();
			} catch (error) {
				console.error('Error processing files:', error);
			}

		} else {
			console.log("Could not load sidebar, skipping files");
		}


		if (!AI_output) {
			console.log("No complete AI output found, waiting...");
			AI_output = await getOutputMessage();
		}

		// Process the AI output if we have it (with multiplication)
		if (AI_output) {
			const text = AI_output.textContent || '';
			const tokens = calculateTokens(text) * config.OUTPUT_TOKEN_MULTIPLIER;
			console.log("Processing final AI output:");
			console.log(`Text: "${text}"`);
			console.log(`Tokens: ${tokens}`);
			currentCount += tokens;
		}

		console.log("Now that we've waited for the AI output, we can process artifacts.")

		if (await ensureSidebarLoaded()) {
			try {
				const artifactsTokenCount = await getArtifactTokens();
				currentCount += artifactsTokenCount;

				// If we found artifacts but the checkbox isn't enabled, add the cost
				if (artifactsTokenCount > 0) {
					if (!storageManager.getCheckboxStates().artifacts_enabled) {
						console.log("Found artifacts in use but checkbox disabled, adding artifacts cost");
						currentCount += config.CHECKBOX_OPTIONS.artifacts_enabled.cost;
					}
				}
			} catch (error) {
				console.error('Error processing files:', error);
			}
		}

		currentCount += config.BASE_SYSTEM_PROMPT_LENGTH;
		currentCount += storageManager.getExtraCost();

		// Ensure sidebar is closed...
		console.log("Closing sidebar...")
		const sidebar = document.querySelector(config.SELECTORS.SIDEBAR_CONTENT);
		if (sidebar) {
			const style = window.getComputedStyle(sidebar);
			// If sidebar is visible (not transformed away)
			const matrixMatch = style.transform.match(/matrix\(([\d.-]+,\s*){5}[\d.-]+\)/);
			const isHidden = matrixMatch && style.transform.includes('428');
			if (!isHidden && style.opacity !== '0') {
				const closeButton = document.querySelector(config.SELECTORS.SIDEBAR_BUTTON);
				if (closeButton) { // Check if button is visible
					console.log("Closing...")
					closeButton.click();
				}
			}
		}

		return currentCount;
	}

	async function updateTokenTotal() {
		const currentModel = getCurrentModel();
		const newCount = await countTokens();
		if (!newCount) return;

		let tries = 0;
		while (currentModel === "default" && tries < 10) {
			await sleep(200);
			currentModel = getCurrentModel();
			tries++;
		}

		if (currentModel !== "default") {
			const { totalTokenCount, messageCount } = storageManager.saveModelData(currentModel, newCount);
			console.log(`Current conversation tokens: ${newCount}`);
			console.log(`Total accumulated tokens: ${totalTokenCount}`);
			console.log(`Messages used: ${messageCount}`);
			console.log(`Added to model: ${currentModel}!`);
		} else {
			console.log("Timed out waiting for model to change from 'default'");
		}

		updateProgressBar(newCount, false);
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

			// Check checkbox states
			const currentCheckboxState = storageManager.getCheckboxStates();
			if (JSON.stringify(currentCheckboxState) !== JSON.stringify(lastCheckboxState)) {
				console.log('Checkbox states changed, updating...');
				lastCheckboxState = { ...currentCheckboxState };
				needsUpdate = true;
			}

			// Check conversation state
			const conversationId = getConversationId();
			if (conversationId == null) {
				console.log("No conversation active, updating progressbar...")
				updateProgressBar(config.BASE_SYSTEM_PROMPT_LENGTH + storageManager.getExtraCost(), true, newModel !== currentlyDisplayedModel);
			}
			const messages = document.querySelectorAll(`${config.SELECTORS.USER_MESSAGE}, ${config.SELECTORS.AI_MESSAGE}`);

			if ((conversationId !== currentConversationId && conversationId !== null) || messages.length !== currentMessageCount) {
				console.log('Conversation changed, recounting tokens');
				currentConversationId = conversationId;
				currentMessageCount = messages.length;
				needsUpdate = true;
			}

			// Check for model change
			if (newModel !== currentlyDisplayedModel) {
				console.log(`Model changed from ${currentlyDisplayedModel} to ${newModel}`);
				currentlyDisplayedModel = newModel;
				// Update all sections - will collapse inactive ones
				config.MODELS.forEach(modelName => {
					const section = modelSections[modelName];
					if (section) {
						section.setActive(modelName === currentlyDisplayedModel);
					}
				});
				needsUpdate = true;
			}

			// Check each model's reset time, update countdown, and check for total changes
			config.MODELS.forEach(model => {
				const stored = storageManager.getModelData(model);
				const section = modelSections[model];

				if (stored) {
					// Update countdown
					section.resetTimeDisplay.textContent = storageManager.getFormattedTimeRemaining(model);

					// Check if stored total is different from displayed total
					const displayedTotal = parseInt(section.tooltip.textContent
						.split('/')[0]
						.replace(/[,\.]/g, '')  // Remove both dots and commas
						.trim());
					if (stored.total !== displayedTotal) {
						console.log(`Detected change in total for ${model}: ${displayedTotal} -> ${stored.total}`);
						needsUpdate = true;
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
				let newTokenCount = await countTokens();
				if (!newTokenCount)
					return
				updateProgressBar(newTokenCount, true, newModel !== currentlyDisplayedModel);
			}
		}, config.POLL_INTERVAL_MS);
	}


	async function handleTokenCount() {
		isProcessingEvent = true;
		try {
			const delay = getConversationId() ? config.DELAY_MS : 5000;
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
			const regenerateButton = e.target.closest(`button:has(path[d="${config.SELECTORS.REGENERATE_BUTTON_PATH}"])`);
			const saveButton = e.target.closest(config.SELECTORS.SAVE_BUTTON);
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
			const mainInput = e.target.closest(config.SELECTORS.MAIN_INPUT);
			const editArea = e.target.closest(config.SELECTORS.EDIT_TEXTAREA);

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
		const MAX_RETRIES = 15;
		const RETRY_DELAY = 200;
		// Load and assign configuration to global variables
		config = await loadConfig();
		config.MODELS = Object.keys(config.MODEL_TOKENS).filter(key => key !== 'default');

		// Check for duplicate running with retry logic
		let userMenuButton = null;
		let attempts = 0;

		while (!userMenuButton && attempts < MAX_RETRIES) {
			userMenuButton = document.querySelector(config.SELECTORS.USER_MENU_BUTTON);

			if (!userMenuButton) {
				console.log(`User menu button not found, attempt ${attempts + 1}/${MAX_RETRIES}`);
				await sleep(RETRY_DELAY);
				attempts++;
			}
		}

		if (!userMenuButton) {
			console.error('User menu button not found after all attempts');
			return;
		}

		if (userMenuButton.getAttribute('data-script-loaded')) {
			console.log('Script already running, stopping duplicate');
			return;
		}
		userMenuButton.setAttribute('data-script-loaded', true);
		console.log('We\'re unique, initializing Chat Token Counter...');

		storageManager = new StorageManager();
		// Initialize everything else
		currentlyDisplayedModel = getCurrentModel();
		storageManager.initializeOrLoadStorage(currentlyDisplayedModel);
		lastCheckboxState = storageManager.getCheckboxStates();

		setupEvents();
		createUI();
		updateProgressBar(0);
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
