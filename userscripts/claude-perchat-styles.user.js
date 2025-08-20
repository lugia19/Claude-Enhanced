// ==UserScript==
// @name         Claude Per-Chat Styles
// @namespace    https://lugia19.com
// @match        https://claude.ai/*
// @version      1.0.1
// @author       lugia19
// @license      MIT
// @description  Allows setting styles on a per-chat basis for Claude.ai
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
	'use strict';

	// ======== POLYGLOT SETUP ========
	console.log("🛠️ Claude Per-Chat Styles script loaded");
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

	// ======== UTILITY FUNCTIONS ========
	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function getOrgId() {
		const cookies = document.cookie.split(';');
		for (const cookie of cookies) {
			const [name, value] = cookie.trim().split('=');
			if (name === 'lastActiveOrg') {
				return value;
			}
		}
		throw new Error('Could not find organization ID');
	}

	// ======== STYLE FETCHING ========
	async function fetchAvailableStyles() {
		try {
			const orgId = getOrgId();
			const response = await fetch(`/api/organizations/${orgId}/list_styles`);

			if (!response.ok) {
				console.error('Failed to fetch styles:', response.statusText);
				return [];
			}

			const data = await response.json();
			const styles = [];

			// Add "None" option first
			styles.push({
				type: 'none',
				uuid: 'none',
				name: 'Use current',
				key: 'none'
			});

			// Process default styles
			if (data.defaultStyles) {
				data.defaultStyles.forEach(style => {
					styles.push({
						...style,
						key: style.key
					});
				});
			}

			// Process custom styles
			if (data.customStyles) {
				data.customStyles.forEach(style => {
					styles.push({
						...style,
						key: style.uuid
					});
				});
			}

			return styles;
		} catch (error) {
			console.error('Error fetching styles:', error);
			return [];
		}
	}

	// ======== UI CREATION ========
	function createStyleButton() {
		const button = document.createElement('button');
		button.className = `inline-flex items-center justify-center relative shrink-0 ring-offset-2 ring-offset-bg-300 
			ring-accent-main-100 focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none 
			disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none text-text-200 border-transparent 
			transition-colors font-styrene active:bg-bg-400 hover:bg-bg-500/40 hover:text-text-100 h-9 w-9 
			rounded-md active:scale-95 shrink-0 style-selector-button`;

		// Placeholder SVG icon - replace with your preferred icon later
		button.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="shrink-0" aria-hidden="true"><path d="M15.5117 1.99707C15.9213 2.0091 16.3438 2.13396 16.6768 2.46679C17.0278 2.81814 17.1209 3.26428 17.0801 3.68261C17.0404 4.08745 16.8765 4.49344 16.6787 4.85058C16.3934 5.36546 15.9941 5.85569 15.6348 6.20898C15.7682 6.41421 15.8912 6.66414 15.9551 6.9453C16.0804 7.4977 15.9714 8.13389 15.4043 8.70116C14.8566 9.24884 13.974 9.54823 13.1943 9.71679C12.7628 9.81003 12.3303 9.86698 11.9473 9.90233C12.0596 10.2558 12.0902 10.7051 11.8779 11.2012L11.8223 11.3203C11.5396 11.8854 11.0275 12.2035 10.4785 12.3965C9.93492 12.5875 9.29028 12.6792 8.65332 12.75C7.99579 12.8231 7.34376 12.8744 6.70117 12.9775C6.14371 13.067 5.63021 13.1903 5.18652 13.3818L5.00585 13.4658C4.53515 14.2245 4.13745 14.9658 3.80957 15.6465C4.43885 15.2764 5.1935 15 5.99999 15C6.27614 15 6.49999 15.2238 6.49999 15.5C6.49999 15.7761 6.27613 16 5.99999 16C5.35538 16 4.71132 16.2477 4.15039 16.6103C3.58861 16.9736 3.14957 17.427 2.91601 17.7773C2.91191 17.7835 2.90568 17.788 2.90136 17.7939C2.88821 17.8119 2.8746 17.8289 2.85937 17.8447C2.85117 17.8533 2.84268 17.8612 2.83398 17.8691C2.81803 17.8835 2.80174 17.897 2.78417 17.9092C2.774 17.9162 2.76353 17.9225 2.75292 17.9287C2.73854 17.9372 2.72412 17.9451 2.70898 17.9521C2.69079 17.9605 2.6723 17.9675 2.65332 17.9736C2.6417 17.9774 2.63005 17.9805 2.61816 17.9834C2.60263 17.9872 2.5871 17.9899 2.57128 17.9922C2.55312 17.9948 2.53511 17.9974 2.5166 17.998C2.50387 17.9985 2.49127 17.9976 2.47851 17.9971C2.45899 17.9962 2.43952 17.9954 2.41992 17.9922C2.40511 17.9898 2.39062 17.9862 2.37597 17.9824C2.36477 17.9795 2.35294 17.9783 2.34179 17.9746C2.33697 17.973 2.33286 17.9695 2.32812 17.9678C2.31042 17.9612 2.29351 17.953 2.27636 17.9443C2.26332 17.9378 2.25053 17.9314 2.23828 17.9238C2.23339 17.9208 2.22747 17.9192 2.22265 17.916C2.21414 17.9103 2.20726 17.9026 2.19921 17.8965C2.18396 17.8849 2.16896 17.8735 2.15527 17.8603C2.14518 17.8507 2.13609 17.8404 2.12695 17.8301C2.11463 17.8161 2.10244 17.8023 2.09179 17.7871C2.08368 17.7756 2.07736 17.7631 2.07031 17.751C2.06168 17.7362 2.05297 17.7216 2.04589 17.706C2.03868 17.6901 2.03283 17.6738 2.02734 17.6572C2.0228 17.6436 2.01801 17.6302 2.01464 17.6162C2.01117 17.6017 2.009 17.587 2.00683 17.5722C2.00411 17.5538 2.00161 17.5354 2.00097 17.5166C2.00054 17.5039 2.00141 17.4912 2.00195 17.4785C2.00279 17.459 2.00364 17.4395 2.00683 17.4199C2.00902 17.4064 2.01327 17.3933 2.0166 17.3799C2.01973 17.3673 2.02123 17.3543 2.02539 17.3418C2.41772 16.1648 3.18163 14.466 4.30468 12.7012C4.31908 12.5557 4.34007 12.3582 4.36914 12.1201C4.43379 11.5907 4.53836 10.8564 4.69921 10.0381C5.0174 8.41955 5.56814 6.39783 6.50585 4.9912L6.73242 4.66894C7.27701 3.93277 7.93079 3.30953 8.61035 2.85156C9.3797 2.33311 10.2221 2 11.001 2C11.7951 2.00025 12.3531 2.35795 12.7012 2.70605C12.7723 2.77723 12.8348 2.84998 12.8896 2.91796C13.2829 2.66884 13.7917 2.39502 14.3174 2.21191C14.6946 2.08056 15.1094 1.98537 15.5117 1.99707ZM17.04 15.5537C17.1486 15.3 17.4425 15.1818 17.6963 15.29C17.95 15.3986 18.0683 15.6925 17.96 15.9463C17.4827 17.0612 16.692 18 15.5 18C14.6309 17.9999 13.9764 17.5003 13.5 16.7978C13.0236 17.5003 12.3691 18 11.5 18C10.6309 17.9999 9.97639 17.5003 9.49999 16.7978C9.02359 17.5003 8.36911 18 7.49999 18C7.22391 17.9999 7 17.7761 6.99999 17.5C6.99999 17.2239 7.22391 17 7.49999 17C8.07039 17 8.6095 16.5593 9.04003 15.5537L9.07421 15.4873C9.16428 15.3412 9.32494 15.25 9.49999 15.25C9.70008 15.25 9.88121 15.3698 9.95996 15.5537L10.042 15.7353C10.4581 16.6125 10.9652 16.9999 11.5 17C12.0704 17 12.6095 16.5593 13.04 15.5537L13.0742 15.4873C13.1643 15.3412 13.3249 15.25 13.5 15.25C13.7001 15.25 13.8812 15.3698 13.96 15.5537L14.042 15.7353C14.4581 16.6125 14.9652 16.9999 15.5 17C16.0704 17 16.6095 16.5593 17.04 15.5537ZM15.4824 2.99707C15.247 2.99022 14.9608 3.04682 14.6465 3.15624C14.0173 3.37541 13.389 3.76516 13.0498 4.01953C12.9277 4.11112 12.7697 4.14131 12.6221 4.10253C12.4745 4.06357 12.3522 3.9591 12.291 3.81933V3.81835C12.2892 3.81468 12.2861 3.80833 12.2822 3.80078C12.272 3.78092 12.2541 3.7485 12.2295 3.70898C12.1794 3.62874 12.1011 3.52019 11.9941 3.41308C11.7831 3.2021 11.4662 3.00024 11.001 2.99999C10.4904 2.99999 9.84173 3.22729 9.16894 3.68066C8.58685 4.07297 8.01568 4.61599 7.5371 5.26269L7.33789 5.54589C6.51634 6.77827 5.99475 8.63369 5.68066 10.2314C5.63363 10.4707 5.5913 10.7025 5.55371 10.9238C7.03031 9.01824 8.94157 7.19047 11.2812 6.05077C11.5295 5.92989 11.8283 6.03301 11.9492 6.28124C12.0701 6.52949 11.967 6.82829 11.7187 6.94921C9.33153 8.11208 7.38648 10.0746 5.91406 12.1103C6.12313 12.0632 6.33385 12.0238 6.54296 11.9902C7.21709 11.8821 7.92723 11.8243 8.54296 11.7558C9.17886 11.6852 9.72123 11.6025 10.1465 11.4531C10.5662 11.3056 10.8063 11.1158 10.9277 10.873L10.9795 10.7549C11.0776 10.487 11.0316 10.2723 10.9609 10.1123C10.918 10.0155 10.8636 9.93595 10.8203 9.88183C10.7996 9.85598 10.7822 9.83638 10.7715 9.82518L10.7607 9.81542L10.7627 9.8164L10.7646 9.81835C10.6114 9.67972 10.5597 9.46044 10.6338 9.26757C10.7082 9.07475 10.8939 8.94726 11.1006 8.94726C11.5282 8.94719 12.26 8.8956 12.9834 8.73925C13.7297 8.5779 14.3654 8.32602 14.6973 7.99413C15.0087 7.68254 15.0327 7.40213 14.9795 7.16698C14.9332 6.96327 14.8204 6.77099 14.707 6.62792L14.5957 6.50195C14.4933 6.39957 14.4401 6.25769 14.4502 6.11327C14.4605 5.96888 14.5327 5.83599 14.6484 5.74902C14.9558 5.51849 15.4742 4.96086 15.8037 4.3662C15.9675 4.07048 16.0637 3.80137 16.085 3.58593C16.1047 3.38427 16.0578 3.26213 15.9697 3.17382C15.8631 3.06726 15.7102 3.00377 15.4824 2.99707Z"></path></svg>`;

		// Add tooltip wrapper
		const tooltipWrapper = document.createElement('div');
		tooltipWrapper.setAttribute('data-radix-popper-content-wrapper', '');
		tooltipWrapper.style.cssText = `
			position: fixed;
			left: 0px;
			top: 0px;
			min-width: max-content;
			--radix-popper-transform-origin: 50% 0px;
			z-index: 50;
			display: none;
		`;

		tooltipWrapper.innerHTML = `
			<div data-side="bottom" data-align="center" data-state="delayed-open" 
				class="px-2 py-1 text-xs font-medium font-sans leading-tight rounded-md shadow-md text-white bg-black/80 backdrop-blur break-words z-tooltip max-w-[13rem]">
				<span class="tooltip-text">Chat style: None</span>
			</div>
		`;

		// Add hover events
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

		button.onclick = async () => {
			await showStyleModal();
		};

		// Store reference to tooltip on button for updates
		button.tooltipWrapper = tooltipWrapper;

		// Add tooltip to document
		document.body.appendChild(tooltipWrapper);

		return button;
	}

	async function showStyleModal() {
		const conversationId = getConversationId();
		if (!conversationId) {
			console.error('No conversation ID found');
			return;
		}

		const modal = document.createElement('div');
		modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';

		// Fetch available styles
		const styles = await fetchAvailableStyles();

		// Get current selection
		const currentStyle = await getStorageValue(`style_${conversationId}`, null);
		const currentStyleId = currentStyle ? currentStyle.key : 'none';

		// Build options HTML
		const optionsHtml = styles.map(style => {
			const selected = style.key === currentStyleId ? 'selected' : '';
			return `<option value="${style.key}" ${selected}>${style.name}</option>`;
		}).join('');

		modal.innerHTML = `
			<div class="bg-bg-100 rounded-lg p-6 shadow-xl max-w-sm w-full mx-4 border border-border-300">
				<h3 class="text-lg font-semibold mb-4 text-text-100">Select Chat Style</h3>
				<select class="w-full p-2 rounded mb-4 bg-bg-200 text-text-100 border border-border-300">
					${optionsHtml}
				</select>
				<div class="text-sm text-text-400 mb-4">
					This style will override your default style for this chat only.
				</div>
				<div class="flex justify-end gap-2">
					<button class="px-4 py-2 text-text-200 hover:bg-bg-500/40 rounded" id="cancelStyle">Cancel</button>
					<button class="px-4 py-2 bg-accent-main-100 text-oncolor-100 rounded" id="confirmStyle">Apply</button>
				</div>
			</div>
		`;

		document.body.appendChild(modal);

		return new Promise((resolve) => {
			const select = modal.querySelector('select');

			modal.querySelector('#cancelStyle').onclick = () => {
				modal.remove();
				resolve(null);
			};

			modal.querySelector('#confirmStyle').onclick = async () => {
				const selectedUuid = select.value;
				if (selectedUuid === 'none') {
					// Clear the style for this conversation
					await deleteStorageValue(`style_${conversationId}`);
				} else {
					// Find the full style object
					const selectedStyle = styles.find(s => s.key === selectedUuid);
					if (selectedStyle && selectedStyle.type !== 'none') {
						await setStorageValue(`style_${conversationId}`, selectedStyle);
					}
				}

				// Update button appearance
				await updateButtonAppearance();

				modal.remove();
				resolve(selectedUuid);
			};

			modal.onclick = (e) => {
				if (e.target === modal) {
					modal.remove();
					resolve(null);
				}
			};
		});
	}

	async function updateButtonAppearance() {
		const button = document.querySelector('.style-selector-button');
		if (!button) return;

		const conversationId = getConversationId();
		if (!conversationId) return;

		const currentStyle = await getStorageValue(`style_${conversationId}`, null);

		// Validate that the stored style still exists
		if (currentStyle && currentStyle.type !== 'none') {
			const availableStyles = await fetchAvailableStyles();
			const styleStillExists = availableStyles.some(s => s.key === currentStyle.key);

			if (!styleStillExists) {
				console.log(`Style "${currentStyle.name}" no longer exists, clearing selection`);
				await deleteStorageValue(`style_${conversationId}`);
				// Reset to show "Use current"
				button.style.color = '';
				const tooltipText = button.tooltipWrapper?.querySelector('.tooltip-text');
				if (tooltipText) {
					tooltipText.textContent = 'Chat style: Use current';
				}
				return;
			}
		}

		if (currentStyle) {
			// Style is selected and valid - make button blue
			button.style.color = '#0084ff';
			const tooltipText = button.tooltipWrapper?.querySelector('.tooltip-text');
			if (tooltipText) {
				tooltipText.textContent = `Chat style: ${currentStyle.name}`;
			}
		} else {
			// No style selected - using global default
			button.style.color = '';
			const tooltipText = button.tooltipWrapper?.querySelector('.tooltip-text');
			if (tooltipText) {
				tooltipText.textContent = 'Chat style: Use current';
			}
		}
	}

	// ======== FETCH PATCHING ========
	const originalFetch = unsafeWindow.fetch;
	unsafeWindow.fetch = async (...args) => {
		const [input, config] = args;

		// Get the URL string
		let url = undefined;
		if (input instanceof URL) {
			url = input.href;
		} else if (typeof input === 'string') {
			url = input;
		} else if (input instanceof Request) {
			url = input.url;
		}

		if (url && url.includes('/styles/') && url.includes('/delete') && config?.method === 'DELETE') {
			// Extract the style ID from the URL
			const styleIdMatch = url.match(/styles\/([^\/]+)\/delete/);
			if (styleIdMatch) {
				const deletedStyleId = styleIdMatch[1];
				console.log(`Style ${deletedStyleId} is being deleted, cleaning up references...`);

				// Let the deletion complete first
				const response = await originalFetch(input, config);

				// Then clean up the current conversation...
				const conversationId = getConversationId();
				if (conversationId) {
					const currentStyle = await getStorageValue(`style_${conversationId}`, null);
					if (currentStyle && (currentStyle.uuid === deletedStyleId || currentStyle.key === deletedStyleId)) {
						await deleteStorageValue(`style_${conversationId}`);
						await updateButtonAppearance();
					}
				}

				return response;
			}
		}

		// Check if this is a completion or retry_completion request
		if (url && (url.includes('/completion') || url.includes('/retry_completion')) && config?.body) {

			const conversationId = getConversationId();

			if (conversationId) {
				const customStyle = await getStorageValue(`style_${conversationId}`, null);

				try {
					const bodyJSON = JSON.parse(config.body);

					if (customStyle && customStyle.type !== 'none') {
						// Replace with custom style
						bodyJSON.personalized_styles = [customStyle];
					} else if (!customStyle) {
					} else {
						// "Use current" selected - send empty array
						bodyJSON.personalized_styles = [];
					}

					config.body = JSON.stringify(bodyJSON);
				} catch (error) {
					console.error('❌ Error modifying request:', error);
				}
			}
		}

		return originalFetch(input, config);
	};

	// ======== INITIALIZATION ========
	async function tryAddButton() {
		const container = document.querySelector('.right-3.flex.gap-2');
		if (!container || container.querySelector('.style-selector-button') || container.querySelectorAll('button').length === 0) {
			return;
		}

		const styleButton = createStyleButton();
		container.insertBefore(styleButton, container.firstChild);

		// Update appearance based on current conversation
		await updateButtonAppearance();
	}

	function initialize() {
		// Try to add the button immediately
		tryAddButton();

		// Check every 5 seconds for SPA navigation
		setInterval(tryAddButton, 5000);

		// Also update button appearance when URL changes (conversation switch)
		let lastUrl = window.location.href;
		setInterval(async () => {
			if (window.location.href !== lastUrl) {
				lastUrl = window.location.href;
				await updateButtonAppearance();
			}
		}, 1000);
	}

	initialize();
})();