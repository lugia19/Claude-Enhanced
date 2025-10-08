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
	function showNameInputModal(conversationId, currentLeafId) {
		return new Promise((resolve, reject) => {
			const contentDiv = document.createElement('div');

			const label = document.createElement('label');
			label.className = CLAUDE_CLASSES.LABEL;
			label.textContent = 'Bookmark Name:';
			contentDiv.appendChild(label);

			const input = createClaudeInput({
				type: 'text',
				placeholder: 'Enter bookmark name...',
			});
			contentDiv.appendChild(input);

			const modal = new ClaudeModal('Add Bookmark', contentDiv);
			
			modal.addCancel('Cancel', () => {
				reject(new Error('Cancelled'));
			});
			
			modal.addConfirm('Save', (btn, modal) => {
				const name = input.value.trim();
				if (!name) {
					alert('Please enter a bookmark name');
					return false; // Keep modal open
				}

				// Check for duplicate names
				const bookmarks = getBookmarks(conversationId);
				if (bookmarks[name]) {
					alert('A bookmark with this name already exists');
					return false; // Keep modal open
				}

				addBookmark(conversationId, name, currentLeafId);
				resolve(name);
				return true; // Close modal
			});

			modal.show();

			// Focus the input
			setTimeout(() => input.focus(), 100);

			// Allow Enter key to submit
			input.addEventListener('keypress', (e) => {
				if (e.key === 'Enter') {
					// Click the confirm button (last button added)
					const confirmBtn = modal.buttons[modal.buttons.length - 1];
					if (confirmBtn) confirmBtn.click();
				}
			});
		});
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
				alert('Failed to navigate. The bookmark may be invalid.');
			}
		};
		item.appendChild(nameDiv);

		// Delete button
		const deleteBtn = createClaudeButton('×', 'icon');
		deleteBtn.classList.remove('h-9', 'w-9');
		deleteBtn.classList.add('h-7', 'w-7', 'text-lg');
		deleteBtn.onclick = (e) => {
			e.stopPropagation(); // Prevent triggering navigation
			
			const confirmModal = new ClaudeModal('Delete Bookmark', `Delete bookmark "${name}"?`);
			confirmModal.addCancel('Cancel');
			confirmModal.addConfirm('Delete', () => {
				deleteBookmark(conversationId, name);
				item.remove();
				onUpdate();
			});
			confirmModal.show();
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
		createClaudeTooltip(button, 'Navigation');

		return button;
	}

	// ======== INITIALIZATION ========
	function initialize() {
		// Add navigation button to top right
		setInterval(() => {
			tryAddTopRightButton("navigation-button", createNavigationButton);
		}, 1000);
	}

	// Wait for DOM to be ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		initialize();
	}
})();