// claude-phantom-messages.js
// Core phantom message infrastructure - must be loaded first
'use strict';

const PHANTOM_PREFIX = 'phantom_messages_';
const OLD_FORK_PREFIX = 'fork_history_'; // Backward compatibility
const PHANTOM_MARKER = '====PHANTOM_MESSAGE====';

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

	// Check if this is a completion request
	if (url && url.includes('/completion') && config && config.method === 'POST') {
		// Extract conversation ID from URL
		const urlParts = url.split('/');
		const conversationIdIndex = urlParts.findIndex(part => part === 'chat_conversations') + 1;
		const conversationId = urlParts[conversationIdIndex]?.split('?')[0];

		if (conversationId) {
			// Check for phantom messages
			const phantomMessages = getPhantomMessages(conversationId);

			if (phantomMessages && phantomMessages.length > 0) {
				const lastPhantomUuid = phantomMessages[phantomMessages.length - 1].uuid;

				// Parse the request body
				let body;
				try {
					body = JSON.parse(config.body);
				} catch (e) {
					// If we can't parse it, just pass through
					return originalFetch(...args);
				}

				// Check if parent_message_uuid matches last phantom
				if (body.parent_message_uuid === lastPhantomUuid) {
					console.log('Fixing parent_message_uuid from phantom to root for completion request');
					body.parent_message_uuid = "00000000-0000-4000-8000-000000000000";

					// Create new config with modified body
					const newConfig = {
						...config,
						body: JSON.stringify(body)
					};

					return originalFetch(input, newConfig);
				}
			}
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

		// Add phantom marker to the end of each text content
		completeMsg.content.forEach(item => {
			if (item.text !== undefined) {
				item.text = item.text + '\n\n' + PHANTOM_MARKER;
			}
		});

		return completeMsg;
	});


	// Update parent UUID of ALL root messages to link to last phantom
	const lastPhantom = phantomMessages[phantomMessages.length - 1];
	const rootMessages = data.chat_messages.filter(
		msg => msg.parent_message_uuid === "00000000-0000-4000-8000-000000000000"
	);

	if (rootMessages.length > 0 && lastPhantom) {
		// Link all root messages to phantom history and add delimiter
		rootMessages.forEach(msg => {
			msg.parent_message_uuid = lastPhantom.uuid;
		});
	}

	// Prepend phantom messages to the conversation
	data.chat_messages = [...phantomMessages, ...data.chat_messages];
}

// Listen for messages from ISOLATED world
window.addEventListener('message', (event) => {
	if (event.source !== window) return; // Only accept messages from same window

	if (event.data.type === 'STORE_PHANTOM_MESSAGES') {
		const { conversationId, phantomMessages } = event.data;
		storePhantomMessages(conversationId, phantomMessages);
	}
});

// Style phantom messages in the DOM
function stylePhantomMessages() {
	const { allMessages, userMessages } = getUIMessages();

	// Convert to Set for efficient lookups
	const userMessageSet = new Set(userMessages);

	// Process all containers the same way
	allMessages.forEach(container => {


		// Check if this message contains the phantom marker
		const textContent = container.textContent || '';
		const hasMarker = textContent.includes(PHANTOM_MARKER);
		const isMarkedPhantom = container.hasAttribute('data-phantom-styled');

		// If we detect the marker, mark this as a phantom message
		if (hasMarker) {
			container.setAttribute('data-phantom-styled', 'true');
			// Remove the marker from all text nodes
			removeMarkerFromElement(container);
		}

		if (hasMarker || isMarkedPhantom) {
			// Apply styling
			if (container.parentElement && container.parentElement.parentElement) {
				container.parentElement.parentElement.style.filter = 'brightness(0.70)';
			}

			// Hide message controls
			const controls = findMessageControls(container);
			if (controls) {
				controls.style.display = 'none';
			}
		}
	});
}


function removeMarkerFromElement(element) {
	const paragraphs = element.querySelectorAll('p');

	paragraphs.forEach(p => {
		if (p.textContent.includes(PHANTOM_MARKER)) {
			p.textContent = p.textContent.replace(PHANTOM_MARKER, '');

			// If the paragraph is now empty (or only whitespace), remove it
			if (p.textContent.trim() === '') {
				console.log('Removing empty paragraph element');
				p.style.display = 'none';
			}
		}
	});
}

// Run styling check every second
setInterval(stylePhantomMessages, 1000);