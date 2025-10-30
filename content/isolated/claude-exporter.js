// claude-exporter.js
// Chat export and import functionality for Claude.ai
// Depends on: claude-styles.js, claude-phantom-messages.js, claude-api.js

(function () {
	'use strict';

	// Global role configuration
	const ROLES = {
		USER: {
			apiName: "human",
			exportDelimiter: "User",
			librechatName: "User",
			jsonlName: "user"
		},
		ASSISTANT: {
			apiName: "assistant",
			exportDelimiter: "Assistant",
			librechatName: "Claude",
			jsonlName: "assistant"
		}
	};

	//#region Export format handlers
	function formatTxtExport(conversationData, conversationId) {
		let output = `Title: ${conversationData.name}\nDate: ${conversationData.updated_at}\n\n`;

		for (const message of conversationData.chat_messages) {
			// Message boundary
			output += `[${message.sender === ROLES.USER.apiName ? ROLES.USER.exportDelimiter : ROLES.ASSISTANT.exportDelimiter}]\n`;

			// Content blocks
			for (const content of message.content) {
				if (content.type === 'text') {
					output += `[content-text]\n${content.text}\n\n`;
				} else {
					// All other content types as JSON
					output += `[content-${content.type}]\n${JSON.stringify(content)}\n\n`;
				}
			}

			// Files/attachments (user messages only)
			if (message.sender === ROLES.USER.apiName) {
				if (message.files_v2 && message.files_v2.length > 0) {
					output += `[files_v2]\n${JSON.stringify(message.files_v2)}\n\n`;
				}

				if (message.attachments && message.attachments.length > 0) {
					output += `[attachments]\n${JSON.stringify(message.attachments)}\n\n`;
				}
			}
		}

		return output;
	}

	function formatJsonlExport(conversationData, conversationId) {
		// Simple JSONL - just role and text
		return conversationData.chat_messages.map(msg => {
			return JSON.stringify({
				role: msg.sender === ROLES.USER.apiName ? ROLES.USER.jsonlName : ROLES.ASSISTANT.jsonlName,
				content: ClaudeConversation.extractMessageText(msg)
			});
		}).join('\n');
	}

	function formatLibrechatExport(conversationData, conversationId) {
		const processedMessages = conversationData.chat_messages.map((msg) => {
			const contentText = ClaudeConversation.extractMessageText(msg);

			return {
				messageId: msg.uuid,
				parentMessageId: msg.parent_message_uuid === "00000000-0000-4000-8000-000000000000"
					? null
					: msg.parent_message_uuid,
				text: contentText,
				sender: msg.sender === ROLES.ASSISTANT.apiName ? ROLES.ASSISTANT.librechatName : ROLES.USER.librechatName,
				isCreatedByUser: msg.sender === ROLES.USER.apiName,
				createdAt: msg.created_at
			};
		});

		return JSON.stringify({
			title: conversationData.name,
			endpoint: "anthropic",
			conversationId: conversationId,
			options: {
				model: conversationData.model ?? "claude-3-5-sonnet-latest"
			},
			messages: processedMessages
		}, null, 2);
	}

	function formatRawExport(conversationData, conversationId) {
		return JSON.stringify(conversationData, null, 2);
	}
	//#endregion

	async function formatExport(conversationData, format, conversationId) {
		switch (format) {
			case 'txt':
				return formatTxtExport(conversationData, conversationId);
			case 'jsonl':
				return formatJsonlExport(conversationData, conversationId);
			case 'librechat':
				return formatLibrechatExport(conversationData, conversationId);
			case 'raw':
				return formatRawExport(conversationData, conversationId);
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

		// Remove header
		const contentStart = text.search(/\n\[(.+)\]\n/);
		if (contentStart === -1) {
			throw new Error('No messages found in file');
		}

		const lines = text.slice(contentStart).split('\n');

		const messages = [];
		let currentMessage = null;
		let currentTag = null;
		let textBuffer = '';

		function flushTextBuffer() {
			if (!textBuffer || !currentTag) return;

			if (currentTag.startsWith('content-')) {
				// Content block
				const contentType = currentTag.substring(8); // Remove "content-" prefix

				if (contentType === 'text') {
					currentMessage.content.push({
						type: 'text',
						text: textBuffer.trim()
					});
				} else {
					// Parse as JSON
					try {
						const jsonData = JSON.parse(textBuffer.trim());
						if (!jsonData.type) jsonData.type = contentType;
						currentMessage.content.push(jsonData);
					} catch (error) {
						warnings.push(`Failed to parse [content-${contentType}] block: ${error.message}`);
					}
				}
			} else {
				// Message property
				try {
					const jsonData = JSON.parse(textBuffer.trim());
					if (currentTag !== 'files_v2') currentMessage[currentTag] = jsonData;

					// Duplicate files_v2 to files (array of UUIDs)
					if (currentTag === 'files_v2') {
						//currentMessage.files = jsonData.map(f => f.file_uuid);
					}
				} catch (error) {
					warnings.push(`Failed to parse [${currentTag}] block: ${error.message}`);
				}
			}

			textBuffer = '';
		}

		for (const line of lines) {
			const markerMatch = line.match(/^\[([\da-zA-Z_-]+)\]$/);

			if (markerMatch) {

				const marker = markerMatch[1];

				// Flush previous content
				flushTextBuffer();

				if (marker === ROLES.USER.exportDelimiter || marker === ROLES.ASSISTANT.exportDelimiter) {
					// Role marker - start new message
					const role = marker === ROLES.USER.exportDelimiter ? ROLES.USER.apiName : ROLES.ASSISTANT.apiName;

					// Check for consecutive messages of same role
					if (currentMessage && currentMessage.sender === role) {
						throw new Error(`Consecutive [${marker}] blocks not allowed`);
					}

					// Push previous message
					if (currentMessage) messages.push(currentMessage);

					// Start new message
					currentMessage = {
						sender: role,
						content: [],
						files_v2: [],
						files: [],
						attachments: [],
						sync_sources: []
					};
					currentTag = null;
				} else {
					// Content or property tag
					if (!currentMessage) {
						throw new Error(`Found [${marker}] before any message role`);
					}
					currentTag = marker;
				}
			} else {
				// Regular line - add to buffer
				if (textBuffer) textBuffer += '\n';
				textBuffer += line;
			}
		}

		// Flush final content
		flushTextBuffer();
		if (currentMessage) messages.push(currentMessage);

		// Validation
		if (messages.length === 0) {
			throw new Error('No messages found in file');
		}
		if (messages[0].sender !== ROLES.USER.apiName) {
			throw new Error(`Conversation must start with a ${ROLES.USER.exportDelimiter} message`);
		}

		return { name: title, chat_messages: messages, warnings };
	}

	function convertToPhantomMessages(chat_messages) {
		const phantomMessages = [];
		let parentId = "00000000-0000-4000-8000-000000000000";

		for (const message of chat_messages) {
			const messageId = crypto.randomUUID();
			const timestamp = new Date().toISOString();

			// Build content array - add timestamps to each content item
			const content = message.content.map(contentItem => {
				const item = { ...contentItem };
				if (!item.start_timestamp) item.start_timestamp = timestamp;
				if (!item.stop_timestamp) item.stop_timestamp = timestamp;
				if (!item.citations) item.citations = [];
				return item;
			});

			phantomMessages.push({
				uuid: messageId,
				parent_message_uuid: parentId,
				sender: message.sender,
				content: content,
				created_at: timestamp,
				files_v2: message.files_v2 || [],
				files: message.files || [],
				attachments: message.attachments || [],
				sync_sources: []
			});
			parentId = messageId;
		}

		return phantomMessages;
	}

	function formatMessageForChatlog(message) {
		const parts = [];

		// Whitelist of content types to include
		const allowedContentTypes = ['text', 'tool_use', 'tool_result'];

		// Format content
		for (const item of message.content) {
			if (!allowedContentTypes.includes(item.type)) {
				continue; // Skip thinking, etc.
			}

			if (item.type === 'text') {
				parts.push(item.text);
			} else {
				parts.push(JSON.stringify(item));
			}
		}

		// Dump files_v2 as JSON
		if (message.files_v2 && message.files_v2.length > 0) {
			parts.push(JSON.stringify(message.files_v2));
		}

		// Dump attachments as JSON
		if (message.attachments && message.attachments.length > 0) {
			parts.push(JSON.stringify(message.attachments));
		}

		return parts.join('\n\n');
	}

	async function performImport(parsedData, model) {
		const orgId = getOrgId();

		// Create new conversation with parsed name
		const conversation = new ClaudeConversation(orgId);
		const newConvoId = await conversation.create(parsedData.name, model);

		// Build chatlog attachment
		const cleanedContent = parsedData.chat_messages
			.map(msg => formatMessageForChatlog(msg))
			.join('\n\n');

		const chatlogAttachment = {
			extracted_content: cleanedContent,
			file_name: "chatlog.txt",
			file_size: cleanedContent.length,
			file_type: "text/plain"
		};

		// Send initial message
		await conversation.sendMessageAndWaitForResponse(
			"This conversation is imported from the attached chatlog.txt\nYou are Assistant. Simply say 'Acknowledged' and wait for user input.",
			{
				model: model,
				attachments: [chatlogAttachment],
				files: [],
				syncSources: []
			}
		);

		// Convert and store phantom messages
		// In performImport, before converting to phantoms:
		const cleanedMessages = parsedData.chat_messages.map(msg => ({
			...msg,
			files_v2: [],  // Strip until we implement re-upload
			files: []
		}));

		const phantomMessages = convertToPhantomMessages(cleanedMessages);
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
		let parsedData;

		try {
			parsedData = parseAndValidateText(fileContent);
		} catch (error) {
			// Show error
			showClaudeAlert('Import Error', error.message);
			return;
		}

		// Show warnings modal if needed
		if (parsedData.warnings.length > 0) {
			const proceed = await showWarningsModal(parsedData.warnings);
			if (!proceed) return;
		}

		// Show loading modal
		const loadingModal = createLoadingModal('Importing...');
		loadingModal.show();

		try {
			await performImport(parsedData, modelSelect.value);
			// Navigation happens in performImport, loading modal cleaned up automatically
		} catch (error) {
			console.error('Import failed:', error);
			loadingModal.destroy();
			showClaudeAlert('Import Error', error.message || 'Failed to import conversation');
		}
	}

	async function handleReplacePhantom(replaceButton) {
		const conversationId = getConversationId();
		if (!conversationId) {
			showClaudeAlert('Replace Error', 'Not in a conversation');
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
		let parsedData;

		try {
			parsedData = parseAndValidateText(fileContent);
		} catch (error) {
			showClaudeAlert('Replace Error', error.message || 'Invalid format');
			return;
		}

		// Show warnings modal if needed
		if (parsedData.warnings.length > 0) {
			const proceed = await showWarningsModal(parsedData.warnings);
			if (!proceed) return;
		}

		// Show loading modal
		const loadingModal = createLoadingModal('Replacing phantom messages...');
		loadingModal.show();

		try {
			// Convert and store phantom messages
			const phantomMessages = convertToPhantomMessages(parsedData.chat_messages);
			window.postMessage({
				type: 'STORE_PHANTOM_MESSAGES',
				conversationId: conversationId,
				phantomMessages: phantomMessages
			}, '*');

			// Reload to show changes
			window.location.reload();
		} catch (error) {
			console.error('Replace failed:', error);
			loadingModal.destroy();
			showClaudeAlert('Replace Error', error.message || 'Failed to replace phantom messages');
		}
	}
	//#endregion

	async function showExportImportModal() {
		const conversationId = getConversationId();
		if (!conversationId) {
			throw new Error('Not in a conversation');
		}

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
		const modelList = CLAUDE_MODELS;
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
			// Show loading modal
			const loadingModal = createLoadingModal('Exporting...');
			loadingModal.show();

			try {
				// Save the selected format
				localStorage.setItem('lastExportFormat', formatSelect.value);

				const parts = formatSelect.value.split("_");
				const format = parts[0];
				const extension = parts[1];
				const exportTree = toggleInput.checked;

				const orgId = getOrgId();
				const conversation = new ClaudeConversation(orgId, conversationId);
				const conversationData = await conversation.getData(exportTree);

				const filename = `Claude_export_${conversationData.name}_${conversationId}.${extension}`;
				const content = await formatExport(conversationData, format, conversationId);
				downloadFile(filename, content);

				loadingModal.destroy();
				modal.hide();
			} catch (error) {
				console.error('Export failed:', error);
				loadingModal.destroy();
				showClaudeAlert('Export Error', error.message || 'Failed to export conversation');
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