// ==UserScript==
// @name         Claude Chat Exporter
// @namespace    lugia19.com
// @match        https://claude.ai/*
// @version      2.1.3
// @author       lugia19
// @license      GPLv3
// @description  Allows exporting chat conversations from claude.ai.
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
	'use strict';

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function createExportButton() {
		const button = document.createElement('button');
		button.className = `inline-flex items-center justify-center relative shrink-0 ring-offset-2 ring-offset-bg-300 
			ring-accent-main-100 focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none 
			disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none text-text-200 border-transparent 
			transition-colors font-styrene active:bg-bg-400 hover:bg-bg-500/40 hover:text-text-100 h-9 w-9 
			rounded-md active:scale-95 shrink-0`;

		button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 16 16">
			<path d="M8 12V2m0 10 5-5m-5 5L3 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
			<path opacity="0.4" d="M2 15h12v-3H2v3Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
		</svg>`;

		// Add tooltip wrapper div
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

		// Add tooltip content
		tooltipWrapper.innerHTML = `
			<div data-side="bottom" data-align="center" data-state="delayed-open" 
				class="px-2 py-1 text-xs font-medium font-sans leading-tight rounded-md shadow-md text-white bg-black/80 backdrop-blur break-words z-tooltip max-w-[13rem]">
				Export chatlog
				<span role="tooltip" style="position: absolute; border: 0px; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; overflow-wrap: normal;">
					Export chatlog
				</span>
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
			// Show format selection modal
			const { format, extension, exportTree } = await showFormatModal();
			if (!format) return;

			const conversationData = await getMessages(exportTree);
			const conversationId = getConversationId();
			const filename = `Claude_export_${conversationData.title}_${conversationId}.${extension}`;
			const content = await formatExport(conversationData, format, conversationId);
			downloadFile(filename, content);
		};

		// Add tooltip to document
		document.body.appendChild(tooltipWrapper);

		return button;
	}

	async function showFormatModal() {
		const modal = document.createElement('div');
		modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';

		// Get last used format, defaulting to txt_txt if none saved
		const lastFormat = GM_getValue('lastExportFormat', 'txt_txt');

		modal.innerHTML = `
			<div class="bg-bg-100 rounded-lg p-6 shadow-xl max-w-sm w-full mx-4 border border-border-300">
				<h3 class="text-lg font-semibold mb-4 text-text-100">Export Format</h3>
				<select class="w-full p-2 rounded mb-4 bg-bg-200 text-text-100 border border-border-300">
					<option value="txt_txt">Text (.txt)</option>
					<option value="jsonl_jsonl">JSONL (.jsonl)</option>
					<option value="librechat_json">Librechat (.json)</option>
					<option value="raw_json">Raw JSON (.json)</option>
				</select>
				<div id="treeOption" class="mb-4 hidden">
					<label class="flex items-center text-text-100">
						<input type="checkbox" class="mr-2">
						Export entire tree
					</label>
				</div>
				<div class="flex justify-end gap-2">
					<button class="px-4 py-2 text-text-200 hover:bg-bg-500/40 rounded" id="cancelExport">Cancel</button>
					<button class="px-4 py-2 bg-accent-main-100 text-oncolor-100 rounded" id="confirmExport">Export</button>
				</div>
			</div>
		`;

		document.body.appendChild(modal);

		return new Promise((resolve) => {
			const select = modal.querySelector('select');
			const treeOption = modal.querySelector('#treeOption');
			const checkbox = treeOption.querySelector('input[type="checkbox"]');

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

			modal.querySelector('#confirmExport').onclick = () => {
				// Save the selected format
				GM_setValue('lastExportFormat', select.value);

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
		tryAddButton();

		// Also check every 5 seconds
		setInterval(tryAddButton, 5000);
	}

	function tryAddButton() {
		const container = document.querySelector(".right-3.flex.gap-2");
		if (!container || container.querySelector('.export-button') || container.querySelectorAll("button").length == 0) {
			return; // Either container not found or button already exists
		}
		const exportButton = createExportButton();
		exportButton.classList.add('export-button'); // Add class to check for existence
		container.insertBefore(exportButton, container.firstChild);
	}

	initialize();
})();