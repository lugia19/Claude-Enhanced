// ==UserScript==
// @name         Claude Fork Conversation
// @namespace    https://lugia19.com
// @version      0.6.0
// @description  Adds forking functionality to claude.ai
// @match        https://claude.ai/*
// @grant        none
// @license      GPLv3
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

	let pendingForkModel = null;
	let includeAttachments = true;
	let isProcessing = false;
	let pendingUseSummary = false;

	//#region UI elements creation
	function createBranchButton() {
		const button = document.createElement('button');
		button.className = 'claude-icon-btn h-8 w-8';
		button.type = 'button';
		button.setAttribute('data-state', 'closed');
		button.setAttribute('aria-label', 'Fork from here');

		button.innerHTML = `
        <div class="flex items-center justify-center" style="width: 16px; height: 16px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 22 22" class="shrink-0" aria-hidden="true">
                <path d="M7 5C7 3.89543 7.89543 3 9 3C10.1046 3 11 3.89543 11 5C11 5.74028 10.5978 6.38663 10 6.73244V14.0396H11.7915C12.8961 14.0396 13.7915 13.1441 13.7915 12.0396V10.7838C13.1823 10.4411 12.7708 9.78837 12.7708 9.03955C12.7708 7.93498 13.6662 7.03955 14.7708 7.03955C15.8753 7.03955 16.7708 7.93498 16.7708 9.03955C16.7708 9.77123 16.3778 10.4111 15.7915 10.7598V12.0396C15.7915 14.2487 14.0006 16.0396 11.7915 16.0396H10V17.2676C10.5978 17.6134 11 18.2597 11 19C11 20.1046 10.1046 21 9 21C7.89543 21 7 20.1046 7 19C7 18.2597 7.4022 17.6134 8 17.2676V6.73244C7.4022 6.38663 7 5.74028 7 5Z"/>
            </svg>
        </div>
    `;

		// Apply styles to button
		applyClaudeStyling(button);
		createClaudeTooltip(button, 'Fork from here');

		button.onclick = async (e) => {
			e.preventDefault();
			e.stopPropagation();

			const modal = await createModal();
			document.body.appendChild(modal);

			// Add event listeners
			modal.querySelector('#cancelFork').onclick = () => {
				modal.remove();
			};

			modal.querySelector('#confirmFork').onclick = async () => {
				const model = modal.querySelector('select').value;
				const useSummary = modal.querySelector('#summaryMode').checked;

				const confirmBtn = modal.querySelector('#confirmFork');
				confirmBtn.disabled = true;
				confirmBtn.textContent = 'Processing...';

				await forkConversationClicked(model, button, modal, useSummary);
				modal.remove();
			};

			modal.onclick = (e) => {
				if (e.target === modal) {
					modal.remove();
				}
			};
		};

		// Clean up tooltip when button is removed
		const originalRemove = button.remove.bind(button);
		button.remove = () => {
			tooltipWrapper.remove();
			originalRemove();
		};

		return button;
	}

	async function createModal() {
		const modal = document.createElement('div');
		modal.className = 'claude-modal-backdrop';

		modal.innerHTML = `
		  <div class="claude-modal">
			<h3 class="claude-modal-heading">Choose Model for Fork</h3>
			<select class="claude-select mb-4">
			  <option value="claude-sonnet-4-20250514">Sonnet 4</option>
			  <option value="claude-opus-4-1-20250805">Opus 4.1</option>
			  <option value="claude-opus-4-20250514">Opus 4</option>
			  <option value="claude-3-7-sonnet-20250219">Sonnet 3.7</option>
			  <option value="claude-3-opus-20240229">Opus 3</option>
			  <option value="claude-3-5-haiku-20241022">Haiku 3.5</option>
			</select>
			
			<div class="mb-4 space-y-2">
			  <div class="flex items-center justify-between mb-3 p-2 bg-bg-200 rounded">
				<span class="text-text-100 font-medium">Fork Type:</span>
				<div class="flex items-center gap-4">
				  <label class="claude-check-group space-x-2">
					<input type="radio" id="fullChatlog" name="forkType" value="full" checked class="accent-accent-main-100">
					<span>Full Chatlog</span>
				  </label>
				  <label class="claude-check-group space-x-2">
					<input type="radio" id="summaryMode" name="forkType" value="summary" class="accent-accent-main-100">
					<span>Summary</span>
				  </label>
				</div>
			  </div>
			
			  <div id="includeFilesContainer"></div>
			</div>
			
			<p class="claude-text-sm">Note: Should you choose a slow model such as Opus, you may need to wait and refresh the page for the response to appear.</p>
			<div class="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
			  <button class="claude-btn-primary inline-flex items-center justify-center relative shrink-0 ring-offset-2 ring-offset-bg-300 ring-accent-main-100 focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none bg-gradient-to-r from-accent-main-100 via-accent-main-200/50 to-accent-main-200 bg-[length:200%_100%] hover:bg-right active:bg-accent-main-000 border-0.5 border-border-300 font-medium font-styrene drop-shadow-sm shadow-[inset_0_0.5px_0px_rgba(255,255,0,0.15)] [text-shadow:_0_1px_2px_rgb(0_0_0_/_10%)] active:shadow-[inset_0_1px_6px_rgba(0,0,0,0.2)] hover:from-accent-main-200 hover:to-accent-main-200 rounded-lg active:scale-[0.985] whitespace-nowrap" id="confirmFork">
				Fork Chat
			  </button>
			  <button class="claude-btn-secondary bg-[radial-gradient(ellipse,_var(--tw-gradient-stops))] from-bg-500/10 from-50% to-bg-500/30 border-0.5 border-border-400 font-medium font-styrene text-text-100/90 active:bg-bg-500/50 hover:text-text-000 hover:bg-bg-500/60 rounded-lg active:scale-[0.985] whitespace-nowrap" id="cancelFork">
				Cancel
			  </button>
			</div>
		  </div>
		`;

		// Apply styling to modal
		applyClaudeStyling(modal);

		// Add the toggle for include files
		const includeFilesToggle = createClaudeToggle('Include files', true);
		includeFilesToggle.input.id = 'includeFiles'; // Keep the ID for the querySelector
		modal.querySelector('#includeFilesContainer').appendChild(includeFilesToggle.container);

		try {
			const accountData = await fetchAccountSettings();
			originalSettings = accountData.settings;
		} catch (error) {
			console.error('Failed to fetch account settings:', error);
		}

		return modal;
	}


	function findMessageControls(messageElement) {
		const group = messageElement.closest('.group');
		const buttons = group?.querySelectorAll('button');
		if (!buttons) return null;
		const retryButton = Array.from(buttons).find(button =>
			button.textContent.includes('Retry')
		);
		return retryButton?.closest('.justify-between');
	}

	function addMessageButtonWithPriority(container, button, buttonClass) {
		const MESSAGE_BUTTON_PRIORITY = [
			'tts-speak-button',
			'fork-button',
		];

		// Add button if it doesn't exist
		button.classList.add(buttonClass);
		if (!container.querySelector('.' + buttonClass)) {
			container.appendChild(button);
		}

		// Get all priority buttons that exist
		const priorityButtons = [];
		for (const className of MESSAGE_BUTTON_PRIORITY) {
			const btn = container.querySelector('.' + className);
			if (btn) {
				priorityButtons.push(btn);
			}
		}

		// Special handling for copy button group - should stay at the end
		const copyButtonParent = container.querySelector('[data-testid="action-bar-copy"]')?.parentElement;

		// Get all other elements (non-priority buttons/elements)
		const allElements = Array.from(container.children);
		const otherElements = allElements.filter(elem =>
			!MESSAGE_BUTTON_PRIORITY.some(className => elem.classList.contains(className)) &&
			elem !== copyButtonParent
		);

		// Clear and rebuild: priority buttons, other elements, copy button last
		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}

		[...priorityButtons, ...otherElements].forEach(elem => {
			container.appendChild(elem);
		});

		if (copyButtonParent) {
			container.appendChild(copyButtonParent);
		}
	}

	function addBranchButtons() {
		if (isProcessing) return;
		try {
			isProcessing = true;
			const messages = document.querySelectorAll('.font-claude-response');
			messages.forEach((message) => {
				const controls = findMessageControls(message);
				if (controls && !controls.querySelector('.fork-button')) {
					const branchBtn = createBranchButton();
					branchBtn.setAttribute('aria-label', 'Fork conversation');
					// Use the priority function instead of direct insertion
					addMessageButtonWithPriority(controls, branchBtn, 'fork-button');
				}
			});
		} catch (error) {
			console.error('Error adding branch buttons:', error);
		} finally {
			isProcessing = false;
		}
	}

	//#endregion

	async function forkConversationClicked(model, forkButton, modal, useSummary = false) {
		// Get conversation ID from URL
		const conversationId = window.location.pathname.split('/').pop();
		console.log('Forking conversation', conversationId, 'with model', model);

		if (originalSettings) {
			const newSettings = { ...originalSettings };
			newSettings.paprika_mode = null; // Ensure it's off when we create the conversation (will be overridden to on if needed)
			console.log('Updating settings:', newSettings);
			await updateAccountSettings(newSettings);
		}

		// Set up our global to catch the next retry request
		pendingForkModel = model;
		includeAttachments = modal.querySelector('#includeFiles')?.checked ?? true;
		pendingUseSummary = useSummary;

		// Find and click the retry button in the same control group as our fork button
		const buttonGroup = forkButton.closest('.justify-between');
		const retryButton = Array.from(buttonGroup.querySelectorAll('button'))
			.find(button => button.textContent.includes('Retry'));

		if (retryButton) {
			// Dispatch pointerdown event which Radix UI components use
			retryButton.dispatchEvent(new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				view: window,
				pointerType: 'mouse'
			}));

			// Wait for the dropdown to appear
			await new Promise(resolve => setTimeout(resolve, 300));

			// Look for the dropdown menu with "With no changes" option
			const withNoChangesOption = Array.from(document.querySelectorAll('[role="menuitem"]'))
				.find(element => element.textContent.includes('With no changes'));

			if (withNoChangesOption) {
				console.log('Detected retry dropdown, clicking "With no changes"');
				// For the menu item, a regular click should work
				withNoChangesOption.click();
			} else {
				console.log('No dropdown detected, assuming direct retry');
				retryButton.click();
				// If no dropdown appeared, the retry might have been triggered directly
			}
		} else {
			console.error('Could not find retry button');
		}
	}

	//#region Convo extraction & Other API

	let originalSettings = null;

	async function fetchAccountSettings() {
		const response = await fetch('/api/account');
		console.log('Account settings response:', response);
		const data = await response.json();
		return data;
	}

	async function updateAccountSettings(settings) {
		await fetch('/api/account', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ settings })
		});
	}

	async function getConversationContext(orgId, conversationId, targetParentUuid) {
		const response = await fetch(`/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=False&rendering_mode=messages&render_all_tools=true`);
		const conversationData = await response.json();

		let messages = [];
		let projectUuid = conversationData?.project?.uuid || null;
		const chatName = conversationData.name;
		const files = []
		const syncsources = []
		const attachments = []

		for (const message of conversationData.chat_messages) {
			let messageContent = [];

			// Process content array
			for (const content of message.content) {
				if (content.text) {
					messageContent.push(content.text);
				}
				if (content.input?.code) {
					messageContent.push(content.input.code);
				}
				if (content.content?.text) {
					messageContent.push(content.content.text);
				}
			}

			// Process files with download URLs
			if (message.files_v2) {
				for (const file of message.files_v2) {
					let fileUrl;
					if (file.file_kind === "image") {
						fileUrl = file.preview_asset.url;
					} else if (file.file_kind === "document") {
						fileUrl = file.document_asset.url;
					}

					if (fileUrl) {
						files.push({
							uuid: file.file_uuid,
							url: fileUrl,
							kind: file.file_kind,
							name: file.file_name
						});
					}
				}
			}

			// Add attachment objects
			if (message.attachments) {
				for (const attachment of message.attachments) {
					attachments.push(attachment);
				}
			}

			// Process sync sources
			for (const sync of message.sync_sources) {
				syncsources.push(sync);
			}

			messages.push(messageContent.join(' '));

			// Process until we find a message that has our target UUID as parent
			if (message.parent_message_uuid === targetParentUuid) {
				break;
			}
		}

		if (!includeAttachments) {
			return {
				chatName,
				messages,
				syncsources: [],
				attachments: [],
				files: [],
				projectUuid
			};
		}

		return {
			chatName,
			messages,
			syncsources,
			attachments,
			files,
			projectUuid
		};
	}

	//#region File handlers (download, upload, sync)
	async function downloadFiles(files) {
		const downloadedFiles = [];

		for (const file of files) {
			try {
				const response = await fetch(file.url);
				const blob = await response.blob();

				downloadedFiles.push({
					data: blob,
					name: file.name,
					kind: file.kind,
					originalUuid: file.uuid
				});
			} catch (error) {
				console.error(`Failed to download file ${file.name}:`, error);
			}
		}

		return downloadedFiles;
	}

	async function uploadFile(orgId, file) {
		const formData = new FormData();
		formData.append('file', file.data, file.name);

		const response = await fetch(`/api/${orgId}/upload`, {
			method: 'POST',
			body: formData
		});

		const uploadResult = await response.json();
		return uploadResult.file_uuid;
	}

	async function processSyncSource(orgId, syncsource) {
		const response = await fetch(`/api/organizations/${orgId}/sync/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				sync_source_config: syncsource?.config,
				sync_source_type: syncsource?.type
			})
		})

		if (!response.ok) {
			console.error(`Failed to process sync source: ${response.statusText}`);
			return null;
		}
		const result = await response.json();
		return result.uuid;
	}
	//#endregion

	//#region Convo forking
	function generateUuid() {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
			const r = Math.random() * 16 | 0;
			const v = c === 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	}


	// 1. Create a standalone conversation creation function
	async function createConversation(orgId, name, model = null, projectUuid = null, thinking = false) {
		const newUuid = generateUuid();
		const bodyJSON = {
			uuid: newUuid,
			name: name,
			include_conversation_preferences: true,
			project_uuid: projectUuid,
		}

		if (model) bodyJSON.model = model;

		if (thinking) {
			let isFree = true;
			const statSigResponse = await fetch(`/api/bootstrap/${orgId}/statsig`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json'
				},
			});
			if (statSigResponse.ok) {
				const statSigData = await statSigResponse.json();
				if (statSigData?.user?.custom?.orgType !== 'claude_free') {
					isFree = false;
				}
			}

			if (!isFree) {
				bodyJSON.paprika_mode = "extended";
			}

		}
		const createResponse = await fetch(`/api/organizations/${orgId}/chat_conversations`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(bodyJSON)
		});

		if (!createResponse.ok) {
			throw new Error('Failed to create conversation');
		}

		return newUuid;
	}

	async function createForkedConversation(orgId, context, model, styleData) {
		if (!context.chatName || context.chatName.trim() === '') context.chatName = "Untitled"
		const newName = `Fork of ${context.chatName}`;

		// Create a new chat conversation
		const newUuid = await createConversation(orgId, newName, model, context.projectUuid);

		// Create the chatlog
		if (context.messages) {
			const chatlog = context.messages.map((msg, index) => {
				const role = index % 2 === 0 ? 'User' : 'Assistant';
				return `${role}\n${msg}`;
			}).join('\n\n');

			context.attachments.push({
				"extracted_content": chatlog,
				"file_name": "chatlog.txt",
				"file_size": 0,
				"file_type": "text/plain"
			});
		}

		const message = context.messages
			? "This conversation is forked from the attached chatlog.txt\nYou are Assistant. Simply say 'Acknowledged' and wait for user input."
			: "This conversation is forked based on the summary in conversation_summary.txt\nYou are Assistant. Simply say 'Acknowledged' and wait for user input.";

		// Send initial message to set up conversation history
		const completionResponse = await fetch(`/api/organizations/${orgId}/chat_conversations/${newUuid}/completion`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				prompt: message,
				model: model,
				parent_message_uuid: '00000000-0000-4000-8000-000000000000',
				attachments: context.attachments,
				files: context.files,
				sync_sources: context.syncsources,
				personalized_styles: styleData
			})
		});

		if (!completionResponse.ok) {
			throw new Error('Failed to initialize conversation');
		}

		// Sleep for 2 seconds to allow the response to be fully created
		await new Promise(r => setTimeout(r, 2000));
		return newUuid;
	}

	async function generateSummary(orgId, context) {
		// Create a temporary conversation for summarization
		const summaryConvoName = `Temp_Summary_${Date.now()}`;
		const summaryConvoId = await createConversation(orgId, summaryConvoName, null, context.projectUuid, true);

		try {
			// Create the chatlog
			const chatlog = context.messages.map((msg, index) => {
				const role = index % 2 === 0 ? 'User' : 'Assistant';
				return `${role}\n${msg}`;
			}).join('\n\n');

			const summaryAttachments = [...context.attachments, {
				"extracted_content": chatlog,
				"file_name": "chatlog.txt",
				"file_size": 0,
				"file_type": "text/plain"
			}];

			// Ask the model to create a summary
			const summaryPrompt = "I've attached a chatlog from a previous conversation. Please create a complete, detailed summary of the conversation that covers all important points, questions, and responses. This summary will be used to continue the conversation in a new chat, so make sure it provides enough context to understand the full discussion. Be through, and think things through. Don't include any information already present in the other attachments, as those will be forwarded to the new chat as well.";

			const summaryResponse = await fetch(`/api/organizations/${orgId}/chat_conversations/${summaryConvoId}/completion`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					prompt: summaryPrompt,
					parent_message_uuid: '00000000-0000-4000-8000-000000000000',
					attachments: summaryAttachments,
					files: [],
					sync_sources: []
				})
			});

			if (!summaryResponse.ok) {
				console.error('Failed to generate summary');
				return null;
			}


			// Implement polling with timeout for assistant response
			const maxRetries = 6; // 6 retries * 5 seconds = 30 seconds max
			let assistantMessage = null;

			for (let attempt = 0; attempt < maxRetries; attempt++) {
				// Wait 5 seconds between attempts
				await new Promise(r => setTimeout(r, 5000));

				console.log(`Checking for summary response (attempt ${attempt + 1}/${maxRetries})...`);

				// Fetch conversation to check for assistant response
				const convoResponse = await fetch(`/api/organizations/${orgId}/chat_conversations/${summaryConvoId}?tree=False&rendering_mode=messages&render_all_tools=true`);
				const convoData = await convoResponse.json();

				// Find the assistant's response
				assistantMessage = convoData.chat_messages.find(msg => msg.sender === 'assistant');

				if (assistantMessage) {
					console.log('Found assistant summary response');
					break;
				}

				if (attempt === maxRetries - 1) {
					console.error('Could not find assistant summary response after maximum retries');
					throw new Error('Could not find assistant summary response after 30 seconds');
				}
			}

			// Extract the text of the summary
			let summaryText = '';
			for (const content of assistantMessage.content) {
				if (content.text) {
					summaryText += content.text;
				}
				if (content.content?.text) {
					summaryText += content.text;
				}
			}

			return summaryText;
		} finally {
			// Delete the temporary summarization conversation
			try {
				await fetch(`/api/organizations/${orgId}/chat_conversations/${summaryConvoId}`, {
					method: 'DELETE'
				});
			} catch (error) {
				console.error('Failed to delete temporary summary conversation:', error);
			}
		}
	}
	//#endregion

	//#region Fetch patching
	const originalFetch = window.fetch;
	window.fetch = async (...args) => {
		const [input, config] = args;

		// Get the URL string whether it's a string or Request object

		let url = undefined
		if (input instanceof URL) {
			url = input.href
		} else if (typeof input === 'string') {
			url = input
		} else if (input instanceof Request) {
			url = input.url
		}

		// In the fetch patching section
		if (url && url.includes('/retry_completion') && pendingForkModel) {
			console.log('Intercepted retry request:', config?.body);
			const bodyJSON = JSON.parse(config?.body);
			const messageID = bodyJSON?.parent_message_uuid;
			const urlParts = url.split('/');
			const orgId = urlParts[urlParts.indexOf('organizations') + 1];
			const conversationId = urlParts[urlParts.indexOf('chat_conversations') + 1];

			let styleData = bodyJSON?.personalized_styles;

			try {
				// Get conversation context
				console.log('Getting conversation context, includeAttachments:', includeAttachments);
				const context = await getConversationContext(orgId, conversationId, messageID);

				// Process files and sync sources if needed
				if (includeAttachments) {
					const downloadedFiles = await downloadFiles(context.files);

					// Parallel processing of files and syncs
					[context.files, context.syncsources] = await Promise.all([
						Promise.all(downloadedFiles.map(file => uploadFile(orgId, file))),
						Promise.all(context.syncsources.map(syncsource => processSyncSource(orgId, syncsource)))
					]);
				} else {
					context.files = [];
					context.syncsources = [];
				}

				let newConversationId;

				if (pendingUseSummary) {
					// Generate summary
					console.log("Generating summary for forking");
					const summary = await generateSummary(orgId, context, pendingForkModel);
					if (summary === null) {
						// Fall back to normal forking
						newConversationId = await createForkedConversation(orgId, context, pendingForkModel, styleData);
					} else {
						// Prepare context for summary-based fork
						const summaryContext = { ...context };
						summaryContext.messages = null;  // Don't generate chatlog
						summaryContext.attachments = [{
							"extracted_content": summary,
							"file_name": "conversation_summary.txt",
							"file_size": 0,
							"file_type": "text/plain"
						}];
						// Create forked conversation with summary
						newConversationId = await createForkedConversation(orgId, summaryContext, pendingForkModel, styleData);
					}
				} else {
					// Standard workflow with full chatlog
					newConversationId = await createForkedConversation(orgId, context, pendingForkModel, styleData);
				}

				// Restore original settings
				if (originalSettings) {
					await updateAccountSettings(originalSettings);
				}

				// Navigate to new conversation
				console.log('Forked conversation created:', newConversationId);
				window.location.href = `/chat/${newConversationId}`;

			} catch (error) {
				console.error('Failed to fork conversation:', error);
				// Restore original settings even if forking fails
				if (originalSettings) {
					await updateAccountSettings(originalSettings);
				}
			}

			originalSettings = null;
			pendingForkModel = null; // Clear the pending flag
			pendingUseSummary = false; // Clear the summary flag
			return new Response(JSON.stringify({ success: true }));
		}

		return originalFetch(...args);
	};
	//#endregion

	//Check for buttons every 3 seconds
	setInterval(addBranchButtons, 3000);
})();