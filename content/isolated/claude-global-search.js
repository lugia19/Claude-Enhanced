// claude-search-global.js
(function () {
	'use strict';

	const { searchDB } = window.ClaudeSearchShared;

	// ======== STATE ========
	let isTextSearchEnabled = sessionStorage.getItem('text_search_enabled') === 'true';
	let isFirstSyncOnRecents = true;
	// Poll for navigation away from /recents
	setInterval(() => {
		if (!window.location.pathname.includes('/recents')) {
			isFirstSyncOnRecents = true; // Reset when not on /recents
			sessionStorage.setItem('text_search_enabled', 'false'); // Disable text search when leaving
		}
	}, 500);

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
				toUpdate.push(conv);
			} else {
				// Check if messages exist
				const messages = await searchDB.getMessages(conv.uuid);

				if (!messages) {
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
		const loadingModal = createLoadingModal('Initializing sync...');
		if (isFirstSyncOnRecents) {
			loadingModal.show(); // Show only on first sync when on /recents
			isFirstSyncOnRecents = false;
		}
		const toUpdate = await getConversationsToUpdate();

		for (const conv of toUpdate) {
			await searchDB.setMetadata(conv);
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
					const shouldFallback = await showClaudeConfirm(
						'Export Failed',
						`The data export failed: ${error.message}\n\nWould you like to fall back to standard sync? This will take longer but should work reliably.`
					);

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
			showClaudeAlert('Sync Failed', `An error occurred during sync: ${error.message}`);
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

		gdprLoadingModal = createLoadingModal('Importing...');
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

	// ======== SEARCH FUNCTION ========
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

				// Search through messages for matches
				let matchCount = 0;
				const lowerQuery = query.toLowerCase();

				for (const message of messages) {
					const text = ClaudeConversation.extractMessageText(message);
					const lowerText = text.toLowerCase();

					if (lowerText.includes(lowerQuery)) {
						matchCount++;
					}
				}

				if (matchCount > 0) {
					const result = { ...metadata };
					result.name = `${metadata.name} (${matchCount} match${matchCount > 1 ? 'es' : ''})`;
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

	// ======== GLOBAL SEARCH TOGGLE ========
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

	// ======== INITIALIZATION ========
	function initialize() {
		// Add global search toggle on recents page
		setInterval(() => {
			addGlobalSearchToggle();
		}, 1000);
	}

	// Wait for DOM to be ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		initialize();
	}
})();