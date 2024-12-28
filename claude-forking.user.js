// ==UserScript==
// @name         Claude Forking
// @namespace    https://lugia19.com
// @version      0.1
// @description  Adds forking functionality to claude.ai
// @match        https://claude.ai/*
// @grant        none
// @license      GPLv3
// ==/UserScript==

(function () {
	'use strict';
	let pendingForkModel = null;
	let isProcessing = false;

	//#region UI elements creation
	function createBranchButton() {
		const button = document.createElement('button');
		button.className = 'branch-button flex flex-row items-center gap-1 rounded-md p-1 py-0.5 text-xs transition-opacity delay-100 hover:bg-bg-200 group/button';

		button.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="1.35em" height="1.35em" fill="currentColor" viewBox="0 0 22 22">
				<path d="M7 5C7 3.89543 7.89543 3 9 3C10.1046 3 11 3.89543 11 5C11 5.74028 10.5978 6.38663 10 6.73244V14.0396H11.7915C12.8961 14.0396 13.7915 13.1441 13.7915 12.0396V10.7838C13.1823 10.4411 12.7708 9.78837 12.7708 9.03955C12.7708 7.93498 13.6662 7.03955 14.7708 7.03955C15.8753 7.03955 16.7708 7.93498 16.7708 9.03955C16.7708 9.77123 16.3778 10.4111 15.7915 10.7598V12.0396C15.7915 14.2487 14.0006 16.0396 11.7915 16.0396H10V17.2676C10.5978 17.6134 11 18.2597 11 19C11 20.1046 10.1046 21 9 21C7.89543 21 7 20.1046 7 19C7 18.2597 7.4022 17.6134 8 17.2676V6.73244C7.4022 6.38663 7 5.74028 7 5Z"/>
			</svg>
			<span>Fork</span>
		`;

		button.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();

			const modal = createModal();
			document.body.appendChild(modal);

			// Add event listeners
			modal.querySelector('#cancelFork').onclick = () => {
				modal.remove();
			};

			// And in our modal click handler:
			modal.querySelector('#confirmFork').onclick = () => {
				const model = modal.querySelector('select').value;
				forkConversationClicked(model, button);  // Pass the fork button as context
				modal.remove();
			};

			// Click outside to cancel
			modal.onclick = (e) => {
				if (e.target === modal) {
					modal.remove();
				}
			};
		};

		return button;
	}

	function createModal() {
		const modal = document.createElement('div');
		modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';

		modal.innerHTML = `
			<div class="bg-bg-100 rounded-lg p-6 shadow-xl max-w-sm w-full mx-4 border border-border-300">
				<h3 class="text-lg font-semibold mb-4 text-text-100">Choose Model for Fork</h3>
				<select class="w-full p-2 rounded mb-4 bg-bg-200 text-text-100 border border-border-300">
					<option value="claude-3-5-sonnet-20241022">Sonnet 3.5 (New)</option>
					<option value="claude-3-5-sonnet-20240620">Sonnet 3.5 (Old)</option>
					<option value="claude-3-opus-20240229">Opus 3</option>
					<option value="claude-3-5-haiku-20241022">Haiku 3.5</option>
				</select>
				<p class="text-sm text-text-400 sm:text-[0.75rem]">Note: Should you choose a slow model such as Opus, you may need to wait and refresh the page for the response to appear.</p>
				<div class="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
					<button class="inline-flex items-center justify-center relative shrink-0 ring-offset-2 ring-offset-bg-300 ring-accent-main-100 focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none bg-accent-main-100 bg-gradient-to-r from-accent-main-100 via-accent-main-200/50 to-accent-main-200 bg-[length:200%_100%] hover:bg-right active:bg-accent-main-000 border-0.5 border-border-300 text-oncolor-100 font-medium font-styrene drop-shadow-sm transition-all shadow-[inset_0_0.5px_0px_rgba(255,255,0,0.15)] [text-shadow:_0_1px_2px_rgb(0_0_0_/_10%)] active:shadow-[inset_0_1px_6px_rgba(0,0,0,0.2)] hover:from-accent-main-200 hover:to-accent-main-200 h-9 px-4 py-2 rounded-lg min-w-[5rem] active:scale-[0.985] whitespace-nowrap" id="confirmFork">
						Fork Chat
					</button>
					<button class="inline-flex items-center justify-center relative shrink-0 ring-offset-2 ring-offset-bg-300 ring-accent-main-100 focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none bg-[radial-gradient(ellipse,_var(--tw-gradient-stops))] from-bg-500/10 from-50% to-bg-500/30 border-0.5 border-border-400 font-medium font-styrene text-text-100/90 transition-colors active:bg-bg-500/50 hover:text-text-000 hover:bg-bg-500/60 h-9 px-4 py-2 rounded-lg min-w-[5rem] active:scale-[0.985] whitespace-nowrap" id="cancelFork">
						Cancel
					</button>
				</div>
			</div>
		`;

		return modal;
	}

	function findMessageControls(messageElement) {
		if (messageElement.classList.contains('font-user-message')) {
			const group = messageElement.closest('.group');
			const buttons = group?.querySelectorAll('button');
			if (!buttons) return;
			const editButton = Array.from(buttons).find(button =>
				button.textContent.includes('Edit')
			);
			return editButton?.closest('.text-text-400.flex');
		}

		if (messageElement.classList.contains('font-claude-message')) {
			const group = messageElement.closest('.group');
			const buttons = group?.querySelectorAll('button');
			const retryButton = Array.from(buttons).find(button =>
				button.textContent.includes('Retry')
			);
			return retryButton?.closest('.text-text-400.flex');
		}

		return null;
	}

	function addBranchButtons() {
		if (isProcessing) return;
		try {
			isProcessing = true;
			const messages = document.querySelectorAll('.font-claude-message');	//Only add to claude messages, as we leverage the retry button.
			messages.forEach((message) => {
				const controls = findMessageControls(message);
				if (controls && !controls.querySelector('.branch-button')) {
					const branchBtn = createBranchButton();
					controls.insertBefore(branchBtn, controls.firstChild);
				}
			});
		} catch (error) {
			console.error('Error adding branch buttons:', error);
		} finally {
			isProcessing = false;
		}
	}
	//#endregion


	function forkConversationClicked(model, forkButton) {
		// Get conversation ID from URL
		const conversationId = window.location.pathname.split('/').pop();
		console.log('Forking conversation', conversationId, 'with model', model);

		// Set up our global to catch the next retry request
		pendingForkModel = model;

		// Find and click the retry button in the same control group as our fork button
		const buttonGroup = forkButton.closest('.text-text-400.flex');
		const retryButton = Array.from(buttonGroup.querySelectorAll('button'))
			.find(button => button.textContent.includes('Retry'));

		if (retryButton) {
			retryButton.click();
		} else {
			console.error('Could not find retry button');
		}
	}

	//#region Convo extraction
	async function getConversationContext(orgId, conversationId, targetParentUuid) {
		const response = await fetch(`/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=False&rendering_mode=messages&render_all_tools=true`);
		const conversationData = await response.json();

		let messages = [];
		let projectUuid = conversationData.project_uuid || null;
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
				syncsources.push(sync?.config?.uri);
			}

			messages.push(messageContent.join(' '));

			// Process until we find a message that has our target UUID as parent
			if (message.parent_message_uuid === targetParentUuid) {
				break;
			}
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

	async function processSyncSource(orgId, uri) {
		const response = await fetch(`/api/organizations/${orgId}/sync/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				sync_source_config: {
					uri: uri
				},
				sync_source_type: "gdrive"
			})
		});

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

	async function createForkedConversation(orgId, context, model, styleData) {
		const newUuid = generateUuid();
		const newName = `Fork of ${context.chatName}`;

		const chatlog = context.messages.map((msg, index) => {
			const role = index % 2 === 0 ? 'User' : 'Assistant';
			return `${role}\n${msg}`;
		}).join('\n\n');

		context.attachments.push({
			"extracted_content": chatlog,
			"file_name": "chatlog.txt",
			"file_size": 0,
			"file_type": "text/plain"
		})

		const createResponse = await fetch(`/api/organizations/${orgId}/chat_conversations`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				uuid: newUuid,
				name: newName,
				model: model,
				include_conversation_preferences: true
			})
		});

		if (!createResponse.ok) {
			throw new Error('Failed to create conversation');
		}

		// Send initial message to set up conversation history
		const completionResponse = await fetch(`/api/organizations/${orgId}/chat_conversations/${newUuid}/completion`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				prompt: "This conversation is forked from the attached chatlog.txt\nYou are Assistant. Simply say 'Acknowledged' and wait for user input.",
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

		// Sleep for 2 seconds to allow the response to be fully created...
		await new Promise(r => setTimeout(r, 2000));
		return newUuid;
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
				const context = await getConversationContext(orgId, conversationId, messageID);
				const downloadedFiles = await downloadFiles(context.files);

				// Parallel processing of files and syncs
				[context.files, context.syncsources] = await Promise.all([
					Promise.all(downloadedFiles.map(file => uploadFile(orgId, file))),
					Promise.all(context.syncsources.map(uri => processSyncSource(orgId, uri)))
				]);

				// Create forked conversation
				const newConversationId = await createForkedConversation(orgId, context, pendingForkModel, styleData);

				// Navigate to new conversation
				console.log('Forked conversation created:', newConversationId);
				window.location.href = `/chat/${newConversationId}`;
			} catch (error) {
				console.error('Failed to fork conversation:', error);
			}

			pendingForkModel = null; // Clear the pending flag
			return new Response(JSON.stringify({ success: true }));
		}

		return originalFetch(...args);
	};
	//#endregion

	//Check for buttons every 3 seconds
	setInterval(addBranchButtons, 3000);
})();