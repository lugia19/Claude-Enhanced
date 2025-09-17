// claude-forking.js
(function () {
	'use strict';

	let pendingForkModel = null;
	let includeAttachments = true;
	let pendingUseSummary = false;
	let originalSettings = null;

	//#region UI elements creation
	function createBranchButton() {
		const svgContent = `
        <div class="flex items-center justify-center" style="width: 16px; height: 16px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 22 22" class="shrink-0" aria-hidden="true">
                <path d="M7 5C7 3.89543 7.89543 3 9 3C10.1046 3 11 3.89543 11 5C11 5.74028 10.5978 6.38663 10 6.73244V14.0396H11.7915C12.8961 14.0396 13.7915 13.1441 13.7915 12.0396V10.7838C13.1823 10.4411 12.7708 9.78837 12.7708 9.03955C12.7708 7.93498 13.6662 7.03955 14.7708 7.03955C15.8753 7.03955 16.7708 7.93498 16.7708 9.03955C16.7708 9.77123 16.3778 10.4111 15.7915 10.7598V12.0396C15.7915 14.2487 14.0006 16.0396 11.7915 16.0396H10V17.2676C10.5978 17.6134 11 18.2597 11 19C11 20.1046 10.1046 21 9 21C7.89543 21 7 20.1046 7 19C7 18.2597 7.4022 17.6134 8 17.2676V6.73244C7.4022 6.38663 7 5.74028 7 5Z"/>
            </svg>
        </div>
    `;

		const button = createClaudeButton(svgContent, 'icon');
		button.type = 'button';
		button.setAttribute('data-state', 'closed');
		button.setAttribute('aria-label', 'Fork from here');

		// Override default size if needed
		button.classList.remove('h-9', 'w-9');
		button.classList.add('h-8', 'w-8');

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

		return button;
	}

	async function createModal() {
		// Create the content programmatically
		const content = document.createElement('div');

		// Model select
		const selectOptions = [
			{ value: 'claude-sonnet-4-20250514', label: 'Sonnet 4' },
			{ value: 'claude-opus-4-1-20250805', label: 'Opus 4.1' },
			{ value: 'claude-opus-4-20250514', label: 'Opus 4' },
			{ value: 'claude-3-7-sonnet-20250219', label: 'Sonnet 3.7' },
			{ value: 'claude-3-opus-20240229', label: 'Opus 3' },
			{ value: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5' }
		];
		const modelSelect = createClaudeSelect(selectOptions, 'claude-sonnet-4-20250514');
		modelSelect.classList.add('mb-4');
		content.appendChild(modelSelect);

		// Fork type section
		const forkTypeContainer = document.createElement('div');
		forkTypeContainer.className = 'mb-4 space-y-2';

		const forkTypeBox = document.createElement('div');
		forkTypeBox.className = 'flex items-center justify-between mb-3 p-2 bg-bg-200 rounded';

		const forkTypeLabel = document.createElement('span');
		forkTypeLabel.className = 'text-text-100 font-medium';
		forkTypeLabel.textContent = 'Fork Type:';

		const radioContainer = document.createElement('div');
		radioContainer.className = 'flex items-center gap-4';

		// Full chatlog radio
		const fullLabel = document.createElement('label');
		fullLabel.className = CLAUDE_STYLES.FLEX_GAP_2 + ' space-x-2';
		const fullRadio = document.createElement('input');
		fullRadio.type = 'radio';
		fullRadio.id = 'fullChatlog';
		fullRadio.name = 'forkType';
		fullRadio.value = 'full';
		fullRadio.checked = true;
		fullRadio.className = 'accent-accent-main-100';
		const fullSpan = document.createElement('span');
		fullSpan.textContent = 'Full Chatlog';
		fullLabel.appendChild(fullRadio);
		fullLabel.appendChild(fullSpan);

		// Summary radio
		const summaryLabel = document.createElement('label');
		summaryLabel.className = CLAUDE_STYLES.FLEX_GAP_2 + ' space-x-2';
		const summaryRadio = document.createElement('input');
		summaryRadio.type = 'radio';
		summaryRadio.id = 'summaryMode';
		summaryRadio.name = 'forkType';
		summaryRadio.value = 'summary';
		summaryRadio.className = 'accent-accent-main-100';
		const summarySpan = document.createElement('span');
		summarySpan.textContent = 'Summary';
		summaryLabel.appendChild(summaryRadio);
		summaryLabel.appendChild(summarySpan);

		radioContainer.appendChild(fullLabel);
		radioContainer.appendChild(summaryLabel);
		forkTypeBox.appendChild(forkTypeLabel);
		forkTypeBox.appendChild(radioContainer);
		forkTypeContainer.appendChild(forkTypeBox);

		// Include files container
		const includeFilesContainer = document.createElement('div');
		includeFilesContainer.id = 'includeFilesContainer';
		const includeFilesToggle = createClaudeToggle('Include files', true);
		includeFilesToggle.input.id = 'includeFiles';
		includeFilesContainer.appendChild(includeFilesToggle.container);
		forkTypeContainer.appendChild(includeFilesContainer);

		content.appendChild(forkTypeContainer);

		// Note text
		const note = document.createElement('p');
		note.className = CLAUDE_STYLES.TEXT_SM;
		note.textContent = 'Note: Should you choose a slow model such as Opus, you may need to wait and refresh the page for the response to appear.';
		content.appendChild(note);

		// Create modal
		const modal = createClaudeModal({
			title: 'Choose Model for Fork',
			content: content,
			confirmText: 'Fork Chat',
			cancelText: 'Cancel',
			onConfirm: null,  // Will be set by the caller
			onCancel: null    // Will be set by the caller
		});

		// Add IDs to buttons for external reference
		const buttons = modal.querySelectorAll('button');
		buttons.forEach(btn => {
			if (btn.textContent === 'Fork Chat') {
				btn.id = 'confirmFork';
			} else if (btn.textContent === 'Cancel') {
				btn.id = 'cancelFork';
			}
		});

		// Store reference to select for easy access
		modal.modelSelect = modelSelect;

		try {
			const accountData = await fetchAccountSettings();
			originalSettings = accountData.settings;
		} catch (error) {
			console.error('Failed to fetch account settings:', error);
		}

		return modal;
	}

	function addBranchButtons() {
		try {
			addMessageButtonWithPriority(createBranchButton, 'fork-button');
		} catch (error) {
			console.error('Error adding branch buttons:', error);
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