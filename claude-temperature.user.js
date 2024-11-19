// ==UserScript==
// @name         Claude Temperature Control
// @namespace    lugia19.com
// @match        https://claude.ai/*
// @version      1.1.0
// @author       lugia19
// @license      GPLv3
// @description  Allows adjusting the temperature setting for Claude AI.
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
	'use strict';

	//#region Config
	const STORAGE_KEY = 'claudeTemperatureControl';
	const COLLAPSED_STATE_KEY = 'claudeTemperatureControl_collapsed';
	const POLL_INTERVAL_MS = 3000;

	// Selectors and identifiers
	const SELECTORS = {
		USER_MESSAGE: '[data-testid="user-message"]',
		AI_MESSAGE: '.font-claude-message',
	};
	//#endregion

	//#region Storage
	function saveTemperature(value) {
		value = Math.min(Math.max(value, 0), 1); // Clamp value between 0 and 1
		GM_setValue(STORAGE_KEY, value);
	}

	function loadTemperature() {
		return GM_getValue(STORAGE_KEY, 0.9);
	}
	//#endregion

	//#region UI elements
	function createTemperatureControl() {
		const container = document.createElement('div');
		container.style.cssText = `
            position: fixed;
            top: 45%;
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

		const headerText = document.createElement('span');
		headerText.textContent = 'Temperature Control';

		header.appendChild(arrow);
		header.appendChild(headerText);

		// Content container (collapsible)
		const content = document.createElement('div');
		content.style.cssText = `
            padding: 10px;
            width: 250px;
        `;

		const sliderContainer = document.createElement('div');
		sliderContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
        `;

		const slider = document.createElement('input');
		slider.type = 'range';
		slider.min = '0';
		slider.max = '1';
		slider.step = '0.05';
		slider.value = loadTemperature();
		slider.style.cssText = `
            width: 100%;
        `;

		const manualInput = document.createElement('input');
		manualInput.type = 'number';
		manualInput.min = '0';
		manualInput.max = '1';
		manualInput.step = '0.05';
		manualInput.value = loadTemperature();
		manualInput.style.cssText = `
            width: 50px;
            background: #2D2D2D;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 4px;
            -moz-appearance: textfield;
        `;
		manualInput.setAttribute('autocomplete', 'off');

		sliderContainer.appendChild(slider);
		sliderContainer.appendChild(manualInput);
		content.appendChild(sliderContainer);

		container.appendChild(header);
		container.appendChild(content);
		document.body.appendChild(container);

		// Toggle collapse/expand
		let isCollapsed = GM_getValue(COLLAPSED_STATE_KEY, false);

		function updateCollapsedState() {
			content.style.display = isCollapsed ? 'none' : 'block';
			arrow.style.transform = isCollapsed ? 'rotate(-90deg)' : '';
			headerText.textContent = isCollapsed ?
				`Temperature: ${loadTemperature()}` :
				'Temperature Control';
		}

		// Apply initial state
		updateCollapsedState();

		arrow.addEventListener('click', (e) => {
			e.stopPropagation();
			isCollapsed = !isCollapsed;
			GM_setValue(COLLAPSED_STATE_KEY, isCollapsed);
			updateCollapsedState();
		});

		// Update header text when temperature changes
		slider.addEventListener('input', () => {
			manualInput.value = slider.value;
			saveTemperature(slider.value);
			if (isCollapsed) {
				headerText.textContent = `Temperature: ${slider.value}`;
			}
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

		// Update manual input when slider changes
		slider.addEventListener('input', () => {
			manualInput.value = slider.value;
			saveTemperature(slider.value);
		});

		// Update slider when manual input changes
		manualInput.addEventListener('input', () => {
			slider.value = manualInput.value;
			saveTemperature(manualInput.value);
			if (isCollapsed) {
				headerText.textContent = `Temperature: ${manualInput.value}`;
			}
		});

		return slider;
	}
	//#endregion

	//#region URL handling
	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function updateUrl(temperature) {
		const conversationId = getConversationId();
		if (conversationId) {
			const newUrl = `/chat/${conversationId}?t=${temperature}`;
			window.location.href = newUrl;
		}
	}

	async function isGenerating() {
		const tempUserMessages = document.querySelectorAll(SELECTORS.USER_MESSAGE);
		await new Promise(resolve => setTimeout(resolve, 100));
		const tempAIMessages = document.querySelectorAll(SELECTORS.AI_MESSAGE);
		await new Promise(resolve => setTimeout(resolve, 100));

		console.log(tempUserMessages)
		console.log(tempAIMessages)
		await new Promise(resolve => setTimeout(resolve, 100));

		if (!tempUserMessages) {
			console.log("Returning false due to no tempUserMessages")
			return false;
		}

		if (!tempAIMessages || tempAIMessages.length === 0) {
			console.log("Returning false due to no tempAIMessages")
			return true;
		}

		// Check if we have a complete set of messages
		let allFinished = true;
		tempAIMessages.forEach(msg => {
			const parent = msg.closest('[data-is-streaming]');
			if (!parent || parent.getAttribute('data-is-streaming') !== 'false') {
				allFinished = false;
			}
		});
		console.log(`Returning ${allFinished}`)
		return !allFinished
	}

	let isCheckUrlRunning = false;

	async function checkUrl() {
		if (isCheckUrlRunning) {
			console.log('checkUrl is already running, skipping this instance');
			return;
		}

		isCheckUrlRunning = true;
		try {
			const conversationId = getConversationId();
			if (!conversationId) return;

			const temperature = loadTemperature();
			const urlParams = new URLSearchParams(window.location.search);
			const currentTemp = urlParams.get('t');

			if (currentTemp !== temperature.toString()) {
				console.log(`Temperature mismatch: URL ${currentTemp}, stored ${temperature}`);
				let consecutiveSuccesses = 0;
				let sawGenerating = false;

				while (consecutiveSuccesses < 3) {
					if (!(await isGenerating())) {
						consecutiveSuccesses++;
						console.log(`AI not currently generating, success ${consecutiveSuccesses}/3`);

						if (consecutiveSuccesses === 3) {
							console.log('AI confirmed not generating');
							if (sawGenerating) {
								console.log('Waiting 5s due to previous generation activity');
								await new Promise(resolve => setTimeout(resolve, 5000));
							}
							updateUrl(temperature);
							break;
						}
					} else {
						sawGenerating = true;
						consecutiveSuccesses = 0;
						console.log('AI is currently generating, waiting to update URL');
					}

					await new Promise(resolve => setTimeout(resolve, 1000));
				}
			}
		} finally {
			isCheckUrlRunning = false;
		}
	}
	//#endregion

	function initialize() {
		console.log('Initializing Claude Temperature Control...');
		const slider = createTemperatureControl();

		// Load initial temperature and update UI
		const initialTemp = loadTemperature();
		slider.value = initialTemp;

		// Start polling
		setInterval(checkUrl, POLL_INTERVAL_MS);

		console.log('Initialization complete. Ready to control temperature.');
	}

	initialize();
})();