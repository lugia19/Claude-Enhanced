// claude-edit-files.js
(function () {
	'use strict';

	//#region Constants and State

	let pendingEditIntercept = false;
	//#endregion

	//#region Edit Button Interception
	function addAdvancedEditButtons() {
		const userMessages = document.querySelectorAll('[data-testid="user-message"]');

		userMessages.forEach(messageEl => {
			const groupEl = messageEl.closest('.group');
			if (!groupEl) return;

			const controlsContainer = groupEl.querySelector('.absolute.bottom-0.right-2');
			if (!controlsContainer) return;

			// Check if we already added our button
			if (controlsContainer.querySelector('.advanced-edit-button')) return;

			// Find the existing edit button to place ours next to it
			const directButton = controlsContainer.querySelector(':scope > div > div > button[type="button"]');
			if (!directButton) return;

			// Create our advanced edit button using the Claude styles
			const svgContent = `
				<div class="flex items-center justify-center" style="width: 16px; height: 16px;">
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" class="shrink-0" aria-hidden="true" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #2c84db;">
						<!-- File/document -->
						<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h9"/>
						<polyline points="13 2 13 7 18 7"/>
						<!-- Pencil overlapping -->
						<path d="M18.5 8.5a1.5 1.5 0 0 0-2.12 0L10 14.88V18h3.12l6.38-6.38a1.5 1.5 0 0 0 0-2.12z"/>
					</svg>
				</div>
			`;

			const advancedEditBtn = createClaudeButton(svgContent, 'icon');
			advancedEditBtn.type = 'button';
			advancedEditBtn.setAttribute('data-state', 'closed');
			advancedEditBtn.setAttribute('aria-label', 'Advanced Edit');
			advancedEditBtn.classList.add('advanced-edit-button');

			// Adjust size to match other buttons
			advancedEditBtn.classList.remove('h-9', 'w-9');
			advancedEditBtn.classList.add('h-7', 'w-7');

			// Add tooltip with explicit hide-on-click
			createClaudeTooltip(advancedEditBtn, 'Advanced Edit', true);

			// Add click handler
			advancedEditBtn.onclick = async (e) => {
				e.preventDefault();
				e.stopPropagation();

				console.log('Advanced edit button clicked');

				// Click the original edit button to enter edit mode
				directButton.click();

				// Set our intercept flag
				pendingEditIntercept = true;

				// Auto-submit after a short delay
				setTimeout(() => {
					autoSubmitEdit();
				}, 100);
			};

			// Insert button to the left of the existing edit button
			const buttonParent = directButton.parentElement;
			buttonParent.style.display = 'flex';
			buttonParent.style.gap = '2px';
			buttonParent.style.alignItems = 'center';
			buttonParent.insertBefore(advancedEditBtn, directButton);
		});
	}

	function updateMessageUI(messageElement, newText) {
		if (!messageElement) return;

		// Hide original paragraphs (but keep them in DOM)
		const originalParagraphs = messageElement.querySelectorAll('p:not(.custom-edit-text)');
		originalParagraphs.forEach(p => {
			p.style.display = 'none';
			p.classList.add('original-hidden');
		});

		// Add our custom paragraph(s)
		const customP = document.createElement('p');
		customP.className = 'whitespace-pre-wrap break-words custom-edit-text';
		customP.textContent = newText;
		messageElement.appendChild(customP);

		// Set up observer to clean up when Claude updates this message
		const observer = new MutationObserver((mutations, obs) => {
			console.log('Claude updated message, cleaning up edit UI');
			// Clean up our fake content
			messageElement.querySelectorAll('.custom-edit-text').forEach(p => p.remove());
			messageElement.querySelectorAll('.original-hidden').forEach(p => {
				p.style.display = '';
				p.classList.remove('original-hidden');
			});

			// Disconnect observer
			obs.disconnect();
		});

		observer.observe(messageElement, {
			childList: true,      // Node additions/removals
			subtree: true,        // Watch all descendants
			attributes: true,     // Attribute changes
			characterData: true   // Text content changes
		});

	}


	function autoSubmitEdit() {
		if (!pendingEditIntercept) return;

		// Find the submit button
		const saveButton = document.querySelector('button[type="submit"].bg-text-000');

		if (saveButton) {
			console.log('Auto-clicking save button');
			saveButton.click();
		} else {
			// Retry if not found yet
			setTimeout(autoSubmitEdit, 50);
		}
	}
	//#endregion

	//#region Modal UI Construction
	async function createEditModal(url, config) {
		const bodyData = JSON.parse(config.body);
		// Get conversation ID and org ID from URL
		const urlParts = url.split('/');
		const orgId = urlParts[urlParts.indexOf('organizations') + 1];
		const conversationId = urlParts[urlParts.indexOf('chat_conversations') + 1];

		// Fetch the full message data to get file details
		const messageData = await getMessageBeingEdited(orgId, conversationId, bodyData.parent_message_uuid);

		// Merge request data with fetched message data
		const enrichedData = {
			prompt: bodyData.prompt,
			files: bodyData.files || [],
			attachments: bodyData.attachments || [],
			parent_message_uuid: bodyData.parent_message_uuid,
			filesMetadata: messageData?.files_v2 || [],
			originalMessageUuid: messageData?.uuid
		};

		// Return a promise that resolves when user makes a choice
		return new Promise((resolve, reject) => {
			const content = document.createElement('div');
			content.className = 'space-y-4';

			// Files section with real data
			const filesSection = buildFilesSection(enrichedData);
			content.appendChild(filesSection);

			// Text editor section
			const textSection = buildTextEditor(enrichedData.prompt);
			content.appendChild(textSection);

			const modal = createClaudeModal({
				title: 'Edit Message',
				content: content,
				confirmText: 'Submit Edit',
				cancelText: 'Cancel',
				onConfirm: async () => {
					// No more upload wait - just format and send!
					const modalData = collectModalData();
					const modifiedRequest = await formatNewRequest(url, config, modalData);
					modal.remove();
					resolve(modifiedRequest);
				},
				onCancel: () => {
					// Remove modal and reject
					modal.remove();
					reject(new Error('Edit cancelled by user'));
				}
			});
			modal.classList.add('claude-edit-modal');

			// Store submit button reference for enable/disable
			modal.submitButton = Array.from(modal.querySelectorAll('button')).find(
				btn => btn.textContent === 'Submit Edit'
			);

			const modalContainer = modal.querySelector('.bg-bg-100');
			modalContainer.classList.remove('max-w-md');
			modalContainer.classList.add('max-w-2xl');

			// Add modal to document
			document.body.appendChild(modal);
		});
	}

	function buildFilesSection(data) {
		const container = document.createElement('div');
		container.className = 'border border-border-300 rounded-lg p-3';

		// Section header
		const header = document.createElement('h3');
		header.className = 'text-sm font-medium text-text-200 mb-2';
		header.textContent = 'Files & Attachments';
		container.appendChild(header);

		// Files list container - now with scrolling
		const filesList = document.createElement('div');
		filesList.className = 'space-y-2 mb-3 overflow-y-auto';
		filesList.id = 'files-list';
		filesList.style.maxHeight = "200px";

		// Add real files from the request
		if (data.filesMetadata && data.filesMetadata.length > 0) {
			data.filesMetadata.forEach(file => {
				if (data.files.includes(file.file_uuid)) {
					const fileItem = buildFileItem(file);
					filesList.appendChild(fileItem);
				}
			});
		}

		// Add attachments
		if (data.attachments && data.attachments.length > 0) {
			data.attachments.forEach(attachment => {
				const item = buildAttachmentItem(attachment);
				filesList.appendChild(item);
			});
		}

		container.appendChild(filesList);

		// Add file button
		const addButton = buildAddFileButton();
		container.appendChild(addButton);

		return container;
	}

	function buildTextEditor(text) {
		const container = document.createElement('div');

		const label = document.createElement('label');
		label.className = CLAUDE_STYLES.LABEL;
		label.textContent = 'Message Text';
		container.appendChild(label);

		const textarea = document.createElement('textarea');
		textarea.className = CLAUDE_STYLES.INPUT;
		textarea.value = text;
		textarea.id = 'message-text';
		textarea.placeholder = 'Enter your message...';
		textarea.style.resize = 'none'; // Disable manual resize since we're auto-sizing
		textarea.style.minHeight = '150px';
		textarea.style.maxHeight = '400px'; // Set maximum height
		textarea.style.overflowY = 'auto'; // Add scrollbar when max height is reached
		container.appendChild(textarea);

		// Auto-resize function
		const autoResize = () => {
			// Reset height to auto to get the correct scrollHeight
			textarea.style.height = 'auto';

			// Set new height based on content, but not exceeding max height
			const scrollHeight = textarea.scrollHeight;
			const maxHeight = parseInt(textarea.style.maxHeight);

			if (scrollHeight > maxHeight) {
				textarea.style.height = maxHeight + 'px';
			} else {
				textarea.style.height = scrollHeight + 'px';
			}
		};

		// Add event listener for auto-resize on input
		textarea.addEventListener('input', autoResize);

		// Initial auto-resize to fit existing content
		setTimeout(autoResize, 0); // Use setTimeout to ensure DOM is ready

		return container;
	}

	//#endregion
	//#region File Item Builders and Handlers
	function truncateFilename(filename, customMaxLength = null) {
		const maxLength = customMaxLength || (window.innerWidth < window.innerHeight ? 20 : 60);

		if (filename.length <= maxLength) return filename;

		// Try to preserve the extension
		const lastDotIndex = filename.lastIndexOf('.');
		if (lastDotIndex > 0) {
			const name = filename.substring(0, lastDotIndex);
			const extension = filename.substring(lastDotIndex);

			// If extension is reasonable length (<=5 chars like .docx)
			if (extension.length <= 5) {
				const availableLength = maxLength - extension.length - 3; // -3 for "..."
				if (availableLength > 0) {
					return name.substring(0, availableLength) + '...' + extension;
				}
			}
		}

		// Fallback: just truncate and add ellipsis
		return filename.substring(0, maxLength - 3) + '...';
	}


	function buildUploadingFileItem(file) {
		const item = document.createElement('div');
		item.className = 'flex items-center gap-2 p-2 bg-bg-200 rounded opacity-75';
		item.dataset.uploading = 'true';
		item.dataset.fileType = 'files_v2';

		// Loading spinner or placeholder icon
		const icon = document.createElement('div');
		icon.className = 'w-8 h-8 bg-bg-300 rounded flex items-center justify-center text-text-400';

		// Add spinning animation
		const spinner = document.createElement('div');
		spinner.className = 'animate-spin h-5 w-5 border-2 border-text-400 border-t-transparent rounded-full';
		icon.appendChild(spinner);
		item.appendChild(icon);

		// File name with uploading indicator
		const name = document.createElement('span');
		name.className = 'flex-1 text-sm text-text-100';
		name.innerHTML = `${truncateFilename(file.name)} <span class="text-text-400 text-xs">(uploading...)</span>`;
		name.title = file.name;
		item.appendChild(name);

		// Remove button (disabled during upload)
		const removeBtn = createClaudeButton('Remove', 'secondary');
		removeBtn.classList.add('!min-w-0', '!px-2', '!h-7', '!text-xs');
		removeBtn.disabled = true;
		removeBtn.style.opacity = '0.5';
		item.appendChild(removeBtn);

		return item;
	}


	function buildFileItem(file) {
		const item = document.createElement('div');
		item.className = 'flex items-center gap-2 p-2 bg-bg-200 rounded';
		item.dataset.fileUuid = file.file_uuid;
		item.dataset.fileType = 'files_v2';

		// File preview/icon
		const icon = document.createElement('div');
		icon.className = 'w-8 h-8 bg-bg-300 rounded overflow-hidden flex items-center justify-center';

		if (file.file_kind === 'image' && file.thumbnail_asset?.url) {
			const img = document.createElement('img');
			img.src = file.thumbnail_asset.url;
			img.className = 'w-full h-full object-cover';
			icon.appendChild(img);
		} else {
			icon.innerHTML = file.file_kind === 'document' ? '📄' : '📎';
		}
		item.appendChild(icon);

		// File name
		const name = document.createElement('span');
		name.className = 'flex-1 text-sm text-text-100';
		name.textContent = truncateFilename(file.file_name);
		name.title = file.file_name;
		item.appendChild(name);

		// Remove button
		const removeBtn = createClaudeButton('Remove', 'secondary');
		removeBtn.classList.add('!min-w-0', '!px-2', '!h-7', '!text-xs');
		removeBtn.onclick = () => item.remove();
		item.appendChild(removeBtn);
		return item;
	}

	function buildAttachmentItem(attachment) {
		const item = document.createElement('div');
		item.className = 'flex items-center gap-2 p-2 bg-bg-200 rounded';
		item.dataset.fileType = 'attachment';
		item.dataset.fileName = attachment.file_name;
		// Store the full attachment data for reconstruction
		item.dataset.attachmentData = JSON.stringify(attachment);

		// Attachment icon
		const icon = document.createElement('div');
		icon.className = 'w-8 h-8 bg-bg-300 rounded flex items-center justify-center text-text-400';
		icon.innerHTML = '📎';
		item.appendChild(icon);

		// Attachment name
		const name = document.createElement('span');
		name.className = 'flex-1 text-sm text-text-100';
		name.textContent = truncateFilename(attachment.file_name);
		name.title = attachment.file_name;
		item.appendChild(name);

		// Remove button
		const removeBtn = createClaudeButton('Remove', 'secondary');
		removeBtn.classList.add('!min-w-0', '!px-2', '!h-7', '!text-xs');
		removeBtn.onclick = () => item.remove();
		item.appendChild(removeBtn);

		return item;
	}

	function buildAddFileButton() {
		const container = document.createElement('div');
		container.className = 'space-y-2';

		// Buttons container - now with flex-wrap for responsive layout
		const buttonsDiv = document.createElement('div');
		buttonsDiv.className = 'flex gap-2 flex-wrap';

		// Add attachment button (text files) - updated description
		const addAttachmentBtn = createClaudeButton('+ Add Text File (any text format)', 'secondary');
		addAttachmentBtn.style.minWidth = '200px';
		addAttachmentBtn.style.flex = '1';
		addAttachmentBtn.onclick = () => handleAddAttachment();
		buttonsDiv.appendChild(addAttachmentBtn);

		// Add file button (images, PDFs, etc)
		const addFileBtn = createClaudeButton('+ Add File (images, PDFs, docs)', 'secondary');
		addFileBtn.style.minWidth = '200px';
		addFileBtn.style.flex = '1';
		addFileBtn.onclick = () => handleAddFile();
		buttonsDiv.appendChild(addFileBtn);

		container.appendChild(buttonsDiv);

		// Hidden file input for attachments - now accepts ANY text file
		const attachmentInput = document.createElement('input');
		attachmentInput.type = 'file';
		// Accept any text/* MIME type, plus common code/text extensions
		attachmentInput.accept = [
			'text/*',  // Any text MIME type
			'.txt', '.md', '.csv', '.log', '.json', '.xml', '.yaml', '.yml',
			'.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
			'.py', '.pyw', '.ipynb',
			'.java', '.class',
			'.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
			'.cs', '.vb',
			'.php', '.php3', '.php4', '.php5',
			'.rb', '.erb',
			'.go',
			'.rs',
			'.swift',
			'.kt', '.kts',
			'.scala',
			'.r', '.R',
			'.m', '.mm',
			'.pl', '.pm',
			'.lua',
			'.sh', '.bash', '.zsh', '.fish', '.bat', '.cmd', '.ps1',
			'.sql',
			'.html', '.htm', '.xhtml',
			'.css', '.scss', '.sass', '.less',
			'.vue',
			'.svelte',
			'.dart',
			'.elm',
			'.ex', '.exs',
			'.clj', '.cljs',
			'.lisp', '.lsp',
			'.hs',
			'.ml', '.mli',
			'.fs', '.fsi', '.fsx',
			'.nim',
			'.zig',
			'.v',
			'.tf', '.tfvars',
			'.dockerfile', '.containerfile',
			'.makefile', '.mk',
			'.cmake',
			'.gradle', '.gradle.kts',
			'.ini', '.cfg', '.conf', '.config',
			'.toml',
			'.env',
			'.gitignore', '.dockerignore',
			'.editorconfig',
			'.properties',
			'.plist',
			'.asm', '.s'
		].join(',');
		attachmentInput.multiple = true;
		attachmentInput.style.display = 'none';
		attachmentInput.id = 'attachment-input';
		attachmentInput.onchange = async (e) => {
			// Verify files are actually text before processing
			const files = Array.from(e.target.files);
			const validFiles = [];

			for (const file of files) {
				// Check if it's likely a text file by trying to read first few bytes
				if (await isLikelyTextFile(file)) {
					validFiles.push(file);
				} else {
					console.warn(`Skipping ${file.name} - doesn't appear to be a text file`);
				}
			}

			if (validFiles.length > 0) {
				processSelectedAttachments(validFiles);
			}
		};
		container.appendChild(attachmentInput);

		// Hidden file input for real files
		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = 'image/*, .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx';
		fileInput.multiple = true;
		fileInput.style.display = 'none';
		fileInput.id = 'file-input';
		fileInput.onchange = (e) => processSelectedFiles(e.target.files);
		container.appendChild(fileInput);

		return container;
	}

	async function isLikelyTextFile(file) {
		// First check MIME type
		if (file.type && file.type.startsWith('text/')) {
			return true;
		}

		// Check common text file extensions
		const textExtensions = ['.txt', '.md', '.csv', '.log', '.json', '.xml', '.yaml', '.yml',
			'.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.cs',
			'.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.r', '.m',
			'.pl', '.lua', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1', '.sql',
			'.html', '.htm', '.css', '.scss', '.sass', '.vue', '.svelte'];

		const fileName = file.name.toLowerCase();
		if (textExtensions.some(ext => fileName.endsWith(ext))) {
			return true;
		}

		// Try to read first 1KB to check if it's text
		try {
			const slice = file.slice(0, 1024);
			const arrayBuffer = await slice.arrayBuffer();
			const bytes = new Uint8Array(arrayBuffer);

			// Check for null bytes (binary files often have these)
			for (let i = 0; i < bytes.length; i++) {
				if (bytes[i] === 0) {
					return false; // Likely binary
				}
			}

			// Check if most bytes are printable ASCII or common UTF-8
			let printableCount = 0;
			for (let i = 0; i < bytes.length; i++) {
				const byte = bytes[i];
				// Printable ASCII, tab, newline, carriage return, or valid UTF-8 start bytes
				if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13 || byte >= 128) {
					printableCount++;
				}
			}

			// If >90% of bytes are printable, likely text
			return (printableCount / bytes.length) > 0.9;
		} catch (error) {
			console.error('Error checking file type:', error);
			// Default to allowing it if we can't check
			return true;
		}
	}

	function handleAddAttachment() {
		document.getElementById('attachment-input').click();
	}

	function handleAddFile() {
		document.getElementById('file-input').click();
	}
	//#endregion


	//#region File Handling
	async function processSelectedFiles(files) {
		const filesList = document.getElementById('files-list');
		const orgId = getOrgId();

		const filesArray = Array.from(files);
		if (filesArray.length === 0) return;

		let remainingUploads = filesArray.length;

		// Disable submit button with initial count
		updateSubmitButtonState(true, remainingUploads);

		// Create all uploading items first
		const uploadPromises = filesArray.map(async (file) => {
			// Create an uploading file item with placeholder
			const uploadingItem = buildUploadingFileItem(file);
			filesList.appendChild(uploadingItem);

			try {
				// Upload and get full metadata back
				const fileMetadata = await uploadFile(orgId, {
					data: file,
					name: file.name
				});

				// Replace uploading item with real file item that has thumbnail
				const realFileItem = buildFileItem(fileMetadata);
				uploadingItem.replaceWith(realFileItem);

				// Decrement and update button
				remainingUploads--;
				updateSubmitButtonState(remainingUploads > 0, remainingUploads);

				return { success: true, file: file.name };

			} catch (error) {
				console.error(`Failed to upload ${file.name}:`, error);

				// Convert to error state
				const icon = uploadingItem.querySelector('.w-8.h-8');
				icon.innerHTML = '❌';

				const nameSpan = uploadingItem.querySelector('span.text-text-100');
				nameSpan.innerHTML = `${truncateFilename(file.name)} <span class="text-red-600 text-xs">(upload failed)</span>`;
				nameSpan.title = file.name;

				// Mark as failed and make remove button work
				uploadingItem.dataset.failed = 'true';
				uploadingItem.dataset.uploading = 'false';

				const removeBtn = uploadingItem.querySelector('button');
				removeBtn.disabled = false;
				removeBtn.style.opacity = '1';
				removeBtn.onclick = () => uploadingItem.remove();

				// Decrement and update button even on failure
				remainingUploads--;
				updateSubmitButtonState(remainingUploads > 0, remainingUploads);

				return { success: false, file: file.name, error };
			}
		});

		// Wait for all uploads to complete
		const results = await Promise.allSettled(uploadPromises);

		// Final check to ensure button is enabled
		updateSubmitButtonState(false, 0);

		// Log summary
		const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
		const failed = results.length - succeeded;
		console.log(`Upload complete: ${succeeded} succeeded, ${failed} failed`);
	}

	function updateSubmitButtonState(uploading, count = 0) {
		// Find our specific modal and its submit button
		const modal = document.querySelector('.claude-edit-modal');
		if (!modal || !modal.submitButton) return;

		if (uploading && count > 0) {
			modal.submitButton.disabled = true;
			modal.submitButton.textContent = `Submit Edit (${count} uploading...)`;
			modal.submitButton.style.opacity = '0.5';
			modal.submitButton.style.cursor = 'not-allowed';
		} else {
			modal.submitButton.disabled = false;
			modal.submitButton.textContent = 'Submit Edit';
			modal.submitButton.style.opacity = '1';
			modal.submitButton.style.cursor = 'pointer';
		}
	}

	async function processSelectedAttachments(files) {
		const filesList = document.getElementById('files-list');

		for (const file of files) {
			// Read the text content
			const content = await readTextFile(file);

			// Create attachment object
			const attachment = {
				file_name: file.name,
				file_type: file.type || 'text/plain',
				file_size: file.size,
				extracted_content: content
			};

			// Add to the list
			const attachmentItem = buildAttachmentItem(attachment);
			filesList.appendChild(attachmentItem);
		}
	}

	function collectModalData() {
		const messageText = document.getElementById('message-text').value;
		const fileItems = document.querySelectorAll('#files-list > div');
		const fileUuids = [];
		const attachments = [];

		fileItems.forEach(item => {
			// Skip failed uploads
			if (item.dataset.failed === 'true' || item.dataset.uploading === 'true') {
				return;
			}

			if (item.dataset.fileType === 'files_v2') {
				const uuid = item.dataset.fileUuid;
				if (uuid) {
					fileUuids.push(uuid);
				}
			} else if (item.dataset.fileType === 'attachment') {
				const attachment = item.dataset.attachmentData;
				if (attachment) {
					attachments.push(JSON.parse(attachment));
				}
			}
		});

		return {
			text: messageText,
			fileUuids: fileUuids,
			attachments: attachments
		};
	}
	//#endregion

	async function getMessageBeingEdited(orgId, conversationId, parentUuid) {
		try {
			const response = await fetch(
				`/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=False&rendering_mode=messages&render_all_tools=true`
			);

			if (!response.ok) {
				console.error('Failed to fetch conversation data');
				return null;
			}

			const data = await response.json();

			// Find the message that has our parent UUID as its parent
			const messageBeingEdited = data.chat_messages.find(
				msg => msg.parent_message_uuid === parentUuid && msg.sender === 'human'
			);

			console.log('Found message being edited:', messageBeingEdited);
			return messageBeingEdited;
		} catch (error) {
			console.error('Error fetching message data:', error);
			return null;
		}
	}

	async function readTextFile(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e) => resolve(e.target.result);
			reader.onerror = (e) => reject(e);
			reader.readAsText(file);
		});
	}

	async function formatNewRequest(url, config, modalData) {
		const bodyData = JSON.parse(config.body);
		const modifiedData = modalData || collectModalData();

		// All files are already uploaded, just use their UUIDs
		const modifiedBody = {
			...bodyData,
			prompt: modifiedData.text,
			attachments: modifiedData.attachments,
			files: modifiedData.fileUuids  // These are all real UUIDs now
		};

		return {
			url,
			config: {
				...config,
				body: JSON.stringify(modifiedBody)
			}
		};
	}
	//#endregion

	//#region Fetch Patching
	const originalFetch = window.fetch;
	window.fetch = async (...args) => {
		const [input, config] = args;

		let url = undefined;
		if (input instanceof URL) {
			url = input.href;
		} else if (typeof input === 'string') {
			url = input;
		} else if (input instanceof Request) {
			url = input.url;
		}

		// Intercept /completion requests when edit flag is set
		if (url && url.includes('/completion') && pendingEditIntercept && config?.method === 'POST') {
			console.log('Intercepting edit completion request');
			const messageElement = pendingEditIntercept; // Store reference before resetting
			pendingEditIntercept = null; // Reset flag immediately

			try {
				// Create modal and wait for user action
				const modifiedRequest = await createEditModal(url, config);

				// Update the UI with the new text immediately
				const bodyData = JSON.parse(modifiedRequest.config.body);
				setTimeout(() => {
					const userMessages = document.querySelectorAll('[data-testid="user-message"]');
					const lastMessage = userMessages[userMessages.length - 1];
					if (lastMessage) {
						updateMessageUI(lastMessage, bodyData.prompt);
					}
				}, 200);

				// User confirmed - make the modified request
				return originalFetch(modifiedRequest.url, modifiedRequest.config);
			} catch (error) {
				// User cancelled - throw error to cancel the request
				console.log('Edit cancelled by user');
				throw error;
			}
		}

		return originalFetch(...args);
	};
	//#endregion

	// Initialize - start checking for edit buttons every 2 seconds
	setInterval(addAdvancedEditButtons, 2000);
})();