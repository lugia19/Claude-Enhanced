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

	// ======== API AND DATA FETCHING ========
	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
		return match ? match[1] : null;
	}

	async function fetchConversationData() {
		const conversationId = getConversationId();
		if (!conversationId) {
			throw new Error('Not in a conversation');
		}

		const orgId = getOrgId();
		const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`;

		const response = await fetch(url, {
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json'
			}
		});

		if (!response.ok) {
			throw new Error('Failed to fetch conversation');
		}

		return await response.json();
	}

	function extractTextFromMessage(message) {
		let text = '';

		if (message.content && Array.isArray(message.content)) {
			for (const content of message.content) {
				if (content.type === 'text' && content.text) {
					text += content.text + ' ';
				}
			}
		}

		return text.trim();
	}

	// ======== TREE TRAVERSAL ========
	// ======== TREE TRAVERSAL ========
	function findLongestLeaf(messageId, messageMap) {
		// Find all children of this message
		const children = Array.from(messageMap.values()).filter(
			msg => msg.parent_message_uuid === messageId
		);

		// If no children, this is a leaf
		if (children.length === 0) {
			const message = messageMap.get(messageId);
			return {
				leafId: messageId,
				depth: 0,
				timestamp: new Date(message.created_at).getTime()
			};
		}

		// Recursively find longest path through children
		let longestPath = { leafId: null, depth: -1, timestamp: 0 };

		for (const child of children) {
			const result = findLongestLeaf(child.uuid, messageMap);
			const totalDepth = result.depth + 1;

			// Prefer deeper paths, but if equal depth, prefer more recent
			if (totalDepth > longestPath.depth ||
				(totalDepth === longestPath.depth && result.timestamp > longestPath.timestamp)) {
				longestPath = {
					leafId: result.leafId,
					depth: totalDepth,
					timestamp: result.timestamp
				};
			}
		}

		return longestPath;
	}

	// ======== NAVIGATION ========
	async function navigateToLeaf(leafId) {
		const conversationId = getConversationId();
		const orgId = getOrgId();
		const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}/current_leaf_message_uuid`;

		try {
			await fetch(url, {
				method: 'PUT',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ current_leaf_message_uuid: leafId })
			});

			// Reload the page to show the new position
			window.location.reload();
		} catch (error) {
			console.error('Navigation failed:', error);
			alert('Failed to navigate. Please try again.');
		}
	}

	// ======== SEARCH FUNCTION ========
	function searchMessages(query, conversationData) {
		if (!query || query.trim() === '') {
			return [];
		}

		const lowerQuery = query.toLowerCase();
		const results = [];
		const messages = conversationData.chat_messages || [];

		// Build message map for easy lookup
		const messageMap = new Map();
		for (const message of messages) {
			messageMap.set(message.uuid, message);
		}

		// Search through messages
		for (let index = 0; index < messages.length; index++) {
			const message = messages[index];
			const text = extractTextFromMessage(message);
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
				const currentLeafId = conversationData.current_leaf_message_uuid;
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
					prev_message_text: prevMessage ? extractTextFromMessage(prevMessage) : null,
					prev_message_role: prevMessage ? prevMessage.sender : null,
					next_message_text: nextMessage ? extractTextFromMessage(nextMessage) : null,
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
	// ======== CONTEXT MODAL ========
	function showContextModal(result, query, conversationData) {
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
			const roleIcon = role === 'human' ? '📝' : '🤖';
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

		const modal = createClaudeModal({
			title: 'Message Context',
			content: contentDiv,
			confirmText: 'Go to Message',
			cancelText: 'Cancel',
			onCancel: () => {
				// Just close
			},
			onConfirm: () => {
				// Find longest leaf from this message
				const messageMap = new Map();
				for (const msg of conversationData.chat_messages) {
					messageMap.set(msg.uuid, msg);
				}

				const longestLeaf = findLongestLeaf(result.matched_message_id, messageMap);
				navigateToLeaf(longestLeaf.leafId);
			}
		});

		// Make context modal larger
		const modalContainer = modal.querySelector('.bg-bg-100');
		if (modalContainer) {
			modalContainer.classList.remove('max-w-md');
			modalContainer.classList.add('max-w-2xl', 'w-[90vw]');
		}

		document.body.appendChild(modal);
	}

	// ======== MAIN SEARCH MODAL ========
	async function showSearchModal() {
		// Fetch conversation data first
		let conversationData;
		try {
			conversationData = await fetchConversationData();
		} catch (error) {
			console.error('Failed to fetch conversation:', error);
			return;
		}

		// Build the UI
		const contentDiv = document.createElement('div');

		// Go to Latest / Go to Longest buttons row
		const topButtonsRow = document.createElement('div');
		topButtonsRow.className = CLAUDE_CLASSES.FLEX_GAP_2 + ' mb-4';

		const latestBtn = createClaudeButton('Go to Latest', 'secondary', () => {
			// Find the message with the most recent created_at timestamp
			let latestMessage = null;
			let latestTimestamp = 0;

			for (const msg of conversationData.chat_messages) {
				const timestamp = new Date(msg.created_at).getTime();
				if (timestamp > latestTimestamp) {
					latestTimestamp = timestamp;
					latestMessage = msg;
				}
			}

			if (latestMessage) {
				navigateToLeaf(latestMessage.uuid);
			}
		});

		const longestBtn = createClaudeButton('Go to Longest', 'secondary', () => {
			const messageMap = new Map();
			for (const msg of conversationData.chat_messages) {
				messageMap.set(msg.uuid, msg);
			}

			const rootId = "00000000-0000-4000-8000-000000000000";
			const longestLeaf = findLongestLeaf(rootId, messageMap);
			navigateToLeaf(longestLeaf.leafId);
		});

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
		resultsContainer.className = 'max-h-[32rem] overflow-y-auto space-y-2';
		contentDiv.appendChild(resultsContainer);

		// Search function
		const performSearch = () => {
			const query = searchInput.value.trim();
			resultsContainer.innerHTML = '';

			if (!query) {
				return;
			}

			const results = searchMessages(query, conversationData);

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
				resultItem.className = 'p-3 rounded bg-bg-200 border border-border-300 hover:bg-bg-300 cursor-pointer transition-colors';

				const header = document.createElement('div');
				header.className = 'text-sm text-text-200 mb-1';
				const roleIcon = result.role === 'human' ? '📝' : '🤖';
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
					showContextModal(result, query, conversationData);
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

		// Create and show modal
		const modal = createClaudeModal({
			title: 'Search Conversation',
			content: contentDiv,
			cancelText: 'Close',
			onCancel: () => {
				// Just close
			}
		});

		// Override the max-width
		const modalContainer = modal.querySelector('.bg-bg-100');
		if (modalContainer) {
			modalContainer.classList.remove('max-w-md');
			modalContainer.classList.add('max-w-xl');
		}

		document.body.appendChild(modal);
	}

	// ======== BUTTON CREATION ========
	function createSearchButton() {
		const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="11" cy="11" r="8"></circle>
			<path d="m21 21-4.35-4.35"></path>
		</svg>`;

		const button = createClaudeButton(svgContent, 'icon', showSearchModal);
		createClaudeTooltip(button, 'Search Conversation');

		return button;
	}

	// ======== INITIALIZATION ========
	function initialize() {
		// Add spinner CSS once
		const style = document.createElement('style');
		style.id = 'search-spinner-style';
		style.textContent = `
			@keyframes spin {
				from { transform: rotate(0deg); }
				to { transform: rotate(360deg); }
			}
			.animate-spin {
				animation: spin 1s linear infinite;
			}
		`;
		if (!document.querySelector('#search-spinner-style')) {
			document.head.appendChild(style);
		}

		// Add search button to top right
		setInterval(() => {
			tryAddTopRightButton("search-button", createSearchButton);
		}, 1000);
	}

	// Wait for DOM to be ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		initialize();
	}
})();