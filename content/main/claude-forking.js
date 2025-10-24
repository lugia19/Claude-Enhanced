// claude-forking.js
(function () {
	'use strict';
	const defaultSummaryPrompt =
		`I've attached a chatlog from a previous conversation. Please create a complete, detailed summary of the conversation that covers all important points, questions, and responses. This summary will be used to continue the conversation in a new chat, so make sure it provides enough context to understand the full discussion. Be thorough, and think things through. Make it lengthy.
If this is a technical discussion, include any relevant technical details, code snippets, or explanations that were part of the conversation, maintaining information concerning only the latest version of any code discussed.
If this is a writing or creative discussion, include sections for characters, plot points, setting info, etcetera.`;

	let pendingFork = {
		model: null,
		includeAttachments: true,
		rawTextPercentage: 100,
		summaryPrompt: defaultSummaryPrompt,
		originalSettings: null
	};

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

		button.classList.remove('h-9', 'w-9');
		button.classList.add('h-8', 'w-8');

		createClaudeTooltip(button, 'Fork from here');

		button.onclick = async (e) => {
			e.preventDefault();
			e.stopPropagation();

			const modal = await createConfigModal(button);
			modal.show();
		};

		return button;
	}

	async function createConfigModal(forkButton) {
		const content = document.createElement('div');

		// Model select
		const selectOptions = [
			{ value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
			{ value: 'claude-sonnet-4-20250514', label: 'Sonnet 4' },
			{ value: 'claude-opus-4-1-20250805', label: 'Opus 4.1' },
			{ value: 'claude-opus-4-20250514', label: 'Opus 4' },
			{ value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
			{ value: 'claude-3-7-sonnet-20250219', label: 'Sonnet 3.7' },
			{ value: 'claude-3-opus-20240229', label: 'Opus 3' },
			{ value: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5' }
		];
		const modelSelect = createClaudeSelect(selectOptions, selectOptions[0].value);
		modelSelect.classList.add('mb-4');
		content.appendChild(modelSelect);

		// Raw text slider section
		const rawTextContainer = document.createElement('div');
		rawTextContainer.className = 'mb-4 space-y-2 border border-border-300 rounded p-3';

		const rawTextSlider = createClaudeSlider('Preserve X% of recent messages:', 100);
		rawTextSlider.input.id = 'rawTextPercentage';
		rawTextContainer.appendChild(rawTextSlider.container);

		// Summary prompt input (initially hidden)
		const summaryPromptContainer = document.createElement('div');
		summaryPromptContainer.id = 'summaryPromptContainer';
		summaryPromptContainer.style.display = 'none';
		summaryPromptContainer.className = 'mt-2';

		const promptLabel = document.createElement('label');
		promptLabel.className = CLAUDE_CLASSES.LABEL;
		promptLabel.textContent = 'Summary Prompt:';
		summaryPromptContainer.appendChild(promptLabel);

		const promptInput = document.createElement('textarea');
		promptInput.className = CLAUDE_CLASSES.INPUT;
		promptInput.placeholder = 'Enter custom summary prompt...';
		promptInput.value = defaultSummaryPrompt;
		promptInput.rows = 10;
		promptInput.style.resize = 'vertical';
		promptInput.id = 'summaryPrompt';
		summaryPromptContainer.appendChild(promptInput);

		rawTextContainer.appendChild(summaryPromptContainer);
		content.appendChild(rawTextContainer);

		// Toggle visibility of summary prompt input based on slider value
		rawTextSlider.input.addEventListener('change', (e) => {
			summaryPromptContainer.style.display = e.target.value < 100 ? 'block' : 'none';
		});

		// Include files toggle
		const includeFilesContainer = document.createElement('div');
		includeFilesContainer.className = 'mb-4';
		includeFilesContainer.id = 'includeFilesContainer';
		const includeFilesToggle = createClaudeToggle('Include files', true);
		includeFilesToggle.input.id = 'includeFiles';
		includeFilesContainer.appendChild(includeFilesToggle.container);
		content.appendChild(includeFilesContainer);

		// Create modal
		const modal = new ClaudeModal('Choose Model for Fork', content);

		// Wider modal
		modal.modal.classList.remove('max-w-md');
		modal.modal.classList.add('max-w-lg');

		modal.addCancel();
		modal.addConfirm('Fork Chat', async () => {
			const model = modelSelect.value;
			const rawTextPercentage = parseInt(rawTextSlider.input.value);
			const customPrompt = promptInput.value;
			const includeFiles = includeFilesToggle.input.checked;

			// Destroy config modal and show loading modal
			modal.destroy();
			await forkConversationClicked(model, forkButton, rawTextPercentage, customPrompt, includeFiles);

			return false; // Modal already destroyed
		});

		// Fetch account settings
		try {
			const accountData = await getAccountSettings();
			pendingFork.originalSettings = accountData.settings;
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

	async function forkConversationClicked(model, forkButton, rawTextPercentage, customPrompt, includeFiles) {
		const loadingModal = createLoadingModal('Preparing to fork conversation...');
		loadingModal.show();

		try {
			const conversationId = getConversationId();
			console.log('Forking conversation', conversationId, 'with model', model);

			// Set up our global to catch the next retry request
			pendingFork.model = model;
			pendingFork.includeAttachments = includeFiles;
			pendingFork.rawTextPercentage = rawTextPercentage;
			pendingFork.summaryPrompt = customPrompt || defaultSummaryPrompt;
			pendingFork.loadingModal = loadingModal; // Store reference for updates

			loadingModal.setContent(createLoadingContent('Triggering fork process...'));

			// Find and click the retry button
			const buttonGroup = forkButton.closest('.justify-between');
			const retryButton = Array.from(buttonGroup.querySelectorAll('button'))
				.find(button => button.textContent.includes('Retry'));

			if (retryButton) {
				retryButton.dispatchEvent(new PointerEvent('pointerdown', {
					bubbles: true,
					cancelable: true,
					view: window,
					pointerType: 'mouse'
				}));

				await new Promise(resolve => setTimeout(resolve, 300));

				const withNoChangesOption = Array.from(document.querySelectorAll('[role="menuitem"]'))
					.find(element => element.textContent.includes('With no changes'));

				if (withNoChangesOption) {
					console.log('Detected retry dropdown, clicking "With no changes"');
					withNoChangesOption.click();
				} else {
					console.log('No dropdown detected, assuming direct retry');
					retryButton.click();
				}
			} else {
				throw new Error('Could not find retry button');
			}
		} catch (error) {
			console.error('Failed to fork conversation:', error);
			loadingModal.setTitle('Error');
			loadingModal.setContent(`Failed to fork conversation: ${error.message}`);
			loadingModal.clearButtons();
			loadingModal.addConfirm('OK');
		}
	}

	//#region Convo extraction & Other API
	async function getConversationContext(orgId, conversationId, targetParentUuid) {
		const conversation = new ClaudeConversation(orgId, conversationId);
		const conversationData = await conversation.getData(false);

		let messages = [];
		let fullMessageObjects = [];
		let projectUuid = conversationData?.project?.uuid || null;
		const chatName = conversationData.name;
		const files = [];
		const syncsources = [];
		const attachments = [];

		for (const message of conversationData.chat_messages) {
			// Extract message text using the ClaudeConversation helper
			const messageContent = ClaudeConversation.extractMessageText(message);

			// Collect files
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

			// Collect attachments
			if (message.attachments) {
				for (const attachment of message.attachments) {
					attachments.push(attachment);
				}
			}

			// Collect sync sources
			for (const sync of message.sync_sources) {
				syncsources.push(sync);
			}

			messages.push(messageContent);

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
			});

			if (message.parent_message_uuid === targetParentUuid) {
				break;
			}
		}

		if (!pendingFork.includeAttachments) {
			return {
				chatName,
				messages,
				fullMessageObjects,
				syncsources: [],
				attachments: [],
				files: [],
				projectUuid
			};
		}

		return {
			chatName,
			messages,
			fullMessageObjects,
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

		const conversation = new ClaudeConversation(orgId);
		const newUuid = await conversation.create(newName, model, context.projectUuid);

		if (context.fullMessageObjects && context.fullMessageObjects.length > 0) {
			storePhantomMessages(newUuid, context.fullMessageObjects);
		}

		// Determine the instructional message based on what's included
		let message;
		if (context.summary && context.rawChatlog) {
			message = "This conversation is forked from the attached conversation history. The older portion has been summarized in conversation_summary.txt, while the recent messages are preserved verbatim in recent_chatlog.txt. Simply say 'Acknowledged' and wait for user input.";
		} else if (context.summary) {
			message = "This conversation is forked based on the summary in conversation_summary.txt. Simply say 'Acknowledged' and wait for user input.";
		} else {
			message = "This conversation is forked from the attached chatlog.txt. Simply say 'Acknowledged' and wait for user input.";
		}

		await conversation.sendMessageAndWaitForResponse(message, {
			model: model,
			attachments: context.attachments,
			files: context.files,
			syncSources: context.syncsources,
			personalizedStyles: styleData
		});

		return newUuid;
	}

	async function generateSummary(orgId, context, summaryPrompt, rawTextPercentage, includeAttachments) {
		const totalMessages = context.messages.length;

		// Calculate how many messages to keep as raw text (rounding up)
		const rawMessageCount = Math.ceil(totalMessages * rawTextPercentage / 100);
		const summaryMessageCount = totalMessages - rawMessageCount;

		// Check character count threshold
		const messagesToSummarize = context.messages.slice(0, summaryMessageCount);
		const rawMessages = context.messages.slice(summaryMessageCount);

		/*
		const summarizeCharCount = messagesToSummarize.join('\n\n').length;

		// If below 20k characters, just include everything as raw
		if (summarizeCharCount < 20000) {
			console.log('Content to summarize is below 20k characters, including all as raw text');
			return {
				summary: null,
				rawChatlog: context.messages.join('\n\n')
			};
		}*/

		// Modify the prompt based on whether files are included
		let finalPrompt = summaryPrompt;
		if (includeAttachments) {
			finalPrompt += "\n\nnIMPORTANT: Don't include any information already present in the other attachments, as those will be forwarded to the new chat as well. Do not summarize the content of any attached files - only summarize the conversation itself."
		} else {
			finalPrompt += "\n\nIMPORTANT: Since files will NOT be forwarded to the new conversation, please also include summaries of any file contents that are relevant to understanding the conversation.";
		}

		// Generate summary for the older portion
		const summaryConvoName = `Temp_Summary_${Date.now()}`;
		const conversation = new ClaudeConversation(orgId);

		const summaryConvoId = await conversation.create(summaryConvoName, 'claude-haiku-4-5-20251001', context.projectUuid);

		try {
			const chatlogToSummarize = messagesToSummarize.map((msg, index) => {
				const role = index % 2 === 0 ? '[User]' : '[Assistant]';
				return `${role}\n${msg}`;
			}).join('\n\n');

			const summaryAttachments = [...context.attachments, {
				"extracted_content": chatlogToSummarize,
				"file_name": "chatlog.txt",
				"file_size": 0,
				"file_type": "text/plain"
			}];

			const assistantMessage = await conversation.sendMessageAndWaitForResponse(finalPrompt, {
				attachments: summaryAttachments,
				files: [],
				syncSources: []
			});

			const summaryText = ClaudeConversation.extractMessageText(assistantMessage);

			// Format raw messages with role labels
			const rawChatlog = rawMessages.map((msg, index) => {
				const absoluteIndex = summaryMessageCount + index;
				const role = absoluteIndex % 2 === 0 ? '[User]' : '[Assistant]';
				return `${role}\n${msg}`;
			}).join('\n\n');

			return {
				summary: summaryText,
				rawChatlog: rawChatlog
			};
		} finally {
			await conversation.delete();
		}
	}
	//#endregion

	//#region Fetch patching
	const originalFetch = window.fetch;
	window.fetch = async (...args) => {
		const [input, config] = args;

		let url = undefined
		if (input instanceof URL) {
			url = input.href
		} else if (typeof input === 'string') {
			url = input
		} else if (input instanceof Request) {
			url = input.url
		}

		if (url && url.includes('/retry_completion') && pendingFork.model) {
			console.log('Intercepted retry request:', config?.body);
			const bodyJSON = JSON.parse(config?.body);
			const messageID = bodyJSON?.parent_message_uuid;
			const urlParts = url.split('/');
			const orgId = urlParts[urlParts.indexOf('organizations') + 1];
			const conversationId = urlParts[urlParts.indexOf('chat_conversations') + 1];

			let styleData = bodyJSON?.personalized_styles;
			const loadingModal = pendingFork.loadingModal;

			try {
				if (loadingModal) {
					loadingModal.setContent(createLoadingContent('Getting conversation context...'));
				}

				console.log('Getting conversation context, pendingFork.includeAttachments:', pendingFork.includeAttachments);
				const context = await getConversationContext(orgId, conversationId, messageID);

				if (pendingFork.includeAttachments) {
					if (loadingModal) {
						loadingModal.setContent(createLoadingContent('Downloading files...'));
					}

					const downloadedFiles = await downloadFiles(context.files);

					if (loadingModal) {
						loadingModal.setContent(createLoadingContent('Uploading files to new conversation...'));
					}

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

				if (pendingFork.rawTextPercentage < 100) {
					if (loadingModal) {
						loadingModal.setContent(createLoadingContent('Generating conversation summary...'));
					}

					console.log(`Generating hybrid fork with ${pendingFork.rawTextPercentage}% raw text`);
					const result = await generateSummary(orgId, context, pendingFork.summaryPrompt, pendingFork.rawTextPercentage, pendingFork.includeAttachments);

					const hybridContext = { ...context };
					hybridContext.messages = null;
					hybridContext.attachments = [...context.attachments];

					if (result.summary) {
						hybridContext.summary = result.summary;
						hybridContext.attachments.push({
							"extracted_content": result.summary,
							"file_name": "conversation_summary.txt",
							"file_size": 0,
							"file_type": "text/plain"
						});
					}

					if (result.rawChatlog) {
						hybridContext.rawChatlog = result.rawChatlog;
						hybridContext.attachments.push({
							"extracted_content": result.rawChatlog,
							"file_name": "recent_chatlog.txt",
							"file_size": 0,
							"file_type": "text/plain"
						});
					}

					if (loadingModal) {
						loadingModal.setContent(createLoadingContent('Creating forked conversation...'));
					}

					newConversationId = await createForkedConversation(orgId, hybridContext, pendingFork.model, styleData);
				} else {
					// 100% raw text - full chatlog mode
					const chatlog = context.messages.join('\n\n');

					context.attachments.push({
						"extracted_content": chatlog,
						"file_name": "chatlog.txt",
						"file_size": chatlog.length,
						"file_type": "text/plain"
					});

					if (loadingModal) {
						loadingModal.setContent(createLoadingContent('Creating forked conversation...'));
					}

					newConversationId = await createForkedConversation(orgId, context, pendingFork.model, styleData);
				}

				if (loadingModal) {
					loadingModal.setContent(createLoadingContent('Fork complete! Redirecting...'));
				}

				console.log('Forked conversation created:', newConversationId);
				setTimeout(() => {
					window.location.href = `/chat/${newConversationId}`;
				}, 100);

			} catch (error) {
				console.error('Failed to fork conversation:', error);

				if (loadingModal) {
					loadingModal.setTitle('Error');
					loadingModal.setContent(`Failed to fork conversation: ${error.message}`);
					loadingModal.clearButtons();
					loadingModal.addConfirm('OK');
				}
			} finally {
				if (pendingFork.originalSettings) {
					await updateAccountSettings(pendingFork.originalSettings);
				}
				pendingFork = {
					model: null,
					includeAttachments: true,
					rawTextPercentage: 100,
					summaryPrompt: defaultSummaryPrompt,
					originalSettings: null,
					loadingModal: null
				};
			}

			return new Response(JSON.stringify({ success: true }));
		}

		return originalFetch(...args);
	};
	//#endregion

	setInterval(addBranchButtons, 3000);
})();