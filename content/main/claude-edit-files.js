// claude-edit-files.js
(function () {
	'use strict';

	//#region Constants and State

	let pendingEditIntercept = false;

	const TEMP_STYLE_NAME = 'advanced_edit_temporary_style';
	const TEMP_STYLE_STORAGE_KEY = 'temp_style_id';
	//#endregion

	//#region Edit Button Interception
	function addAdvancedEditButtons() {
		const { userMessages } = getUIMessages();
		userMessages.forEach(messageEl => {
			const controlsContainer = findMessageControls(messageEl);
			if (!controlsContainer) return;

			// Check if we already added our button
			if (controlsContainer.querySelector('.advanced-edit-button')) return;

			// Find the edit button by its unique SVG path (pencil icon)
			const allButtons = controlsContainer.querySelectorAll('button[type="button"]');
			let editButton = null;
			let editButtonWrapper = null;

			for (const button of allButtons) {
				const svgPath = button.querySelector('svg path');
				if (svgPath && svgPath.getAttribute('d')?.startsWith('M9.72821 2.87934')) {
					editButton = button;
					editButtonWrapper = button.closest('div.w-fit');
					break;
				}
			}

			if (!editButton || !editButtonWrapper) return;

			// Create our advanced edit button
			const svgContent = `
            <div class="flex items-center justify-center" style="width: 20px; height: 20px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" class="shrink-0" aria-hidden="true" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" style="color: currentColor;">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h9"/>
                    <polyline points="13 2 13 7 18 7"/>
                    <path d="M18.5 8.5a1.5 1.5 0 0 0-2.12 0L10 14.88V18h3.12l6.38-6.38a1.5 1.5 0 0 0 0-2.12z"/>
                </svg>
            </div>
        `;

			const advancedEditBtn = createClaudeButton(svgContent, 'icon');
			advancedEditBtn.type = 'button';
			advancedEditBtn.setAttribute('data-state', 'closed');
			advancedEditBtn.setAttribute('aria-label', 'Advanced Edit');
			advancedEditBtn.classList.add('advanced-edit-button');
			advancedEditBtn.classList.add('h-8', 'w-8');

			createClaudeTooltip(advancedEditBtn, 'Advanced Edit', true);

			advancedEditBtn.onclick = async (e) => {
				e.preventDefault();
				e.stopPropagation();

				console.log('Advanced edit button clicked');
				editButton.click();
				pendingEditIntercept = true;

				setTimeout(async () => {
					autoSubmitEdit();
				}, 100);
			};

			// Create wrapper div matching the structure
			const advancedEditWrapper = document.createElement('div');
			advancedEditWrapper.className = 'w-fit';
			advancedEditWrapper.setAttribute('data-state', 'closed');
			advancedEditWrapper.appendChild(advancedEditBtn);

			// Insert before the edit button wrapper
			editButtonWrapper.parentElement.insertBefore(advancedEditWrapper, editButtonWrapper);
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
			console.log('Auto-submitting edit');

			// Find the form
			const form = saveButton.closest('form');
			if (!form) {
				setTimeout(autoSubmitEdit, 50);
				return;
			}

			// Find the textarea
			const textarea = form.querySelector('textarea');
			if (!textarea) {
				setTimeout(autoSubmitEdit, 50);
				return;
			}

			// Focus the textarea
			textarea.focus();

			// Move cursor to end
			textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

			// Use execCommand to insert text (triggers all events naturally, enables submitting)
			document.execCommand('insertText', false, ' ');

			// Give it a moment to process, then click
			setTimeout(() => {
				saveButton.click();
			}, 100);
		} else {
			// Retry if not found yet
			setTimeout(autoSubmitEdit, 50);
		}
	}
	//#endregion

	//#region Modal UI Construction
	async function createEditModal(url, config) {
		const bodyData = JSON.parse(config.body);
		const urlParts = url.split('/');
		const orgId = urlParts[urlParts.indexOf('organizations') + 1];
		const conversationId = urlParts[urlParts.indexOf('chat_conversations') + 1];

		const messageData = await getMessageBeingEdited(orgId, conversationId, bodyData.parent_message_uuid);

		// Extract style text from personalized_styles array
		const originalStyle = bodyData.personalized_styles?.[0];
		let originalStyleText = originalStyle?.prompt || '';
		if (originalStyleText == "Normal") originalStyleText = '';

		const enrichedData = {
			prompt: bodyData.prompt,
			files: bodyData.files || [],
			attachments: bodyData.attachments || [],
			parent_message_uuid: bodyData.parent_message_uuid,
			filesMetadata: messageData?.files_v2 || [],
			styleText: originalStyleText
		};

		return new Promise((resolve, reject) => {
			const content = document.createElement('div');
			content.className = 'space-y-4';

			const filesSection = buildFilesSection(enrichedData);
			content.appendChild(filesSection);

			const editorSection = buildEditorSection(enrichedData);
			content.appendChild(editorSection);

			const modal = new ClaudeModal('Edit Message', content);

			// Make modal wider
			modal.modal.classList.remove('max-w-md');
			modal.modal.classList.add('max-w-2xl');

			// Add cancel button
			modal.addCancel('Cancel', () => {
				reject(new Error('Edit cancelled by user'));
			});

			// Add confirm button with async handling
			const submitBtn = modal.addConfirm('Submit Edit', async (btn) => {
				btn.disabled = true;
				btn.style.opacity = '0.5';
				btn.style.cursor = 'not-allowed';
				const originalText = btn.textContent;
				btn.textContent = 'Submitting...';

				const modalData = collectModalData();

				try {
					const modifiedRequest = await formatNewRequest(url, config, modalData);
					console.log("Resolving request with modified data:", modifiedRequest);
					resolve(modifiedRequest);
					return true; // Close modal
				} catch (error) {
					console.error('Error formatting new request:', error);
					btn.disabled = false;
					btn.style.opacity = '1';
					btn.style.cursor = 'pointer';
					btn.style.backgroundColor = '#dc2626';
					btn.textContent = 'Style Error: ' + error.message;
					setTimeout(() => {
						btn.style.backgroundColor = '';
						btn.textContent = originalText;
					}, 3000);
					return false; // Keep modal open on error
				}
			});

			// Store button reference for upload status updates
			// Use backdrop since that's what updateSubmitButtonState queries for
			modal.backdrop.classList.add('claude-edit-modal');
			modal.backdrop.submitButton = submitBtn;

			modal.show();
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
		filesList.className = CLAUDE_CLASSES.LIST_CONTAINER + ' mb-3';
		filesList.style.maxHeight = '200px';
		filesList.id = 'files-list';

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

	function buildEditorSection(data) {
		const container = document.createElement('div');
		container.className = 'border border-border-300 rounded-lg p-3';

		// Toggle header
		const header = document.createElement('div');
		header.className = CLAUDE_CLASSES.FLEX_BETWEEN + ' mb-3';
		const label = document.createElement('span');
		label.className = 'text-sm font-medium text-text-200';
		label.textContent = 'Editing:';
		header.appendChild(label);

		const { container: toggle, input: toggleInput } = createClaudeToggle('', false);
		const promptLabel = document.createElement('span');
		promptLabel.className = 'text-sm text-text-200';
		promptLabel.textContent = 'Prompt';
		const styleLabel = document.createElement('span');
		styleLabel.className = 'text-sm text-text-200';
		styleLabel.textContent = 'Style';
		toggle.insertBefore(promptLabel, toggle.firstChild);
		toggle.appendChild(styleLabel);
		header.appendChild(toggle);
		container.appendChild(header);

		// Textareas
		const promptTA = document.createElement('textarea');
		promptTA.id = 'message-text';
		promptTA.className = CLAUDE_CLASSES.INPUT;
		promptTA.value = data.prompt;
		promptTA.placeholder = 'Enter your message...';
		promptTA.style.resize = 'none';
		promptTA.style.minHeight = '150px';
		promptTA.style.maxHeight = '400px';
		promptTA.style.overflowY = 'auto';
		container.appendChild(promptTA);

		const styleTA = document.createElement('textarea');
		styleTA.id = 'style-text';
		styleTA.className = CLAUDE_CLASSES.INPUT;
		styleTA.value = data.styleText;
		styleTA.placeholder = 'Enter style instructions...';
		styleTA.style.resize = 'none';
		styleTA.style.minHeight = '150px';
		styleTA.style.maxHeight = '400px';
		styleTA.style.overflowY = 'auto';
		styleTA.style.display = 'none';
		container.appendChild(styleTA);

		// Auto-resize each independently
		const resize = (ta) => {
			const maxHeight = parseInt(getComputedStyle(ta).maxHeight);
			ta.style.height = 'auto';
			ta.style.height = Math.min(ta.scrollHeight, maxHeight) + 'px';
		};
		promptTA.oninput = () => resize(promptTA);
		styleTA.oninput = () => resize(styleTA);

		// Toggle behavior
		toggleInput.onchange = (e) => {
			if (e.target.checked) {
				promptTA.style.display = 'none';
				styleTA.style.display = 'block';
				setTimeout(() => resize(styleTA), 0);
			} else {
				styleTA.style.display = 'none';
				promptTA.style.display = 'block';
				setTimeout(() => resize(promptTA), 0);
			}
		};

		setTimeout(() => resize(promptTA), 0);
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
		item.className = CLAUDE_CLASSES.LIST_ITEM + " opacity-75" + ' flex items-center gap-2';
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
		item.className = CLAUDE_CLASSES.LIST_ITEM + ' flex items-center gap-2'
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
		item.className = CLAUDE_CLASSES.LIST_ITEM + ' flex items-center gap-2'
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
		const styleText = document.getElementById('style-text').value;
		const fileItems = document.querySelectorAll('#files-list > div');
		const fileUuids = [];
		const attachments = [];

		fileItems.forEach(item => {
			if (item.dataset.failed === 'true' || item.dataset.uploading === 'true') {
				return;
			}

			if (item.dataset.fileType === 'files_v2') {
				const uuid = item.dataset.fileUuid;
				if (uuid) fileUuids.push(uuid);
			} else if (item.dataset.fileType === 'attachment') {
				const attachment = item.dataset.attachmentData;
				if (attachment) attachments.push(JSON.parse(attachment));
			}
		});

		return {
			text: messageText,
			styleText: styleText,
			fileUuids: fileUuids,
			attachments: attachments
		};
	}

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
		const originalStyle = bodyData.personalized_styles?.[0];
		let originalStyleText = originalStyle?.prompt || '';
		if (originalStyleText == "Normal") originalStyleText = '';

		// Extract orgId from URL
		const urlParts = url.split('/');
		const orgId = urlParts[urlParts.indexOf('organizations') + 1];

		const modifiedBody = {
			...bodyData,
			prompt: modalData.text,
			attachments: modalData.attachments,
			files: modalData.fileUuids
		};

		// Only update style if it changed
		if (modalData.styleText !== originalStyleText) {
			const tempStyleId = await ensureTempStyle(orgId, modalData.styleText);
			modifiedBody.personalized_styles = [{
				key: tempStyleId,
				uuid: tempStyleId,
				prompt: modalData.styleText,
				name: TEMP_STYLE_NAME,
				isDefault: false,
				type: "custom",
				summary: "This is a temporary style created for editing.",
				attributes: [
					{
						"name": "Assertive",
						"percentage": 0.7
					},
					{
						"name": "Direct",
						"percentage": 0.8
					},
					{
						"name": "Uncompromising",
						"percentage": 0.6
					}
				]
			}];
		}

		return {
			url,
			config: {
				...config,
				body: JSON.stringify(modifiedBody)
			}
		};
	}
	//#endregion

	//#region Style injector for temporary style
	function getTempStyleId() {
		return localStorage.getItem(TEMP_STYLE_STORAGE_KEY);
	}

	function setTempStyleId(styleId) {
		localStorage.setItem(TEMP_STYLE_STORAGE_KEY, styleId);
	}

	async function createTempStyle(orgId, text) {
		try {
			// Create style without name (auto-generated)
			const createResponse = await fetch(`/api/organizations/${orgId}/styles/create`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ prompt: text })
			});

			if (!createResponse.ok) {
				const error = await createResponse.json();
				throw new Error(error.message || 'Failed to create style');
			}

			const createData = await createResponse.json();
			const styleId = createData.uuid;

			// Now edit to set the name
			const editResponse = await fetch(`/api/organizations/${orgId}/styles/${styleId}/edit`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt: text,
					name: TEMP_STYLE_NAME
				})
			});

			if (!editResponse.ok) {
				const error = await editResponse.json();
				throw new Error(error.message || 'Failed to name style');
			}

			setTempStyleId(styleId);
			return styleId;
		} catch (error) {
			console.error('Error creating temp style:', error);
			throw error;
		}
	}

	async function updateTempStyle(orgId, styleId, text) {
		const response = await fetch(`/api/organizations/${orgId}/styles/${styleId}/edit`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				prompt: text,
				name: TEMP_STYLE_NAME
			})
		});

		if (!response.ok) {
			const error = await response.json();
			throw {
				status: response.status,
				message: error.message || 'Failed to update style'
			};
		}

		return await response.json();
	}

	async function ensureTempStyle(orgId, text) {
		let styleId = getTempStyleId();

		if (!styleId) {
			return await createTempStyle(orgId, text);
		}

		try {
			await updateTempStyle(orgId, styleId, text);
			return styleId;
		} catch (error) {
			// Only recreate if style is missing (404), otherwise re-throw
			if (error.status === 404) {
				console.log('Temp style not found, creating new one');
				return await createTempStyle(orgId, text);
			}

			// For any other error (like 400 content filter), throw it
			throw new Error(error.message);
		}
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

		// Intercept list_styles to filter out temp style
		if (url && url.includes('/list_styles')) {
			const response = await originalFetch(...args);

			if (!response.ok) {
				return response;
			}

			const data = await response.json();

			// Filter out temp style from customStyles
			if (data.customStyles) {
				data.customStyles = data.customStyles.filter(
					style => style.name !== TEMP_STYLE_NAME
				);
			}

			// Return modified response
			return new Response(JSON.stringify(data), {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers
			});
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
					const { userMessages } = getUIMessages();
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