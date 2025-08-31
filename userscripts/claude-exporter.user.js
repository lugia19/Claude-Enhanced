// ==UserScript==
// @name         Claude Chat Exporter
// @namespace    lugia19.com
// @match        https://claude.ai/*
// @version      2.1.4
// @author       lugia19
// @license      GPLv3
// @description  Allows exporting chat conversations from claude.ai.
// @grant        GM_getValue
// @grant        GM_setValue
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


	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function createExportButton() {
		const button = document.createElement('button');
		button.className = 'claude-icon-btn';

		button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 16 16">
			<path d="M8 12V2m0 10 5-5m-5 5L3 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
			<path opacity="0.4" d="M2 15h12v-3H2v3Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
		</svg>`;

		// Apply styling
		applyClaudeStyling(button);
		createClaudeTooltip(button, 'Export chatlog');

		button.onclick = async () => {
			// Show format selection modal
			let format, extension, exportTree;
			try {
				const modalResult = await showFormatModal();
				if (!modalResult) return; // User cancelled
				format = modalResult.format;
				extension = modalResult.extension;
				exportTree = modalResult.exportTree;
			} catch (error) {
				console.error('Error during export:', error);
				return;
			}

			const conversationData = await getMessages(exportTree);
			const conversationId = getConversationId();
			const filename = `Claude_export_${conversationData.title}_${conversationId}.${extension}`;
			const content = await formatExport(conversationData, format, conversationId);
			downloadFile(filename, content);
		};

		return button;
	}

	async function showFormatModal() {
		const modal = document.createElement('div');
		modal.className = 'claude-modal-backdrop';

		// Get last used format, defaulting to txt_txt if none saved
		const lastFormat = await getStorageValue('lastExportFormat', 'txt_txt');

		const modalContent = document.createElement('div');
		modalContent.className = 'claude-modal';
		modalContent.style.maxWidth = '24rem';
		modalContent.innerHTML = `
			<h3 class="claude-modal-heading">Export Format</h3>
			<select class="claude-select mb-4">
				<option value="txt_txt">Text (.txt)</option>
				<option value="jsonl_jsonl">JSONL (.jsonl)</option>
				<option value="librechat_json">Librechat (.json)</option>
				<option value="raw_json">Raw JSON (.json)</option>
			</select>
			<div id="treeOption" class="mb-4 hidden flex items-center gap-2">
			</div>
			<div class="flex justify-end gap-2">
				<button class="claude-btn-secondary" id="cancelExport">Cancel</button>
				<button class="claude-btn-primary" id="confirmExport">Export</button>
			</div>
		`;

		modal.appendChild(modalContent);
		document.body.appendChild(modal);

		// Apply styling
		applyClaudeStyling(modal);
		// Create and insert the toggle
		const treeOption = modal.querySelector('#treeOption');
		const { container: toggleContainer, input: toggleInput } = createClaudeToggle('Export entire tree', false);
		treeOption.appendChild(toggleContainer);

		return new Promise((resolve) => {
			const select = modal.querySelector('select');
			const treeOption = modal.querySelector('#treeOption');
			const checkbox = toggleInput;

			// Set the last used format
			select.value = lastFormat;

			// Show/hide tree option based on initial value
			const initialFormat = lastFormat.split('_')[0];
			treeOption.classList.toggle('hidden', !['librechat', 'raw'].includes(initialFormat));

			select.onchange = () => {
				const format = select.value.split('_')[0];
				treeOption.classList.toggle('hidden', !['librechat', 'raw'].includes(format));
			};

			modal.querySelector('#cancelExport').onclick = () => {
				modal.remove();
				resolve(null);
			};

			modal.querySelector('#confirmExport').onclick = async () => {
				// Save the selected format
				await setStorageValue('lastExportFormat', select.value);

				const parts = select.value.split("_");
				modal.remove();
				resolve({
					format: parts[0],
					extension: parts[1],
					exportTree: checkbox.checked
				});
			};

			modal.onclick = (e) => {
				if (e.target === modal) {
					modal.remove();
					resolve(null);
				}
			};
		});
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

	async function getMessages(fullTree = false) {
		const conversationId = getConversationId();
		if (!conversationId) {
			throw new Error('Not in a conversation');
		}

		const orgId = getOrgId();

		const response = await fetch(`/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=${fullTree}&rendering_mode=messages&render_all_tools=true`);
		const conversationData = await response.json();

		const messages = [];

		for (const message of conversationData.chat_messages) {
			let messageContent = [];

			for (const content of message.content) {
				messageContent = messageContent.concat(await getTextFromContent(content));
			}

			messages.push({
				role: message.sender === 'human' ? 'user' : 'assistant',
				content: messageContent.join('\n')
			});
		}

		return {
			title: conversationData.name,
			updated_at: conversationData.updated_at,
			messages: messages,
			raw: conversationData
		};
	}

	async function getTextFromContent(content) {
		let textPieces = [];

		if (content.text) {
			textPieces.push(content.text);
		}
		if (content.input) {
			textPieces.push(JSON.stringify(content.input));
		}
		if (content.content) {
			// Handle nested content array
			if (Array.isArray(content.content)) {
				for (const nestedContent of content.content) {
					textPieces = textPieces.concat(await getTextFromContent(nestedContent));
				}
			}
			// Handle single nested content object
			else if (typeof content.content === 'object') {
				textPieces = textPieces.concat(await getTextFromContent(content.content));
			}
		}
		return textPieces;
	}

	async function formatExport(conversationData, format, conversationId) {
		const { title, updated_at, messages } = conversationData;

		switch (format) {
			case 'txt':
				return `Title: ${title}\nDate: ${updated_at}\n\n` +
					messages.map(msg => {
						const role = msg.role === 'user' ? 'User' : 'Assistant';
						return `[${role}]\n${msg.content}\n`;
					}).join('\n');
			case 'jsonl':
				return messages.map(JSON.stringify).join('\n');
			case 'librechat':
				// First, process all messages' content
				const processedMessages = await Promise.all(conversationData.raw.chat_messages.map(async (msg) => {
					const contentText = [];
					for (const content of msg.content) {
						contentText.push(...await getTextFromContent(content));
					}

					return {
						messageId: msg.uuid,
						parentMessageId: msg.parent_message_uuid === "00000000-0000-4000-8000-000000000000"
							? null
							: msg.parent_message_uuid,
						text: contentText.join('\n'),
						sender: msg.sender === "assistant" ? "Claude" : "User",
						isCreatedByUser: msg.sender === "human",
						createdAt: msg.created_at
					};
				}));

				// Then create and return the final object
				return JSON.stringify({
					title: conversationData.raw.name,
					endpoint: "anthropic",
					conversationId: conversationId,
					options: {
						model: conversationData.raw.model ?? "claude-3-5-sonnet-latest"
					},
					messages: processedMessages
				}, null, 2);
			case 'raw':
				return JSON.stringify(conversationData.raw, null, 2);
			default:
				throw new Error(`Unsupported format: ${format}`);
		}
	}

	function downloadFile(filename, content) {
		const blob = new Blob([content], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}

	function initialize() {
		// Try to add the button immediately
		tryAddTopRightButton();

		// Also check every 5 seconds
		setInterval(tryAddTopRightButton, 5000);
	}

	function tryAddTopRightButton() {
		const BUTTON_PRIORITY = [
			'tts-settings-button',
			'style-selector-button',
			'stt-settings-button',
			'export-button'
		];

		const buttonClass = 'export-button'; // Or whichever button this script handles

		const container = document.querySelector(".right-3.flex.gap-2");
		if (!container || container.querySelectorAll("button").length == 0) {
			return; // Container not found or no buttons present
		}

		// Add button if it doesn't exist
		if (!container.querySelector('.' + buttonClass)) {
			const button = createExportButton();
			button.classList.add(buttonClass);
			container.appendChild(button);
		}

		// Reorder all buttons according to priority
		const priorityButtons = [];
		for (const className of BUTTON_PRIORITY) {
			const button = container.querySelector('.' + className);
			if (button) {
				priorityButtons.push(button);
			}
		}

		// Get all non-priority buttons (native Claude buttons)
		const allButtons = Array.from(container.querySelectorAll('button'));
		const nonPriorityButtons = allButtons.filter(btn =>
			!BUTTON_PRIORITY.some(className => btn.classList.contains(className))
		);

		// Rebuild in order: priority buttons first, then native buttons
		[...priorityButtons, ...nonPriorityButtons].forEach(button => {
			container.appendChild(button); // appendChild moves existing elements
		});
	}

	initialize();
})();