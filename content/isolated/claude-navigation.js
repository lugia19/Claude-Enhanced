// claude-navigation.js
(function () {
	'use strict';

	const STORAGE_KEY = 'navigation_bookmarks';

	// ======== STORAGE MANAGEMENT ========
	function getBookmarks(conversationId) {
		const allBookmarks = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
		return allBookmarks[conversationId] || {};
	}

	function saveBookmarks(conversationId, bookmarks) {
		const allBookmarks = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
		allBookmarks[conversationId] = bookmarks;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(allBookmarks));
	}

	function addBookmark(conversationId, name, leafUuid) {
		const bookmarks = getBookmarks(conversationId);
		bookmarks[name] = leafUuid;
		saveBookmarks(conversationId, bookmarks);
	}

	function deleteBookmark(conversationId, name) {
		const bookmarks = getBookmarks(conversationId);
		delete bookmarks[name];
		saveBookmarks(conversationId, bookmarks);
	}

	// ======== API HELPERS ========
	async function getConversation() {
		const conversationId = getConversationId();
		if (!conversationId) {
			throw new Error('Not in a conversation');
		}

		const orgId = getOrgId();
		return new ClaudeConversation(orgId, conversationId);
	}

	// ======== NAME INPUT MODAL ========
	async function showNameInputModal(conversationId, currentLeafId) {
		const name = await showClaudePrompt(
			'Dimark',
			'Bookmark Name:',
			'Enter bookmark name...',
			'',
			(value) => {
				if (!value) {
					return 'Please enter a bookmark name';
				}

				// Check for duplicate names
				const bookmarks = getBookmarks(conversationId);
				if (bookmarks[value]) {
					return 'A bookmark with this name already exists';
				}

				return true;
			}
		);

		addBookmark(conversationId, name, currentLeafId);
		return name;
	}

	// ======== BOOKMARK ITEM ========
	function createBookmarkItem(name, bookmarkUuid, conversationId, conversation, onUpdate) {
		const item = document.createElement('div');
		item.className = CLAUDE_CLASSES.LIST_ITEM + ' flex items-center gap-2';

		// Icon
		const icon = document.createElement('span');
		icon.className = 'text-lg';
		icon.textContent = '📍';
		item.appendChild(icon);

		// Name (clickable area)
		const nameDiv = document.createElement('div');
		nameDiv.className = 'flex-1 text-sm text-text-100 cursor-pointer';
		nameDiv.textContent = name;
		nameDiv.onclick = async () => {
			try {
				// Navigate to the bookmarked leaf
				const longestLeaf = conversation.findLongestLeaf(bookmarkUuid);
				await conversation.setCurrentLeaf(longestLeaf.leafId);
				window.location.reload();
			} catch (error) {
				console.error('Navigation failed:', error);
				showClaudeAlert('Navigation Error', 'Failed to navigate. The bookmark may be invalid.');
			}
		};
		item.appendChild(nameDiv);

		// Delete button
		const deleteBtn = createClaudeButton('×', 'icon');
		deleteBtn.classList.remove('h-9', 'w-9');
		deleteBtn.classList.add('h-7', 'w-7', 'text-lg');
		deleteBtn.onclick = async (e) => {
			e.stopPropagation(); // Prevent triggering navigation
			const confirmed = await showClaudeConfirm('Delete Bookmark', `Are you sure you want to delete the bookmark "${name}"?`);
			if (confirmed) {
				deleteBookmark(conversationId, name);
				item.remove();
				onUpdate();
			}
		};
		item.appendChild(deleteBtn);

		return item;
	}

	// ======== MAIN NAVIGATION MODAL ========
	async function showNavigationModal() {
		const loading = createLoadingModal('Loading conversation data...');
		loading.show();

		let conversation;
		let conversationData;
		try {
			conversation = await getConversation();
			conversationData = await conversation.getData(true);
		} catch (error) {
			console.error('Failed to fetch conversation:', error);
			loading.setTitle('Error');
			loading.setContent('Failed to load conversation data. Please try again.');
			loading.addConfirm('OK');
			return;
		}

		// Close loading modal
		loading.destroy();

		const conversationId = getConversationId();
		const contentDiv = document.createElement('div');

		// Top buttons row
		const topButtonsRow = document.createElement('div');
		topButtonsRow.className = CLAUDE_CLASSES.FLEX_GAP_2 + ' mb-4';

		const latestBtn = createClaudeButton('Go to Latest', 'secondary', async () => {
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
		latestBtn.classList.add('w-full');
		longestBtn.classList.add('w-full');

		topButtonsRow.appendChild(latestBtn);
		topButtonsRow.appendChild(longestBtn);
		contentDiv.appendChild(topButtonsRow);

		// Bookmarks list container
		const bookmarksList = document.createElement('div');
		bookmarksList.className = CLAUDE_CLASSES.LIST_CONTAINER;
		bookmarksList.style.maxHeight = '20rem';

		// Function to update the list
		const updateBookmarksList = () => {
			bookmarksList.innerHTML = '';
			const bookmarks = getBookmarks(conversationId);
			const entries = Object.entries(bookmarks);

			if (entries.length === 0) {
				const emptyMsg = document.createElement('div');
				emptyMsg.className = 'text-center text-text-400 py-8';
				emptyMsg.textContent = 'No bookmarks yet. Add your first bookmark below.';
				bookmarksList.appendChild(emptyMsg);
			} else {
				entries.forEach(([name, bookmarkUuid]) => {
					const item = createBookmarkItem(name, bookmarkUuid, conversationId, conversation, updateBookmarksList);
					bookmarksList.appendChild(item);
				});
			}
		};

		updateBookmarksList();
		contentDiv.appendChild(bookmarksList);

		// Add bookmark button
		const addBtn = createClaudeButton('+ Add Current Position', 'secondary');
		addBtn.onclick = async () => {
			try {
				const currentLeafId = conversationData.current_leaf_message_uuid;
				await showNameInputModal(conversationId, currentLeafId);
				updateBookmarksList();
			} catch (error) {
				// User cancelled, do nothing
			}
		};
		contentDiv.appendChild(addBtn);

		// Create and show modal
		const modal = new ClaudeModal('Navigation', contentDiv);
		modal.addCancel('Close');
		modal.show();
	}

	// ======== BUTTON CREATION ========
	function createNavigationButton() {
		const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
		</svg>`;

		const button = createClaudeButton(svgContent, 'icon', showNavigationModal);

		return button;
	}

	// ======== INITIALIZATION ========
	function initialize() {
		// Add navigation button to top right
		setInterval(() => {
			tryAddTopRightButton("navigation-button", createNavigationButton, 'Navigation');
		}, 1000);
	}

	// Wait for DOM to be ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		initialize();
	}
})();