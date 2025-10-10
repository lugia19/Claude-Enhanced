// claude-exporter.js
// Chat export and import functionality for Claude.ai
// Depends on: claude-styles.js, claude-phantom-messages.js, claude-api.js

(function () {
	'use strict';

	async function getMessages(fullTree = false) {
		const conversationId = getConversationId();
		if (!conversationId) {
			throw new Error('Not in a conversation');
		}

		const orgId = getOrgId();
		const conversation = new ClaudeConversation(orgId, conversationId);
		const conversationData = await conversation.getData(fullTree);

		const messages = [];

		for (const message of conversationData.chat_messages) {
			const messageContent = ClaudeConversation.extractMessageText(message);
			messages.push({
				role: message.sender === 'human' ? 'user' : 'assistant',
				content: messageContent
			});
		}

		return {
			title: conversationData.name,
			updated_at: conversationData.updated_at,
			messages: messages,
			raw: conversationData
		};
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
				// Process all messages' content
				const processedMessages = conversationData.raw.chat_messages.map((msg) => {
					const contentText = ClaudeConversation.extractMessageText(msg);

					return {
						messageId: msg.uuid,
						parentMessageId: msg.parent_message_uuid === "00000000-0000-4000-8000-000000000000"
							? null
							: msg.parent_message_uuid,
						text: contentText,
						sender: msg.sender === "assistant" ? "Claude" : "User",
						isCreatedByUser: msg.sender === "human",
						createdAt: msg.created_at
					};
				});

				// Create and return the final object
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

		// Parse header
		const titleMatch = text.match(/^Title: (.+)/m);
		const title = titleMatch ? titleMatch[1].trim() : 'Imported Conversation';

		// Remove header (everything before first message marker)
		const contentStart = text.search(/\n\[(User|Assistant)\]\n/);
		if (contentStart === -1) {
			throw new Error('No messages found in file');
		}
		const content = text.slice(contentStart);

		// Basic counts
		const userCount = (content.match(/\[User\]/g) || []).length;
		const assistantCount = (content.match(/\[Assistant\]/g) || []).length;

		if (userCount === 0 && assistantCount === 0) {
			throw new Error('No messages found in file');
		}

		if (Math.abs(userCount - assistantCount) > 0) {
			throw new Error(`Message count mismatch: ${userCount} User, ${assistantCount} Assistant messages`);
		}

		if (!content.trim().match(/^\n?\[User\]/)) {
			throw new Error('Conversation must start with a User message');
		}

		// Parse messages
		const messages = [];
		const parts = content.split(/\n\[(User|Assistant)\]\n/);

		let lastRole = null;
		let currentText = '';

		for (let i = 1; i < parts.length; i += 2) {
			const role = parts[i];
			const content = parts[i + 1]?.trim();

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

		return { title, messages, warnings };
	}

	function convertToPhantomMessages(messages) {
		const phantomMessages = [];
		let parentId = "00000000-0000-4000-8000-000000000000";

		for (const message of messages) {
			const messageId = crypto.randomUUID();
			const timestamp = new Date().toISOString();

			phantomMessages.push({
				uuid: messageId,
				parent_message_uuid: parentId,
				sender: message.role,
				content: [{
					type: "text",
					text: message.text,
					start_timestamp: timestamp,
					stop_timestamp: timestamp,
					citations: []
				}],
				created_at: timestamp,
				files_v2: [],
				files: [],
				attachments: [],
				sync_sources: []
			});
			parentId = messageId;
		}

		return phantomMessages;
	}

	async function performImport(fileContent, title, messages, model) {
		const orgId = getOrgId();

		// Create new conversation with parsed title
		const conversation = new ClaudeConversation(orgId);
		const newConvoId = await conversation.create(title, model);

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
		console.log("Imported messages:", messages);
		const phantomMessages = convertToPhantomMessages(messages);
		console.log("Converted to phantom messages:", phantomMessages);
		window.postMessage({
			type: 'STORE_PHANTOM_MESSAGES',
			conversationId: newConvoId,
			phantomMessages: phantomMessages
		}, '*');

		// Navigate to new conversation
		window.location.href = `/chat/${newConvoId}`;
	}

	function showWarningsModal(warnings) {
		const warningList = document.createElement('ul');
		warningList.className = 'list-disc pl-5 space-y-1';
		warnings.forEach(warning => {
			const li = document.createElement('li');
			li.textContent = warning;
			warningList.appendChild(li);
		});

		return new Promise((resolve) => {
			const modal = new ClaudeModal('Import Warnings', warningList);
			modal.addCancel('Cancel', () => resolve(false));
			modal.addConfirm('Import Anyway', () => resolve(true));
			modal.show();
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
		let title, messages, warnings;

		try {
			const result = parseAndValidateText(fileContent);
			title = result.title;
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
			// Create conversation and import with parsed title
			await performImport(fileContent, title, messages, modelSelect.value);
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

	async function handleReplacePhantom(replaceButton) {
		const conversationId = getConversationId();
		if (!conversationId) {
			replaceButton.disabled = true;
			replaceButton.textContent = 'Not in a conversation';
			setTimeout(() => {
				replaceButton.disabled = false;
				replaceButton.textContent = 'Replace from File';
			}, 2000);
			return;
		}

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
			replaceButton.disabled = true;
			replaceButton.textContent = 'Invalid format';
			setTimeout(() => {
				replaceButton.disabled = false;
				replaceButton.textContent = 'Replace from File';
			}, 2000);
			return;
		}

		// Show warnings modal if needed
		if (warnings.length > 0) {
			const proceed = await showWarningsModal(warnings);
			if (!proceed) return;
		}

		// Update button state
		replaceButton.disabled = true;
		replaceButton.textContent = 'Replacing...';

		try {
			// Convert and store phantom messages
			const phantomMessages = convertToPhantomMessages(messages);
			window.postMessage({
				type: 'STORE_PHANTOM_MESSAGES',
				conversationId: conversationId,
				phantomMessages: phantomMessages
			}, '*');

			// Reload to show changes
			window.location.reload();
		} catch (error) {
			console.error('Replace failed:', error);
			replaceButton.textContent = 'Replace failed';
			setTimeout(() => {
				replaceButton.disabled = false;
				replaceButton.textContent = 'Replace from File';
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
		formatLabel.textContent = 'Export Format';
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
		const modelList = [
			{ value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
			{ value: 'claude-sonnet-4-20250514', label: 'Sonnet 4' },
			{ value: 'claude-opus-4-1-20250805', label: 'Opus 4.1' },
			{ value: 'claude-opus-4-20250514', label: 'Opus 4' },
			{ value: 'claude-3-7-sonnet-20250219', label: 'Sonnet 3.7' },
			{ value: 'claude-3-opus-20240229', label: 'Opus 3' },
			{ value: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5' }
		]
		const modelSelect = createClaudeSelect(modelList, modelList[0].value);
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
		const note2 = document.createElement('p');
		note2.className = CLAUDE_CLASSES.TEXT_SM + ' text-text-400';
		note2.textContent = 'Imports txt format only.';

		content.appendChild(note);
		content.appendChild(note2);

		// Another divider
		const divider2 = document.createElement('hr');
		divider2.className = 'my-4 border-border-300';
		content.appendChild(divider2);

		// Replace phantom messages section
		const replaceLabel = document.createElement('label');
		replaceLabel.className = CLAUDE_CLASSES.LABEL;
		replaceLabel.textContent = 'Replace Phantom Messages';
		content.appendChild(replaceLabel);

		const replaceNote = document.createElement('p');
		replaceNote.className = CLAUDE_CLASSES.TEXT_SM + ' text-text-400';
		replaceNote.textContent = `Replaces the "fake" message history for this conversation.`;
		content.appendChild(replaceNote);

		const replaceButton = createClaudeButton('Replace from File', 'secondary');
		replaceButton.className += ' mb-2';
		content.appendChild(replaceButton);
		replaceButton.onclick = () => handleReplacePhantom(replaceButton);

		// Warning note
		const warningNote = document.createElement('p');
		warningNote.className = CLAUDE_CLASSES.TEXT_SM;
		warningNote.style.color = '#de2929';
		warningNote.innerHTML = '⚠️ <strong>Visual change only:</strong> This replaces what you see in the chat history. The AI\'s context (what it can actually read) remains unchanged.';
		warningNote.className += ' mb-3';
		content.appendChild(warningNote);

		// Create modal
		const modal = new ClaudeModal('Export & Import', content);

		// Override max width
		modal.modal.style.maxWidth = '28rem';

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

				modal.hide();
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

		modal.show();
	}

	function createExportButton() {
		const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 16 16">
        <path d="M8 12V2m0 10 5-5m-5 5L3 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path opacity="0.4" d="M2 15h12v-3H2v3Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`;

		const button = createClaudeButton(svgContent, 'icon');

		button.onclick = showExportImportModal;

		return button;
	}

	function initialize() {
		tryAddTopRightButton("export-button", createExportButton, "Export/Import chat");
		setInterval(() => tryAddTopRightButton('export-button', createExportButton, "Export/Import chat"), 1000);
	}

	// Wait for dependencies to be available
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		initialize();
	}
})();