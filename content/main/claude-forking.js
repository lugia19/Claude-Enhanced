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
		const selectOptions = CLAUDE_MODELS;
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
	async function getConversationMessages(orgId, conversationId, targetParentUuid) {
		const conversation = new ClaudeConversation(orgId, conversationId);
		const conversationData = await conversation.getData(false);

		let messages = [];

		for (const message of conversationData.chat_messages) {
			messages.push(message); // Keep full message object with all properties

			if (message.parent_message_uuid === targetParentUuid) {
				break;
			}
		}

		return {
			conversation,      // The ClaudeConversation instance
			conversationData,  // Raw data with name, projectUuid, etc.
			messages          // Clean array of message objects
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

	//#region Fork creation
	function deduplicateByFilename(items) {
		const seen = new Map();
		// Iterate in reverse so newer items (later in array) win
		for (let i = items.length - 1; i >= 0; i--) {
			const item = items[i];
			const name = item.file_name || item.name;
			if (name && !seen.has(name)) {
				seen.set(name, item);
			}
		}
		return Array.from(seen.values()).reverse();
	}

	async function createFork(orgId, messages, chatName, projectUuid, model, includeAttachments, styleData) {
		if (!chatName || chatName.trim() === '') chatName = "Untitled";
		const newName = `Fork of ${chatName}`;

		const conversation = new ClaudeConversation(orgId);
		const newUuid = await conversation.create(newName, model, projectUuid);

		// Store all messages as phantoms for UI display
		storePhantomMessages(newUuid, messages);

		// Format all messages as chatlog
		const chatlogText = messages.map((msg, index) => {
			return ClaudeConversation.extractMessageText(msg);
		}).join('\n\n');

		// Collect files and attachments
		let finalFiles = [];
		let finalAttachments = [];

		if (includeAttachments) {
			const allFiles = messages.flatMap(m => m.files_v2 || []);
			const allAttachments = messages.flatMap(m => m.attachments || []);
			const allSyncSources = messages.flatMap(m => m.sync_sources || []);

			// Deduplicate by filename, keeping newest
			const dedupedFiles = deduplicateByFilename(allFiles);
			const dedupedAttachments = deduplicateByFilename(allAttachments);

			// Download and upload files
			const downloadedFiles = await downloadFiles(dedupedFiles.map(f => ({
				uuid: f.file_uuid,
				url: f.file_kind === "image" ? f.preview_asset.url : f.document_asset.url,
				kind: f.file_kind,
				name: f.file_name
			})));

			finalFiles = await Promise.all(
				downloadedFiles.map(file => uploadFile(orgId, file).then(meta => meta.file_uuid))
			);

			/*const processedSyncSources = await Promise.all(
				allSyncSources.map(sync => processSyncSource(orgId, sync))
			);*/

			finalAttachments = [...dedupedAttachments];
		}

		// Add chatlog.txt
		finalAttachments.push({
			extracted_content: chatlogText,
			file_name: "chatlog.txt",
			file_size: chatlogText.length,
			file_type: "text/plain"
		});

		const message = "This conversation is forked from the attached chatlog.txt. Simply say 'Acknowledged' and wait for user input.";

		await conversation.sendMessageAndWaitForResponse(message, {
			model: model,
			attachments: finalAttachments,
			files: finalFiles,
			syncSources: [],
			personalizedStyles: styleData
		});

		return newUuid;
	}

	async function getSummaryMessages(orgId, messagesToSummarize, summaryPrompt, includeAttachments) {
		// Collect all files and attachments from messages being summarized
		const files = messagesToSummarize.flatMap(m => m.files_v2 || []);
		const attachments = messagesToSummarize.flatMap(m => m.attachments || []);
		const syncSources = messagesToSummarize.flatMap(m => m.sync_sources || []);

		// Adjust prompt based on whether files will be forwarded
		let fullPrompt = summaryPrompt;
		if (includeAttachments) {
			fullPrompt += "\n\nIMPORTANT: Don't include any information already present in the other attachments, as those will be forwarded to the new chat as well. Do not summarize the content of any attached files - only summarize the conversation itself.";
		} else {
			fullPrompt += "\n\nIMPORTANT: Since files will NOT be forwarded to the new conversation, please also include summaries of any file contents that are relevant to understanding the conversation.";
		}

		// Format messages as chatlog for summarization
		const chatlogText = messagesToSummarize.map((msg, index) => {
			const role = msg.sender === 'human' ? '[User]' : '[Assistant]';
			const text = ClaudeConversation.extractMessageText(msg);
			return `${role}\n${text}`;
		}).join('\n\n');

		// Create temporary conversation for summary
		const summaryConvoName = `Temp_Summary_${Date.now()}`;
		const tempConversation = new ClaudeConversation(orgId);
		const summaryConvoId = await tempConversation.create(summaryConvoName, 'claude-haiku-4-5-20251001', null);

		try {
			// Download and upload files for summary generation
			const downloadedFiles = await downloadFiles(files.map(f => ({
				uuid: f.file_uuid,
				url: f.file_kind === "image" ? f.preview_asset.url : f.document_asset.url,
				kind: f.file_kind,
				name: f.file_name
			})));

			const uploadedFileUuids = await Promise.all(
				downloadedFiles.map(file => uploadFile(orgId, file).then(meta => meta.file_uuid))
			);

			/*const processedSyncSources = await Promise.all(
				syncSources.map(sync => processSyncSource(orgId, sync))
			);*/
			// TODO: Support these. For now, skip them.

			// Add chatlog as attachment
			const summaryAttachments = [
				...attachments,
				{
					extracted_content: chatlogText,
					file_name: "chatlog.txt",
					file_size: chatlogText.length,
					file_type: "text/plain"
				}
			];

			// Get summary
			const assistantMessage = await tempConversation.sendMessageAndWaitForResponse(fullPrompt, {
				attachments: summaryAttachments,
				files: uploadedFileUuids,
				//syncSources: processedSyncSources
			});

			const summaryText = ClaudeConversation.extractMessageText(assistantMessage);

			// Return synthetic messages
			// If includeAttachments is true, attach the files/attachments to the synthetic user message
			const userUuid = crypto.randomUUID();

			return [
				{
					uuid: userUuid,
					parent_message_uuid: "00000000-0000-4000-8000-000000000000", // Root
					sender: 'human',
					content: [{ type: 'text', text: summaryText }],
					files_v2: includeAttachments ? files : [],
					files: includeAttachments ? files.map(f => f.file_uuid) : [],
					attachments: includeAttachments ? attachments : [],
					sync_sources: [],
					created_at: new Date().toISOString(),
				},
				{
					uuid: crypto.randomUUID(),
					parent_message_uuid: userUuid, // Chain to the user message
					sender: 'assistant',
					content: [{ type: 'text', text: 'Acknowledged. I understand the context from the summary and am ready to continue our conversation.' }],
					files_v2: [],
					files: [],
					attachments: [],
					sync_sources: [],
					created_at: new Date().toISOString(),
				}
			];
		} finally {
			//await tempConversation.delete();
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
			console.log('Intercepted retry request');
			const bodyJSON = JSON.parse(config?.body);
			const messageID = bodyJSON?.parent_message_uuid;
			const urlParts = url.split('/');
			const orgId = urlParts[urlParts.indexOf('organizations') + 1];
			const conversationId = urlParts[urlParts.indexOf('chat_conversations') + 1];
			const styleData = bodyJSON?.personalized_styles;
			const loadingModal = pendingFork.loadingModal;

			try {
				if (loadingModal) {
					loadingModal.setContent(createLoadingContent('Getting conversation messages...'));
				}

				let { conversation, conversationData, messages } =
					await getConversationMessages(orgId, conversationId, messageID);

				const chatName = conversationData.name;
				const projectUuid = conversationData.project?.uuid || null;

				// Apply summary if needed
				if (pendingFork.rawTextPercentage < 100) {
					if (loadingModal) {
						loadingModal.setContent(createLoadingContent('Generating conversation summary...'));
					}

					let split = Math.ceil(messages.length * pendingFork.rawTextPercentage / 100);

					// Adjust split to ensure we cut before a user message
					while (split < messages.length && messages[split].sender !== 'human') {
						split++;
					}

					// If we went past the end, just keep everything
					if (split >= messages.length) {
						split = 0; // Don't summarize anything
					}

					const toSummarize = messages.slice(0, messages.length - split);
					const toKeep = messages.slice(messages.length - split);

					if (toSummarize.length > 0) {
						const summaryMsgs = await getSummaryMessages(orgId, toSummarize, pendingFork.summaryPrompt, pendingFork.includeAttachments);
						if (toKeep.length > 0) {
							toKeep[0] = {
								...toKeep[0],
								parent_message_uuid: summaryMsgs[1].uuid  // Point to synthetic assistant
							};
						}
						messages = [...summaryMsgs, ...toKeep];
					}
				}

				if (loadingModal) {
					loadingModal.setContent(createLoadingContent('Creating forked conversation...'));
				}

				const newConversationId = await createFork(
					orgId,
					messages,
					chatName,
					projectUuid,
					pendingFork.model,
					pendingFork.includeAttachments,
					styleData
				);

				if (loadingModal) {
					loadingModal.setContent(createLoadingContent('Fork complete! Redirecting...'));
				}

				console.log('Forked conversation created:', newConversationId);
				setTimeout(() => {
					if (newConversationId) window.location.href = `/chat/${newConversationId}`;
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