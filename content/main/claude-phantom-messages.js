// claude-phantom-messages.js
// Core phantom message infrastructure - must be loaded first
'use strict';

const PHANTOM_PREFIX = 'phantom_messages_';
const OLD_FORK_PREFIX = 'fork_history_'; // Backward compatibility
const PHANTOM_DELIMITER = '===BEGINNING OF IMPORTED/FORKED CONVERSATION===';

// Migrate old fork history to new format
function migrateOldPhantomStorage(conversationId) {
	const oldKey = `${OLD_FORK_PREFIX}${conversationId}`;
	const newKey = `${PHANTOM_PREFIX}${conversationId}`;

	// Check if we already have new format
	if (localStorage.getItem(newKey)) {
		return;
	}

	// Check for old format and migrate
	const oldData = localStorage.getItem(oldKey);
	if (oldData) {
		console.log(`Migrating old fork history for ${conversationId}`);
		localStorage.setItem(newKey, oldData);
	}
}

function storePhantomMessages(conversationId, messages) {
	const key = `${PHANTOM_PREFIX}${conversationId}`;
	localStorage.setItem(key, JSON.stringify(messages));
	console.log(`Stored ${messages.length} phantom messages for ${conversationId}`);
}

function getPhantomMessages(conversationId) {
	// Check for migration first
	migrateOldPhantomStorage(conversationId);

	const key = `${PHANTOM_PREFIX}${conversationId}`;
	const data = localStorage.getItem(key);
	return data ? JSON.parse(data) : null;
}

function clearPhantomMessages(conversationId) {
	const key = `${PHANTOM_PREFIX}${conversationId}`;
	localStorage.removeItem(key);

	// Also clear old format if it exists
	const oldKey = `${OLD_FORK_PREFIX}${conversationId}`;
	localStorage.removeItem(oldKey);
}

function getPhantomDelimiter() {
	return PHANTOM_DELIMITER;
}

// Fetch interceptor - inject phantom messages into conversation data
const originalFetch = window.fetch;
window.fetch = async (...args) => {
	const [input, config] = args;

	// Get URL from various input types
	let url;
	if (input instanceof URL) {
		url = input.href;
	} else if (typeof input === 'string') {
		url = input;
	} else if (input instanceof Request) {
		url = input.url;
	}

	// Check if this is a conversation data request
	if (url &&
		url.includes('/chat_conversations/') &&
		url.includes('rendering_mode=messages') &&
		(!config || config.method === 'GET' || !config.method)) {

		// Extract conversation ID from URL
		const urlParts = url.split('/');
		const conversationIdIndex = urlParts.findIndex(part => part === 'chat_conversations') + 1;
		const conversationId = urlParts[conversationIdIndex]?.split('?')[0];

		if (conversationId) {
			// Fetch the original data
			const response = await originalFetch(...args);
			const originalData = await response.json();

			// Check for phantom messages
			const phantomMessages = getPhantomMessages(conversationId);

			if (phantomMessages && phantomMessages.length > 0) {
				console.log(`Injecting ${phantomMessages.length} phantom messages into conversation ${conversationId}`);
				injectPhantomMessages(originalData, phantomMessages);
			}

			// Return modified response
			return new Response(JSON.stringify(originalData), {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers
			});
		}
	}

	// Pass through for all other requests
	return originalFetch(...args);
};

function injectPhantomMessages(data, phantomMessages) {
	// Find the first assistant message and modify it
	const firstRealAssistantIndex = data.chat_messages.findIndex(
		msg => msg.sender === 'assistant'
	);

	if (firstRealAssistantIndex !== -1) {
		const firstAssistant = data.chat_messages[firstRealAssistantIndex];

		// Modify the text content
		if (firstAssistant.content && firstAssistant.content.length > 0) {
			for (let content of firstAssistant.content) {
				if (content.text) {
					content.text = "I've loaded the conversation history from the attached file. Please continue from here.";
					break;
				}
			}
		}
	}

	// Update parent UUID of first real message to link to last phantom
	const lastPhantom = phantomMessages[phantomMessages.length - 1];
	const firstRealMessage = data.chat_messages[0];
	if (firstRealMessage && lastPhantom) {
		// Add delimiter as first message content
		firstRealMessage.content[0].text = PHANTOM_DELIMITER;
		// Clear any attachments from the delimiter message
		firstRealMessage.files_v2 = [];
		firstRealMessage.files = [];
		// Link to phantom history
		firstRealMessage.parent_message_uuid = lastPhantom.uuid;
	}

	// Prepend phantom messages to the conversation
	data.chat_messages = [...phantomMessages, ...data.chat_messages];
}