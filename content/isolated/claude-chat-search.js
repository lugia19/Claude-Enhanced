// claude-search-chat.js
(function () {
	'use strict';

	const { getRelativeTime, simplifyText, fuzzyMatch } = window.ClaudeSearchShared;

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
		resultsContainer.className = CLAUDE_CLASSES.LIST_CONTAINER;
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

	// ======== SCROLL TO TEXT ========
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
				if (simplifiedText.includes("complexity")) console.log(simplifiedText);

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

	// ======== INITIALIZATION ========
	function initialize() {
		// Existing scroll check
		setTimeout(scrollToStoredText, 1000);

		// Add search button to top right
		setInterval(() => {
			tryAddTopRightButton("search-button", createSearchButton, 'Search Conversation');
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