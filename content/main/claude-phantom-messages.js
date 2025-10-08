// claude-phantom-messages.js
// Core phantom message infrastructure - must be loaded first
'use strict';

const PHANTOM_PREFIX = 'phantom_messages_';
const OLD_FORK_PREFIX = 'fork_history_'; // Backward compatibility
const PHANTOM_DELIMITER = '===BEGINNING OF REAL CONVERSATION===';

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
		localStorage.setItem(newKey, oldData);
		localStorage.removeItem(oldKey);
		console.log(`Migrated old phantom messages for ${conversationId} to new format`);
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
	const timestamp = new Date().toISOString();

	// Belt and suspenders: ensure all phantom messages have required fields
	phantomMessages = phantomMessages.map(msg => {
		// Ensure message-level fields
		const completeMsg = {
			uuid: msg.uuid || crypto.randomUUID(),
			parent_message_uuid: msg.parent_message_uuid || "00000000-0000-4000-8000-000000000000",
			sender: msg.sender || 'human',
			content: msg.content || [],
			created_at: msg.created_at || timestamp,
			files_v2: msg.files_v2 || [],
			files: msg.files || [],
			attachments: msg.attachments || [],
			sync_sources: msg.sync_sources || []
		};


		// Property order MUST BE MAINTAINED. ELSE IT ALL BREAKS.
		completeMsg.content = completeMsg.content.map(item => ({
			start_timestamp: timestamp,
			stop_timestamp: timestamp,
			type: "text",
			text: "",
			citations: [],
			...item // Original properties override defaults
		}));



		return completeMsg;
	});

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

	// Update parent UUID of ALL root messages to link to last phantom
	const lastPhantom = phantomMessages[phantomMessages.length - 1];
	const rootMessages = data.chat_messages.filter(
		msg => msg.parent_message_uuid === "00000000-0000-4000-8000-000000000000"
	);

	if (rootMessages.length > 0 && lastPhantom) {
		// Link all root messages to phantom history and add delimiter
		rootMessages.forEach(msg => {
			msg.parent_message_uuid = lastPhantom.uuid;

			// Add delimiter to the bottom of the message content
			if (msg.content && msg.content.length > 0) {
				// Append to the last text content item
				const lastContent = msg.content[msg.content.length - 1];
				if (lastContent.text !== undefined) {
					lastContent.text = PHANTOM_DELIMITER + '\n\n' + lastContent.text;
				}
			}
		});
	}

	// Prepend phantom messages to the conversation
	data.chat_messages = [...phantomMessages, ...data.chat_messages];
}