// claude-exporter.js
// Chat export and import functionality for Claude.ai
// Depends on: claude-styles.js, claude-phantom-messages.js, claude-api.js

(function () {
	'use strict';

	// Helper functions
	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
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

	//#region Import functionality

	function parseAndValidateText(text) {
		const warnings = [];

		// Basic counts
		const userCount = (text.match(/\[User\]/g) || []).length;
		const assistantCount = (text.match(/\[Assistant\]/g) || []).length;

		if (userCount === 0 && assistantCount === 0) {
			throw new Error('No messages found in file');
		}

		if (Math.abs(userCount - assistantCount) > 1) {
			throw new Error(`Message count mismatch: ${userCount} User, ${assistantCount} Assistant messages`);
		}

		if (!text.trim().match(/^\[User\]/)) {
			throw new Error('Conversation must start with a User message');
		}

		// Parse messages
		const messages = [];
		const parts = text.split(/\n\[(User|Assistant)\]\n/);

		let lastRole = null;
		let currentText = '';

		for (let i = 1; i < parts.length; i += 2) {
			const role = parts[i];
			const content = parts[i + 1]?.trim();

			if (!content) continue; // Skip empty

			if (role === lastRole) {
				warnings.push(`Sequential ${role} messages were merged`);
				currentText += '\n\n' + content;
			} else {
				if (currentText) {
					messages.push({
						role: lastRole === 'User' ? 'human' : 'assistant',
						text: currentText
					});
				}
				currentText = content;
				lastRole = role;
			}
		}

		if (currentText) {
			messages.push({
				role: lastRole === 'User' ? 'human' : 'assistant',
				text: currentText
			});
		}

		return { messages, warnings };
	}

	function convertToPhantomMessages(messages) {
		const phantomMessages = [];
		let parentId = "00000000-0000-4000-8000-000000000000";

		for (const message of messages) {
			const messageId = crypto.randomUUID();
			phantomMessages.push({
				uuid: messageId,
				parent_message_uuid: parentId,
				sender: message.role,
				content: [{ text: message.text }],
				created_at: new Date().toISOString(),
				files_v2: [],
				files: [],
				attachments: [],
				sync_sources: []
			});
			parentId = messageId;
		}

		return phantomMessages;
	}

	async function performImport(fileContent, messages, model) {
		const orgId = getOrgId();

		// Create new conversation
		const conversation = new ClaudeConversation(orgId);
		const newConvoId = await conversation.create("Imported Conversation", model);

		// Build chatlog attachment
		const chatlogAttachment = {
			extracted_content: fileContent,
			file_name: "chatlog.txt",
			file_size: fileContent.length,
			file_type: "text/plain"
		};

		// Send initial message
		await conversation.sendMessageAndWaitForResponse(
			"This conversation is imported from the attached chatlog.txt\nYou are Assistant. Simply say 'Acknowledged' and wait for user input.",
			{
				model: model,
				attachments: [chatlogAttachment],
				files: [],
				syncSources: [],
				waitMinutes: 3
			}
		);

		// Convert and store phantom messages
		const phantomMessages = convertToPhantomMessages(messages);
		storePhantomMessages(newConvoId, phantomMessages);

		// Navigate to new conversation
		window.location.href = `/chat/${newConvoId}`;
	}

	function showWarningsModal(warnings) {
		const content = document.createElement('div');

		const warningList = document.createElement('ul');
		warningList.className = 'list-disc pl-5 space-y-1';
		warnings.forEach(warning => {
			const li = document.createElement('li');
			li.textContent = warning;
			warningList.appendChild(li);
		});
		content.appendChild(warningList);

		return new Promise((resolve) => {
			const modal = createClaudeModal({
				title: 'Import Warnings',
				content: content,
				confirmText: 'Import Anyway',
				cancelText: 'Cancel',
				onConfirm: () => resolve(true),
				onCancel: () => resolve(false)
			});

			document.body.appendChild(modal);
		});
	}

	async function handleImport(modelSelect, importButton) {
		// Trigger file picker
		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = '.txt';

		const file = await new Promise(resolve => {
			fileInput.onchange = e => resolve(e.target.files[0]);
			fileInput.click();
		});

		if (!file) return;

		// Parse and validate
		const fileContent = await file.text();
		let messages, warnings;

		try {
			const result = parseAndValidateText(fileContent);
			messages = result.messages;
			warnings = result.warnings;
		} catch (error) {
			// Show error on button
			importButton.disabled = true;
			importButton.textContent = 'Invalid format';
			setTimeout(() => {
				importButton.disabled = false;
				importButton.textContent = 'Import';
			}, 2000);
			return;
		}

		// Show warnings modal if needed
		if (warnings.length > 0) {
			const proceed = await showWarningsModal(warnings);
			if (!proceed) return;
		}

		// Update button state
		importButton.disabled = true;
		importButton.textContent = 'Importing...';

		try {
			// Create conversation and import
			await performImport(fileContent, messages, modelSelect.value);
			// Navigation happens in performImport, button state doesn't matter
		} catch (error) {
			console.error('Import failed:', error);
			importButton.textContent = 'Import failed';
			setTimeout(() => {
				importButton.disabled = false;
				importButton.textContent = 'Import';
			}, 2000);
		}
	}

	//#endregion

	async function showExportImportModal() {
		// Get last used format from localStorage
		const lastFormat = localStorage.getItem('lastExportFormat') || 'txt_txt';

		// Build the modal content
		const content = document.createElement('div');

		// Format label (no "Export" header)
		const formatLabel = document.createElement('label');
		formatLabel.className = CLAUDE_CLASSES.LABEL;
		formatLabel.textContent = 'Format';
		content.appendChild(formatLabel);

		const exportContainer = document.createElement('div');
		exportContainer.className = 'mb-4 flex gap-2';

		// Format select
		const formatSelect = createClaudeSelect([
			{ value: 'txt_txt', label: 'Text (.txt)' },
			{ value: 'jsonl_jsonl', label: 'JSONL (.jsonl)' },
			{ value: 'librechat_json', label: 'Librechat (.json)' },
			{ value: 'raw_json', label: 'Raw JSON (.json)' }
		], lastFormat);
		formatSelect.style.flex = '1';
		exportContainer.appendChild(formatSelect);

		// Export button
		const exportButton = createClaudeButton('Export', 'primary');
		exportButton.style.minWidth = '80px';
		exportContainer.appendChild(exportButton);

		content.appendChild(exportContainer);

		// Tree option container
		const treeOption = document.createElement('div');
		treeOption.id = 'treeOption';
		treeOption.className = 'mb-4 hidden';

		const { container: toggleContainer, input: toggleInput } = createClaudeToggle('Export entire tree', false);
		treeOption.appendChild(toggleContainer);
		content.appendChild(treeOption);

		// Show/hide tree option based on initial value
		const initialFormat = lastFormat.split('_')[0];
		treeOption.classList.toggle('hidden', !['librechat', 'raw'].includes(initialFormat));

		// Update tree option visibility on select change
		formatSelect.onchange = () => {
			const format = formatSelect.value.split('_')[0];
			treeOption.classList.toggle('hidden', !['librechat', 'raw'].includes(format));
		};

		// Divider
		const divider = document.createElement('hr');
		divider.className = 'my-4 border-border-300';
		content.appendChild(divider);

		// Model label (no "Import" header)
		const modelLabel = document.createElement('label');
		modelLabel.className = CLAUDE_CLASSES.LABEL;
		modelLabel.textContent = 'Imported Conversation Model';
		content.appendChild(modelLabel);

		const importContainer = document.createElement('div');
		importContainer.className = 'mb-2 flex gap-2';

		// Model select
		const modelSelect = createClaudeSelect([
			{ value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
			{ value: 'claude-sonnet-4-20250514', label: 'Sonnet 4' },
			{ value: 'claude-opus-4-1-20250805', label: 'Opus 4.1' },
			{ value: 'claude-opus-4-20250514', label: 'Opus 4' },
			{ value: 'claude-3-7-sonnet-20250219', label: 'Sonnet 3.7' },
			{ value: 'claude-3-opus-20240229', label: 'Opus 3' },
			{ value: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5' }
		], 'claude-sonnet-4-20250514');
		modelSelect.style.flex = '1';
		importContainer.appendChild(modelSelect);

		// Import button
		const importButton = createClaudeButton('Import', 'primary');
		importButton.style.minWidth = '80px';
		importContainer.appendChild(importButton);

		content.appendChild(importContainer);

		// Import note
		const note = document.createElement('p');
		note.className = CLAUDE_CLASSES.TEXT_SM + ' text-text-400';
		note.textContent = 'Note: File attachments and images cannot be imported.';
		content.appendChild(note);

		// Create modal
		const modal = createClaudeModal({
			title: 'Export & Import',
			content: content,
			showButtons: false
		});

		// Override max width
		const modalContainer = modal.querySelector('.' + CLAUDE_CLASSES.MODAL_CONTAINER.split(' ')[0]);
		if (modalContainer) {
			modalContainer.style.maxWidth = '28rem';
		}

		// Add event listeners
		exportButton.onclick = async () => {
			exportButton.disabled = true;
			exportButton.textContent = 'Exporting...';

			try {
				// Save the selected format
				localStorage.setItem('lastExportFormat', formatSelect.value);

				const parts = formatSelect.value.split("_");
				const format = parts[0];
				const extension = parts[1];
				const exportTree = toggleInput.checked;

				const conversationData = await getMessages(exportTree);
				const conversationId = getConversationId();
				const filename = `Claude_export_${conversationData.title}_${conversationId}.${extension}`;
				const content = await formatExport(conversationData, format, conversationId);
				downloadFile(filename, content);

				modal.remove();
			} catch (error) {
				console.error('Export failed:', error);
				exportButton.textContent = 'Export failed';
				setTimeout(() => {
					exportButton.disabled = false;
					exportButton.textContent = 'Export';
				}, 2000);
			}
		};

		importButton.onclick = () => handleImport(modelSelect, importButton);

		// Close on background click
		modal.onclick = (e) => {
			if (e.target === modal) {
				modal.remove();
			}
		};

		document.body.appendChild(modal);
	}

	function createExportButton() {
		const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 16 16">
        <path d="M8 12V2m0 10 5-5m-5 5L3 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path opacity="0.4" d="M2 15h12v-3H2v3Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`;

		const button = createClaudeButton(svgContent, 'icon');

		// Add tooltip
		createClaudeTooltip(button, 'Export/Import chat');

		button.onclick = showExportImportModal;

		return button;
	}

	function initialize() {
		tryAddTopRightButton("export-button", createExportButton);
		setInterval(() => tryAddTopRightButton('export-button', createExportButton), 1000);
	}

	// Wait for dependencies to be available
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		initialize();
	}
})();