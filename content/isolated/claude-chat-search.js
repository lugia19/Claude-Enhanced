// claude-search.js
(function () {
	'use strict';

	// ======== HELPERS ========
	function getRelativeTime(timestamp) {
		const now = Date.now();
		const messageTime = new Date(timestamp).getTime();
		const diff = now - messageTime;

		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);
		const weeks = Math.floor(days / 7);
		const months = Math.floor(days / 30);
		const years = Math.floor(days / 365);

		if (years > 0) return `${years}y ago`;
		if (months > 0) return `${months}mo ago`;
		if (weeks > 0) return `${weeks}w ago`;
		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (minutes > 0) return `${minutes}m ago`;
		return 'just now';
	}

	function simplifyText(text) {
		return text
			.toLowerCase()
			.replace(/[*_`~\[\]()]/g, '')  // Remove markdown chars
			.replace(/\s+/g, ' ')           // Normalize whitespace
			.replace(/[""'']/g, '"')        // Normalize quotes
			.trim();
	}

	function fuzzyMatch(searchText, targetText) {
		// Get words from search text (ignore very short words)
		const searchWords = searchText
			.toLowerCase()
			.split(/\s+/)
			.filter(word => word.length > 2);

		const targetLower = targetText.toLowerCase();

		// Count how many search words appear in target
		const matchedWords = searchWords.filter(word => targetLower.includes(word));

		const matchRatio = matchedWords.length / searchWords.length;
		return matchRatio >= 0.85;
	}

	// ======== INDEXEDDB MANAGEMENT ========
	const DB_NAME = 'claudeSearchIndex';
	const DB_VERSION = 1;
	const METADATA_STORE = 'metadata';
	const MESSAGES_STORE = 'messages';

	class SearchDatabase {
		constructor() {
			this.db = null;
		}

		async init() {
			console.log('[IndexedDB] Starting init...');

			if (this.initPromise) {
				console.log('[IndexedDB] Already initializing, waiting...');
				return this.initPromise;
			}

			if (this.db) {
				console.log('[IndexedDB] Already initialized');
				return;
			}

			this.initPromise = new Promise((resolve, reject) => {
				console.log('[IndexedDB] Opening database...');
				const request = indexedDB.open(DB_NAME, DB_VERSION);

				request.onerror = () => {
					console.error('[IndexedDB] Error:', request.error);
					this.initPromise = null;
					reject(request.error);
				};

				request.onsuccess = () => {
					console.log('[IndexedDB] Success!');
					this.db = request.result;
					this.initPromise = null;
					resolve();
				};

				request.onupgradeneeded = (event) => {
					console.log('[IndexedDB] Upgrade needed');
					const db = event.target.result;
					// Metadata store: uuid -> full conversation object from API
					if (!db.objectStoreNames.contains(METADATA_STORE)) {
						db.createObjectStore(METADATA_STORE, { keyPath: 'uuid' });
					}

					// Messages store: uuid -> compressed messages
					if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
						db.createObjectStore(MESSAGES_STORE, { keyPath: 'uuid' });
					}
				};

				request.onblocked = () => {
					console.warn('[IndexedDB] BLOCKED - close other tabs!');
				};
			});

			return this.initPromise;
		}

		async getMetadata(conversationId) {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				const transaction = this.db.transaction([METADATA_STORE], 'readonly');
				const store = transaction.objectStore(METADATA_STORE);
				const request = store.get(conversationId);

				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		}

		async getAllMetadata() {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				const transaction = this.db.transaction([METADATA_STORE], 'readonly');
				const store = transaction.objectStore(METADATA_STORE);
				const request = store.getAll();

				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		}

		async setMetadata(conversationObj) {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				const transaction = this.db.transaction([METADATA_STORE], 'readwrite');
				const store = transaction.objectStore(METADATA_STORE);
				const request = store.put(conversationObj);

				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});
		}

		async getMessages(conversationId) {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				const transaction = this.db.transaction([MESSAGES_STORE], 'readonly');
				const store = transaction.objectStore(MESSAGES_STORE);
				const request = store.get(conversationId);

				request.onsuccess = () => {
					const result = request.result;
					if (!result) {
						resolve(null);
						return;
					}

					// Decompress
					const decompressed = LZString.decompressFromUTF16(result.compressedData);
					resolve(JSON.parse(decompressed));
				};
				request.onerror = () => reject(request.error);
			});
		}

		async setMessages(conversationId, messages) {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				// Compress
				const json = JSON.stringify(messages);
				const compressed = LZString.compressToUTF16(json);

				const transaction = this.db.transaction([MESSAGES_STORE], 'readwrite');
				const store = transaction.objectStore(MESSAGES_STORE);
				const request = store.put({
					uuid: conversationId,
					compressedData: compressed
				});

				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});
		}

		async deleteConversation(conversationId) {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				const transaction = this.db.transaction([METADATA_STORE, MESSAGES_STORE], 'readwrite');

				const metadataStore = transaction.objectStore(METADATA_STORE);
				const messagesStore = transaction.objectStore(MESSAGES_STORE);

				metadataStore.delete(conversationId);
				messagesStore.delete(conversationId);

				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
		}
	}

	// Global database instance
	const searchDB = new SearchDatabase();
	// ======== SYNC LOGIC ========
	async function getConversationsToUpdate() {
		const orgId = getOrgId();

		const response = await fetch(`/api/organizations/${orgId}/chat_conversations`);
		if (!response.ok) {
			throw new Error('Failed to fetch conversations');
		}

		const allConversations = await response.json();
		console.log(`Found ${allConversations.length} total conversations`);

		const storedMetadata = await searchDB.getAllMetadata();
		const storedMap = new Map(storedMetadata.map(m => [m.uuid, m]));

		const toUpdate = [];
		for (const conv of allConversations) {
			const stored = storedMap.get(conv.uuid);

			if (!stored) {
				// No metadata - needs update
				toUpdate.push(conv);
			} else {
				// Check if messages exist
				const messages = await searchDB.getMessages(conv.uuid);

				if (!messages || messages.length === 0) {
					// Metadata exists but no messages - needs update
					toUpdate.push(conv);
				} else if (new Date(conv.updated_at) > new Date(stored.updated_at)) {
					// Timestamp changed - needs update
					toUpdate.push(conv);
				}
			}
		}

		console.log(`Need to update ${toUpdate.length} conversations`);
		return toUpdate;
	}

	async function syncConversationsIndividually(progressCallback, toUpdate) {
		const orgId = getOrgId();

		if (toUpdate.length === 0) {
			progressCallback('All conversations up to date!');
			return;
		}

		// Split into 2 chunks for parallel processing
		const chunk1 = toUpdate.filter((_, i) => i % 2 === 0);
		const chunk2 = toUpdate.filter((_, i) => i % 2 === 1);

		let completed = 0;
		const delayMs = Math.min(1000, 100 + toUpdate.length); // Dynamic delay based on count
		console.log(`Using ${delayMs}ms delay for ${toUpdate.length} conversations`);

		async function processChunk(chunk) {
			for (let i = 0; i < chunk.length; i++) {
				const conv = chunk[i];

				try {
					const conversation = new ClaudeConversation(orgId, conv.uuid);
					await conversation.getData(true);

					const messages = conversation.conversationData.chat_messages || [];
					await searchDB.setMessages(conv.uuid, messages);

					completed++;
					progressCallback(`Updating ${completed} of ${toUpdate.length} conversations...`);

					console.log(`Updated conversation: ${conv.name} (${messages.length} messages)`);
				} catch (error) {
					console.error(`Failed to update conversation ${conv.uuid}:`, error);
					completed++;
				}

				// Rate limit between requests
				if (i < chunk.length - 1) {
					await new Promise(resolve => setTimeout(resolve, delayMs));
				}
			}
		}

		await Promise.all([
			processChunk(chunk1),
			processChunk(chunk2)
		]);

		progressCallback('Sync complete!');
	}

	async function triggerSync() {
		const toUpdate = await getConversationsToUpdate();
		for (const conv of toUpdate) {
			await searchDB.setMetadata(conv);
		}

		const loadingModal = createLoadingModal('Initializing sync...');
		if (toUpdate.length >= 5) {
			loadingModal.show();	// Don't show for small updates. They just happen silently.
		}

		try {
			// Check conversation count
			loadingModal.setContent(createLoadingContent('Checking what needs syncing...'));

			if (toUpdate.length >= 300) {
				// Use GDPR export for efficiency
				loadingModal.setContent(createLoadingContent(`Preparing to sync ${toUpdate.length} conversations...`));
				await new Promise(resolve => setTimeout(resolve, 2000)); // Let them read it

				try {
					await syncConversationsViaExport(loadingModal);
				} catch (error) {
					console.error('GDPR export failed:', error);
					loadingModal.destroy();

					// Ask user if they want to fallback
					const fallbackModal = new ClaudeModal(
						'Export Failed',
						`The data export failed: ${error.message}\n\nWould you like to fall back to standard sync? This will take longer but should work reliably.`
					);

					let shouldFallback = false;

					fallbackModal.addCancel('Cancel');
					fallbackModal.addConfirm('Use Standard Sync', () => {
						shouldFallback = true;
					});

					fallbackModal.show();

					// Wait for modal to be dismissed
					await new Promise(resolve => {
						const checkClosed = setInterval(() => {
							if (!fallbackModal.isVisible) {
								clearInterval(checkClosed);
								resolve();
							}
						}, 100);
					});

					if (shouldFallback) {
						const newLoadingModal = createLoadingModal('Starting standard sync...');
						newLoadingModal.show();

						await syncConversationsIndividually((status) => {
							newLoadingModal.setContent(createLoadingContent(status));
						}, toUpdate);

						newLoadingModal.destroy();
					} else {
						// User cancelled
						return;
					}
				}
			} else {
				// Use incremental sync for small amounts of conversations
				await syncConversationsIndividually((status) => {
					loadingModal.setContent(createLoadingContent(status));
				}, toUpdate);


			}

		} catch (error) {
			console.error('Sync failed:', error);

			const errorModal = new ClaudeModal('Sync Failed', `Failed to sync conversations: ${error.message}`);
			errorModal.addConfirm('OK');
			errorModal.show();
			throw error;
		} finally {
			loadingModal.destroy();
		}
	}

	// ======== GDPR EXPORT ========
	let gdprLoadingModal = null;
	let gdprTotalConversations = 0;
	let gdprProcessedConversations = 0;
	let gdprBatchQueue = [];
	let gdprProcessing = false;

	chrome.runtime.onMessage.addListener(async (message) => {
		if (message.type === 'GDPR_BATCH') {
			// Add to queue
			gdprBatchQueue.push(message);
			gdprTotalConversations = message.total;

			// Start processing if not already
			if (!gdprProcessing) {
				processBatchQueue();
			}
		}
	});

	async function processBatchQueue() {
		gdprProcessing = true;

		while (gdprBatchQueue.length > 0) {
			const message = gdprBatchQueue.shift();

			for (const conv of message.batch) {
				try {
					const metadata = await searchDB.getMetadata(conv.uuid);
					if (metadata) {
						await searchDB.setMessages(conv.uuid, conv.chat_messages);
					}

					gdprProcessedConversations++;
				} catch (error) {
					console.error(`[GDPR Export] Failed to load conversation ${conv.uuid}:`, error);
					gdprProcessedConversations++;
				}
			}

			console.log(`[GDPR Export] Processed batch of ${message.batch.length}, total processed: ${gdprProcessedConversations}/${gdprTotalConversations}`);

			if (gdprLoadingModal) {
				gdprLoadingModal.setContent(createLoadingContent(
					`Loading ${gdprProcessedConversations} of ${gdprTotalConversations} conversations...`
				));
			}

			if (gdprProcessedConversations >= gdprTotalConversations) {
				console.log('[GDPR Export] All conversations processed');
				if (gdprLoadingModal) {
					gdprLoadingModal.destroy();
					gdprLoadingModal = null;
				}
				gdprProcessedConversations = 0;
				gdprTotalConversations = 0;
			}
		}

		gdprProcessing = false;
	}


	async function syncConversationsViaExport(loadingModal) {
		const orgId = getOrgId();

		console.log('[GDPR Export] Starting export sync for conversations');

		// Phase 1: Request export
		loadingModal.setContent(createLoadingContent(
			'Requesting data export...'
		));

		console.log('[GDPR Export] Requesting export from API...');
		const exportResponse = await fetch(`/api/organizations/${orgId}/export_data`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});

		if (!exportResponse.ok) {
			const errorText = await exportResponse.text();
			console.error('[GDPR Export] Export request failed:', exportResponse.status, errorText);
			throw new Error(`Export request failed: ${exportResponse.status}`);
		}

		const exportData = await exportResponse.json();
		const nonce = exportData.nonce;
		console.log('[GDPR Export] Export requested, nonce:', nonce);

		// Phase 2: Poll for completion
		const MAX_POLL_ATTEMPTS = 12; // 6 minutes at 30s intervals
		const POLL_INTERVAL_MS = 30000; // 30 seconds

		let storageUrl = null;

		for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
			loadingModal.setContent(createLoadingContent(
				`Waiting for export to complete...\n(Attempt ${attempt}/${MAX_POLL_ATTEMPTS})`
			));

			console.log(`[GDPR Export] Polling attempt ${attempt}/${MAX_POLL_ATTEMPTS}...`);

			const downloadPageUrl = `https://claude.ai/export/${orgId}/download/${nonce}`;
			console.log('[GDPR Export] Checking:', downloadPageUrl);

			try {
				const pollResponse = await fetch(downloadPageUrl);
				console.log('[GDPR Export] Poll response status:', pollResponse.status);

				if (pollResponse.status === 200) {
					const html = await pollResponse.text();
					console.log('[GDPR Export] Got HTML response, length:', html.length);

					// Extract storage URL from the HTML
					const urlMatch = html.match(/https:\/\/storage\.googleapis\.com\/user-data-export-production\/[^"]+/);

					if (urlMatch) {
						storageUrl = urlMatch[0].replace(/\\u0026/g, '&');
						console.log('[GDPR Export] Found storage URL:', storageUrl.substring(0, 100) + '...');
						break;
					} else {
						console.log('[GDPR Export] Storage URL not in page yet, export still processing...');
					}
				} else {
					console.warn('[GDPR Export] Unexpected response status:', pollResponse.status);
				}
			} catch (error) {
				console.warn(`[GDPR Export] Poll attempt ${attempt} failed:`, error.message);
				// Continue to next attempt
			}

			// Wait before next attempt (except on last attempt)
			if (attempt < MAX_POLL_ATTEMPTS) {
				await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
			}
		}

		if (!storageUrl) {
			console.error('[GDPR Export] Export did not complete within timeout');
			throw new Error('Export timed out after 6 minutes');
		}

		// Phase 3: Request download from background
		console.log('[GDPR Export] Requesting download from background script...');
		loadingModal.setContent(createLoadingContent('Downloading and processing export...'));

		gdprLoadingModal = createLoadingModal('Importing...');;
		const downloadResult = await new Promise((resolve) => {
			chrome.runtime.sendMessage({
				type: 'DOWNLOAD_GDPR_EXPORT',
				url: storageUrl
			}, resolve);
		});

		if (!downloadResult.success) {
			gdprLoadingModal = null;
			gdprLoadingModal.destroy();
			throw new Error(`Download failed: ${downloadResult.error}`);
		}

		console.log('[GDPR Export] Processing', downloadResult.totalCount, 'conversations...');
		gdprLoadingModal.show();
	}

	function transformGDPRToMetadata(gdprConv) {
		return {
			uuid: gdprConv.uuid,
			name: gdprConv.name,
			created_at: gdprConv.created_at,
			updated_at: gdprConv.updated_at,
			summary: gdprConv.summary || "",
			model: null,
			settings: {},
			is_starred: false,
			is_temporary: false,
			project_uuid: null,
			current_leaf_message_uuid: null,
			user_uuid: null,
			project: null
		};
	}

	// ======== SEARCH INTERCEPT HANDLER ========
	let isTextSearchEnabled = sessionStorage.getItem('text_search_enabled') === 'true';

	window.addEventListener('message', async (event) => {
		if (event.source !== window) return;
		if (event.data.type !== 'SEARCH_INTERCEPT') return;

		const { messageId, query, url } = event.data;
		console.log('[Search Handler] Received intercept request:', query);

		// If text search is not enabled, don't intercept
		if (!isTextSearchEnabled) {
			console.log('[Search Handler] Text search disabled, not intercepting');
			window.postMessage({
				type: 'SEARCH_RESPONSE',
				messageId,
				intercept: false
			}, '*');
			return;
		}

		try {
			// Search all conversations
			const results = await searchAllConversations(query);

			console.log('[Search Handler] Found', results.length, 'matching conversations');

			window.postMessage({
				type: 'SEARCH_RESPONSE',
				messageId,
				intercept: true,
				results: results
			}, '*');

		} catch (error) {
			console.error('[Search Handler] Search failed:', error);
			window.postMessage({
				type: 'SEARCH_RESPONSE',
				messageId,
				intercept: false
			}, '*');
		}
	});

	function createLoadingContent(text) {
		const div = document.createElement('div');
		div.className = 'flex items-start gap-3'; // Changed from items-center to items-start

		// Split on newlines and create proper line breaks
		const lines = text.split('\n');
		const textContent = document.createElement('div');
		textContent.className = 'text-text-200';

		lines.forEach((line, index) => {
			const span = document.createElement('span');
			span.textContent = line;
			textContent.appendChild(span);
			if (index < lines.length - 1) {
				textContent.appendChild(document.createElement('br'));
			}
		});

		div.innerHTML = `
		<div class="claude-modal-spinner rounded-full h-5 w-5 border-2 border-border-300 flex-shrink-0" style="border-top-color: #2c84db"></div>
	`;
		div.appendChild(textContent);

		return div;
	}



	// ======== SEARCH FUNCTION ========
	function searchMessages(query, conversation) {
		if (!query || query.trim() === '') {
			return [];
		}

		const lowerQuery = query.toLowerCase();
		const results = [];
		const messages = conversation.conversationData.chat_messages || [];

		// Build message map for easy lookup
		const messageMap = new Map();
		for (const message of messages) {
			messageMap.set(message.uuid, message);
		}

		// Search through messages
		for (let index = 0; index < messages.length; index++) {
			const message = messages[index];
			const text = ClaudeConversation.extractMessageText(message);
			const lowerText = text.toLowerCase();
			const matchIndex = lowerText.indexOf(lowerQuery);

			if (matchIndex !== -1) {
				// Extract ~100 chars centered on match
				const contextChars = 50;
				const startIndex = Math.max(0, matchIndex - contextChars);
				const endIndex = Math.min(text.length, matchIndex + query.length + contextChars);

				let matchedText = text.substring(startIndex, endIndex);
				if (startIndex > 0) matchedText = '...' + matchedText;
				if (endIndex < text.length) matchedText = matchedText + '...';

				// Get prev and next messages by parent/child relationship
				const prevMessage = messageMap.get(message.parent_message_uuid);
				const nextMessage = Array.from(messageMap.values()).find(
					m => m.parent_message_uuid === message.uuid
				);

				// Calculate position (messages ago from current leaf)
				const currentLeafId = conversation.conversationData.current_leaf_message_uuid;
				let position = 0;
				let tempId = currentLeafId;
				while (tempId && tempId !== message.uuid) {
					position++;
					const tempMsg = messageMap.get(tempId);
					tempId = tempMsg?.parent_message_uuid;
				}

				results.push({
					matched_text: matchedText,
					full_message_text: text,
					prev_message_text: prevMessage ? ClaudeConversation.extractMessageText(prevMessage) : null,
					prev_message_role: prevMessage ? prevMessage.sender : null,
					next_message_text: nextMessage ? ClaudeConversation.extractMessageText(nextMessage) : null,
					next_message_role: nextMessage ? nextMessage.sender : null,
					matched_message_id: message.uuid,
					role: message.sender,
					position: position,
					timestamp: message.created_at
				});
			}
		}

		return results;
	}

	async function searchAllConversations(query) {
		if (!query || query.trim() === '') {
			return [];
		}

		const matchedConversations = [];
		const allMetadata = await searchDB.getAllMetadata();

		for (const metadata of allMetadata) {
			try {
				const messages = await searchDB.getMessages(metadata.uuid);
				if (!messages) continue;

				// Create a minimal conversation object for searchMessages
				const fakeConversation = {
					conversationData: {
						chat_messages: messages,
						current_leaf_message_uuid: messages[messages.length - 1]?.uuid || '00000000-0000-4000-8000-000000000000'
					}
				};

				// Reuse existing search logic
				const results = searchMessages(query, fakeConversation);

				if (results.length > 0) {
					const result = { ...metadata };
					result.name = `${metadata.name} (${results.length} match${results.length > 1 ? 'es' : ''})`;
					matchedConversations.push(result);
				}

			} catch (error) {
				console.error(`Failed to search conversation ${metadata.uuid}:`, error);
			}
		}

		// Sort by updated_at (most recent first)
		matchedConversations.sort((a, b) =>
			new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
		);

		return matchedConversations;
	}

	// ======== CONTEXT MODAL ========
	function showContextModal(result, query, conversation) {
		const contentDiv = document.createElement('div');

		// Scrollable messages container
		const messagesContainer = document.createElement('div');
		messagesContainer.className = 'space-y-4 max-h-[60vh] overflow-y-auto pr-2';

		// Helper to create a message block
		function createMessageBlock(text, role, label, isMatched = false) {
			if (!text) return null;

			const block = document.createElement('div');

			const header = document.createElement('div');
			header.className = 'text-sm text-text-200 mb-2';
			const roleIcon = role === 'human' ? '👤' : '🤖';
			const roleName = role === 'human' ? 'User' : 'Claude';
			header.textContent = `${roleIcon} ${label}`;
			block.appendChild(header);

			const textBox = document.createElement('div');
			textBox.className = 'p-3 rounded bg-bg-200 border border-border-300';

			if (isMatched && query) {
				// Highlight the match
				const lowerText = text.toLowerCase();
				const lowerQuery = query.toLowerCase();
				const matchIndex = lowerText.indexOf(lowerQuery);

				if (matchIndex !== -1) {
					const before = text.substring(0, matchIndex);
					const match = text.substring(matchIndex, matchIndex + query.length);
					const after = text.substring(matchIndex + query.length);

					textBox.innerHTML = `${before}<strong class="bg-yellow-200 dark:bg-yellow-800">${match}</strong>${after}`;
				} else {
					textBox.textContent = text;
				}
			} else {
				textBox.textContent = text;
			}

			block.appendChild(textBox);
			return block;
		}

		// Add previous message
		if (result.prev_message_text) {
			const prevBlock = createMessageBlock(
				result.prev_message_text,
				result.prev_message_role,
				'Previous Message',
				false
			);
			if (prevBlock) messagesContainer.appendChild(prevBlock);
		}

		// Add matched message
		const matchedBlock = createMessageBlock(
			result.full_message_text,
			result.role,
			`Matched Message (${result.position} messages ago)`,
			true
		);
		if (matchedBlock) messagesContainer.appendChild(matchedBlock);

		// Add next message
		if (result.next_message_text) {
			const nextBlock = createMessageBlock(
				result.next_message_text,
				result.next_message_role,
				'Next Message',
				false
			);
			if (nextBlock) messagesContainer.appendChild(nextBlock);
		}

		contentDiv.appendChild(messagesContainer);

		const modal = new ClaudeModal('Message Context', contentDiv);

		modal.addCancel('Cancel');
		modal.addConfirm('Go to Message', async () => {
			// Remove the display ellipses before storing
			const textToStore = result.matched_text.replace(/^\.\.\./, '').replace(/\.\.\.$/, '');
			const searchSnippet = simplifyText(textToStore);
			console.log('Storing text to find:', searchSnippet);
			sessionStorage.setItem('text_to_find', searchSnippet);

			const longestLeaf = conversation.findLongestLeaf(result.matched_message_id);
			await conversation.setCurrentLeaf(longestLeaf.leafId);
			window.location.reload();
		});

		// Make context modal larger
		modal.modal.classList.remove('max-w-md');
		modal.modal.classList.add('max-w-2xl', 'w-[90vw]');

		modal.show();
	}

	// ======== AUTO-OPEN SEARCH ========
	// At the top level
	let isNewConversation = true;

	function checkForAutoOpenSearch() {
		const conversationId = getConversationId();

		if (!conversationId) {
			// Not in a chat, reset flag
			isNewConversation = true;
			return;
		}

		// In a chat - only auto-open if we just navigated here
		if (!isNewConversation) {
			return;
		}

		console.log('[Auto-open] Current conversation ID:', conversationId);

		const queriesJson = localStorage.getItem('global_search_queries');
		console.log('[Auto-open] Queries from storage:', queriesJson);

		const queries = JSON.parse(queriesJson || '{}');
		const query = queries[conversationId];

		console.log('[Auto-open] Query for this conversation:', query);

		if (!query) {
			// No query for this conversation, mark as processed
			isNewConversation = false;
			return;
		}

		console.log('Auto-open search detected for query:', query);

		const searchButton = document.querySelector('.search-button');
		console.log('[Auto-open] Search button found:', !!searchButton);

		if (searchButton) {
			console.log('Search button found, opening modal directly');

			// Remove just this conversation's entry
			delete queries[conversationId];
			localStorage.setItem('global_search_queries', JSON.stringify(queries));

			showSearchModal(query);

			// NOW mark as not new, after successful open
			isNewConversation = false;
		}

		// If button not found yet, keep isNewConversation=true so we keep checking
	}

	// ======== MAIN SEARCH MODAL ========
	async function showSearchModal(autoQuery = null) {
		// Show loading modal
		const loadingModal = createLoadingModal('Loading conversation...');
		loadingModal.show();

		// Fetch conversation data
		let conversation;
		try {
			const conversationId = getConversationId();
			if (!conversationId) {
				throw new Error('Not in a conversation');
			}

			const orgId = getOrgId();
			conversation = new ClaudeConversation(orgId, conversationId);
			await conversation.getData(true);
		} catch (error) {
			console.error('Failed to fetch conversation:', error);
			loadingModal.destroy();

			// Show error modal
			const errorModal = new ClaudeModal('Error', 'Failed to load conversation data.');
			errorModal.addConfirm('OK');
			errorModal.show();
			return;
		}

		// Destroy loading modal
		loadingModal.destroy();

		// Build the search UI
		const contentDiv = document.createElement('div');

		// Go to Latest / Go to Longest buttons row
		const topButtonsRow = document.createElement('div');
		topButtonsRow.className = CLAUDE_CLASSES.FLEX_GAP_2 + ' mb-4';

		const latestBtn = createClaudeButton('Go to Latest', 'secondary', async () => {
			let latestMessage = null;
			let latestTimestamp = 0;

			for (const msg of conversation.conversationData.chat_messages) {
				const timestamp = new Date(msg.created_at).getTime();
				if (timestamp > latestTimestamp) {
					latestTimestamp = timestamp;
					latestMessage = msg;
				}
			}

			if (latestMessage) {
				await conversation.setCurrentLeaf(latestMessage.uuid);
				window.location.reload();
			}
		});

		const longestBtn = createClaudeButton('Go to Longest', 'secondary', async () => {
			const rootId = "00000000-0000-4000-8000-000000000000";
			const longestLeaf = conversation.findLongestLeaf(rootId);
			await conversation.setCurrentLeaf(longestLeaf.leafId);
			window.location.reload();
		});
		longestBtn.classList.add('w-full');
		latestBtn.classList.add('w-full');

		topButtonsRow.appendChild(latestBtn);
		topButtonsRow.appendChild(longestBtn);
		contentDiv.appendChild(topButtonsRow);

		// Search input row
		const searchRow = document.createElement('div');
		searchRow.className = CLAUDE_CLASSES.FLEX_GAP_2 + ' mb-4';

		const searchInput = createClaudeInput({
			type: 'text',
			placeholder: 'Search messages...',
		});
		searchInput.className += ' flex-1';

		const searchBtn = createClaudeButton('Search', 'primary');

		searchRow.appendChild(searchInput);
		searchRow.appendChild(searchBtn);
		contentDiv.appendChild(searchRow);

		// Results container
		const resultsContainer = document.createElement('div');
		resultsContainer.className = CLAUDE_CLASSES.LIST_CONTAINER
		resultsContainer.style.maxHeight = '32rem';

		contentDiv.appendChild(resultsContainer);

		// Search function
		const performSearch = () => {
			const query = searchInput.value.trim();
			resultsContainer.innerHTML = '';

			if (!query) {
				return;
			}

			const results = searchMessages(query, conversation);

			if (results.length === 0) {
				const noResults = document.createElement('div');
				noResults.className = 'text-center text-text-400 py-8';
				noResults.textContent = `No matches found for "${query}"`;
				resultsContainer.appendChild(noResults);
				return;
			}

			// Sort results by timestamp (most recent first)
			results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

			// Display results
			results.forEach(result => {
				const resultItem = document.createElement('div');
				resultItem.className = CLAUDE_CLASSES.LIST_ITEM;

				const header = document.createElement('div');
				header.className = 'text-sm text-text-200 mb-1';
				const roleIcon = result.role === 'human' ? '👤' : '🤖';
				const roleName = result.role === 'human' ? 'User' : 'Claude';
				const relativeTime = getRelativeTime(result.timestamp);
				header.textContent = `${roleIcon} ${roleName} (${result.position} messages ago · ${relativeTime})`;

				const matchText = document.createElement('div');
				matchText.className = 'text-text-100';

				// Highlight the match in the preview
				const lowerMatched = result.matched_text.toLowerCase();
				const lowerQuery = query.toLowerCase();
				const matchIndex = lowerMatched.indexOf(lowerQuery);

				if (matchIndex !== -1) {
					const before = result.matched_text.substring(0, matchIndex);
					const match = result.matched_text.substring(matchIndex, matchIndex + query.length);
					const after = result.matched_text.substring(matchIndex + query.length);

					matchText.innerHTML = `${before}<strong class="bg-yellow-200 dark:bg-yellow-800">${match}</strong>${after}`;
				} else {
					matchText.textContent = result.matched_text;
				}

				resultItem.appendChild(header);
				resultItem.appendChild(matchText);

				resultItem.onclick = () => {
					showContextModal(result, query, conversation);
				};

				resultsContainer.appendChild(resultItem);
			});
		};

		// Wire up search button and Enter key
		searchBtn.onclick = performSearch;
		searchInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				performSearch();
			}
		});

		// Create and show the search modal
		const modal = new ClaudeModal('Search Conversation', contentDiv);
		modal.addCancel('Close');

		// Override the max-width
		modal.modal.classList.remove('max-w-md');
		modal.modal.classList.add('max-w-xl');

		modal.show();

		// Focus the search input
		setTimeout(() => searchInput.focus(), 100);

		// If auto-open, pre-populate and run search
		if (autoQuery) {
			searchInput.value = autoQuery;
			performSearch();
		}
	}
	// ======== BUTTON CREATION ========
	function createSearchButton() {
		const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="11" cy="11" r="8"></circle>
			<path d="m21 21-4.35-4.35"></path>
		</svg>`;

		const button = createClaudeButton(svgContent, 'icon', () => showSearchModal());
		return button;
	}

	// ======== INITIALIZATION ========
	function scrollToStoredText() {
		const textToFind = sessionStorage.getItem('text_to_find');
		console.log('scrollToStoredText called, textToFind:', textToFind);
		if (!textToFind) return;

		const maxRetries = 20;
		const retryDelay = 500;
		let attempts = 0;

		function attemptScroll() {
			attempts++;
			console.log(`Attempt ${attempts} to find text...`);
			console.log('Looking for:', textToFind);

			const messages = document.querySelectorAll('.font-claude-response, .\\!font-claude-response, .font-user-message, .\\!font-user-message');
			console.log('Found', messages.length, 'message elements');

			for (const node of messages) {
				// Get only the actual message content from p and pre tags
				const contentElements = node.querySelectorAll('p, pre');
				const nodeText = Array.from(contentElements)
					.map(el => el.textContent)
					.join(' ');
				const simplifiedText = simplifyText(nodeText);
				if (simplifiedText.includes("complexity")) console.log(simplifiedText)

				if (simplifiedText.includes(textToFind) || fuzzyMatch(textToFind, simplifiedText)) {
					console.log('FOUND IT!');
					sessionStorage.removeItem('text_to_find');

					node.scrollIntoView({
						behavior: 'smooth',
						block: 'center'
					});

					node.style.transition = 'background-color 0.3s';
					node.style.backgroundColor = '#2c84db4d';
					setTimeout(() => {
						node.style.backgroundColor = '';
					}, 4000);

					return true;
				}
			}

			console.log('Not found in this attempt');
			if (attempts < maxRetries) {
				setTimeout(attemptScroll, retryDelay);
			} else {
				console.log('Giving up after', maxRetries, 'attempts');
				sessionStorage.removeItem('text_to_find');
			}
		}

		setTimeout(attemptScroll, 1000);
	}

	//#region Global Search Toggle
	function addGlobalSearchToggle() {
		// Only on recents page
		if (!window.location.pathname.includes('/recents')) {
			return;
		}

		// Find the container with "X chats with Claude"
		const containers = document.querySelectorAll('.flex.items-center.z-header.h-12');
		let targetContainer = null;

		for (const container of containers) {
			if (container.textContent.includes('chats with Claude')) {
				targetContainer = container;
				break;
			}
		}

		if (!targetContainer) return;

		// Check if toggle already exists
		if (targetContainer.querySelector('.global-search-toggle')) {
			return;
		}

		// Add justify-between if not present
		if (!targetContainer.classList.contains('justify-between')) {
			targetContainer.classList.add('justify-between');
		}

		// Create toggle container
		const toggleContainer = document.createElement('div');
		toggleContainer.className = 'flex items-center gap-2 global-search-toggle';

		// Labels
		const titleLabel = document.createElement('span');
		titleLabel.className = 'text-text-500 text-sm select-none';
		titleLabel.textContent = 'Title Search';

		const textLabel = document.createElement('span');
		textLabel.className = 'text-text-500 text-sm select-none';
		textLabel.textContent = 'Text Search';

		// Create toggle (always defaults to false = title search)
		const isTextSearch = sessionStorage.getItem('text_search_enabled') === 'true';
		const toggle = createClaudeToggle('', isTextSearch);

		if (isTextSearch) {
			triggerSync();
		}

		// Update state on change
		toggle.input.addEventListener('change', (e) => {
			const mode = e.target.checked ? 'text' : 'title';
			console.log('Search mode changed to:', mode);

			if (mode === 'text') {
				sessionStorage.setItem('text_search_enabled', 'true');
			} else {
				sessionStorage.removeItem('text_search_enabled');
			}
			window.location.reload();
		});

		// Assemble
		toggleContainer.appendChild(titleLabel);
		toggleContainer.appendChild(toggle.container);
		toggleContainer.appendChild(textLabel);

		// Add to page
		targetContainer.appendChild(toggleContainer);
	}
	//#endregion

	function initialize() {
		// Existing scroll check
		setTimeout(scrollToStoredText, 1000);

		// Add search button to top right
		setInterval(() => {
			tryAddTopRightButton("search-button", createSearchButton, 'Search Conversation');
		}, 1000);

		// Add global search toggle on recents page
		setInterval(() => {
			addGlobalSearchToggle();
		}, 1000);

		// Check for auto-open search on chat pages (delayed start)
		setTimeout(() => {
			setInterval(() => {
				if (window.location.pathname.includes('/chat/')) {
					checkForAutoOpenSearch();
				}
			}, 1000);
		}, 5000);
	}

	// Wait for DOM to be ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		initialize();
	}
})();