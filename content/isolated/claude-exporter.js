// claude-exporter.js
// Chat export functionality for Claude.ai
// Depends on: claude-styles.js

(function () {
	'use strict';

	// Helper functions
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

	async function showFormatModal() {
		const modal = document.createElement('div');
		modal.className = 'claude-modal-backdrop';

		// Get last used format from Chrome storage
		const result = await chrome.storage.local.get(['lastExportFormat']);
		const lastFormat = result.lastExportFormat || 'txt_txt';

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

		// Apply styling using global ClaudeStyles
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
				// Save the selected format to Chrome storage
				await chrome.storage.local.set({ lastExportFormat: select.value });

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

	function createExportButton() {
		const button = document.createElement('button');
		button.className = 'claude-icon-btn';

		button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 16 16">
			<path d="M8 12V2m0 10 5-5m-5 5L3 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
			<path opacity="0.4" d="M2 15h12v-3H2v3Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
		</svg>`;

		// Apply styling and tooltip using global ClaudeStyles
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

	function initialize() {
		tryAddTopRightButton("export-button", createExportButton);
		setInterval(() => tryAddTopRightButton('export-button', createExportButton), 1000);
	}

	// Wait for ClaudeStyles to be available
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		// DOM is already ready
		initialize();
	}
})();