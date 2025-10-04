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
			{ value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
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
		fullLabel.className = CLAUDE_CLASSES.FLEX_GAP_2 + ' space-x-2';
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
		summaryLabel.className = CLAUDE_CLASSES.FLEX_GAP_2 + ' space-x-2';
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
		note.className = CLAUDE_CLASSES.TEXT_SM;
		note.textContent = 'Note: Should you choose a slow model such as Opus, you may need to wait and refresh the page for the response to appear.';
		content.appendChild(note);

		// Create modal
		const modal = createClaudeModal({
			title: 'Choose Model for Fork',
			content: content,
			confirmText: 'Fork Chat',
			cancelText: 'Cancel',
			onConfirm: () => { },  // Will be set by the caller
			onCancel: () => { }    // Will be set by the caller
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
			const accountData = await getAccountSettings();
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

	async function getConversationContext(orgId, conversationId, targetParentUuid) {
		const response = await fetch(`/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=False&rendering_mode=messages&render_all_tools=true`);
		const conversationData = await response.json();

		let messages = [];
		let fullMessageObjects = []; // NEW: Store the complete message objects
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

			// NEW: Store the full message object (excluding some fields we don't need)
			fullMessageObjects.push({
				uuid: message.uuid,
				parent_message_uuid: message.parent_message_uuid,
				sender: message.sender,
				content: message.content,
				files_v2: message.files_v2,
				files: message.files,
				attachments: message.attachments,
				sync_sources: message.sync_sources,
				created_at: message.created_at,
				// Add any other fields the UI needs for rendering
			});

			// Process until we find a message that has our target UUID as parent
			if (message.parent_message_uuid === targetParentUuid) {
				break;
			}
		}

		if (!includeAttachments) {
			return {
				chatName,
				messages,
				fullMessageObjects, // NEW
				syncsources: [],
				attachments: [],
				files: [],
				projectUuid
			};
		}

		return {
			chatName,
			messages,
			fullMessageObjects, // NEW
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
				const blob = await downloadFile(file.url);
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
	//#endregion

	//#region Convo forking


	async function createForkedConversation(orgId, context, model, styleData) {
		if (!context.chatName || context.chatName.trim() === '') context.chatName = "Untitled"
		const newName = `Fork of ${context.chatName}`;

		// Create a new chat conversation
		const conversation = new ClaudeConversation(orgId);
		const newUuid = await conversation.create(newName, model, context.projectUuid);

		// Store the fork history BEFORE sending the initial message
		if (context.fullMessageObjects && context.fullMessageObjects.length > 0) {
			storePhantomMessages(newUuid, context.fullMessageObjects);
		}

		// Create the chatlog (existing code)
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

		// Send initial message and wait for response
		await conversation.sendMessageAndWaitForResponse(message, {
			model: model,
			attachments: context.attachments,
			files: context.files,
			syncSources: context.syncsources,
			personalizedStyles: styleData,
			waitMinutes: 3
		});

		return newUuid;
	}


	async function generateSummary(orgId, context) {
		// Create a temporary conversation for summarization
		const summaryConvoName = `Temp_Summary_${Date.now()}`;
		const conversation = new ClaudeConversation(orgId);

		// Check if user is pro for paprika mode
		const userType = await getUserType(orgId);
		const paprikaMode = userType !== 'free';

		const summaryConvoId = await conversation.create(summaryConvoName, null, context.projectUuid, paprikaMode);

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

			const assistantMessage = await conversation.sendMessageAndWaitForResponse(summaryPrompt, {
				attachments: summaryAttachments,
				files: [],
				syncSources: [],
				waitMinutes: 2
			});

			// Extract the text of the summary using the static helper
			const summaryText = ClaudeConversation.extractMessageText(assistantMessage);

			return summaryText;
		} finally {
			// Delete the temporary summarization conversation
			await conversation.delete();
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
						Promise.all(downloadedFiles.map(async file => {
							const metadata = await uploadFile(orgId, file);
							return metadata.file_uuid;
						})),
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
					const summary = await generateSummary(orgId, context);
					if (summary === null) {
						throw new Error('Failed to generate summary. This may be due to service disruption or usage limits.');
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

				// Navigate to new conversation in 100ms
				console.log('Forked conversation created:', newConversationId);
				setTimeout(() => {
					window.location.href = `/chat/${newConversationId}`;
				}, 100);

			} catch (error) {
				console.error('Failed to fork conversation:', error);
			} finally {
				if (originalSettings) {
					await updateAccountSettings(originalSettings);
				}
				originalSettings = null;
				pendingForkModel = null;
				pendingUseSummary = false;
			}

			return new Response(JSON.stringify({ success: true }));
		}

		return originalFetch(...args);
	};
	//#endregion

	//Check for buttons every 3 seconds
	setInterval(addBranchButtons, 3000);
})();