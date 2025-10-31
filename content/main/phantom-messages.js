// phantom-messages.js
'use strict';

const PHANTOM_PREFIX = 'phantom_messages_';
const OLD_FORK_PREFIX = 'fork_history_';
const PHANTOM_MARKER = '====PHANTOM_MESSAGE====';

// ==== STORAGE FUNCTIONS (async, use IndexedDB via messages) ====
async function storePhantomMessages(conversationId, messages) {
	console.log(`[Phantom Messages] Storing ${messages.length} messages for conversation ${conversationId} in IndexedDB`);
	return new Promise((resolve) => {
		const handler = (event) => {
			if (event.data.type === 'PHANTOM_MESSAGES_STORED' &&
				event.data.conversationId === conversationId) {
				window.removeEventListener('message', handler);
				console.log(`[Phantom Messages] Stored messages for conversation ${conversationId} successfully`);

				window.postMessage({
					type: 'PHANTOM_MESSAGES_STORED_CONFIRMED',
					conversationId
				}, '*');

				resolve();
			}
		};

		window.addEventListener('message', handler);

		window.postMessage({
			type: 'STORE_PHANTOM_MESSAGES_IDB',
			conversationId,
			phantomMessages: messages
		}, '*');
	});
}

async function getPhantomMessages(conversationId) {
	// Check localStorage first and migrate if found
	const oldKey = `${OLD_FORK_PREFIX}${conversationId}`;
	const newKey = `${PHANTOM_PREFIX}${conversationId}`;

	const localData = localStorage.getItem(newKey) || localStorage.getItem(oldKey);
	if (localData) {
		console.log(`[Migration] Migrating ${conversationId} to IndexedDB`);
		const messages = JSON.parse(localData);
		await storePhantomMessages(conversationId, messages);
		localStorage.removeItem(newKey);
		localStorage.removeItem(oldKey);
		return messages;
	}

	// Get from IndexedDB
	return new Promise((resolve) => {
		const handler = (event) => {
			if (event.data.type === 'PHANTOM_MESSAGES_RESPONSE' &&
				event.data.conversationId === conversationId) {
				window.removeEventListener('message', handler);
				resolve(event.data.messages);
			}
		};

		window.addEventListener('message', handler);
		window.postMessage({
			type: 'GET_PHANTOM_MESSAGES_IDB',
			conversationId
		}, '*');

		setTimeout(() => {
			window.removeEventListener('message', handler);
			resolve(null);
		}, 5000);
	});
}

// Currently unused. But could be relevant later.
async function clearPhantomMessages(conversationId) {
	localStorage.removeItem(`${PHANTOM_PREFIX}${conversationId}`);
	localStorage.removeItem(`${OLD_FORK_PREFIX}${conversationId}`);

	return new Promise((resolve) => {
		const handler = (event) => {
			if (event.data.type === 'PHANTOM_MESSAGES_CLEARED' &&
				event.data.conversationId === conversationId) {
				window.removeEventListener('message', handler);
				resolve();
			}
		};

		window.addEventListener('message', handler);
		window.postMessage({
			type: 'CLEAR_PHANTOM_MESSAGES_IDB',
			conversationId
		}, '*');
	});
}

// ==== FETCH INTERCEPTOR ====
const originalFetch = window.fetch;
window.fetch = async (...args) => {
	const [input, config] = args;

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

		const urlParts = url.split('/');
		const conversationIdIndex = urlParts.findIndex(part => part === 'chat_conversations') + 1;
		const conversationId = urlParts[conversationIdIndex]?.split('?')[0];

		if (conversationId) {
			const response = await originalFetch(...args);
			const originalData = await response.json();

			const phantomMessages = await getPhantomMessages(conversationId);

			if (phantomMessages && phantomMessages.length > 0) {
				injectPhantomMessages(originalData, phantomMessages);
			}

			return new Response(JSON.stringify(originalData), {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers
			});
		}
	}

	// Check if this is a completion request
	if (url && url.includes('/completion') && config && config.method === 'POST') {
		const urlParts = url.split('/');
		const conversationIdIndex = urlParts.findIndex(part => part === 'chat_conversations') + 1;
		const conversationId = urlParts[conversationIdIndex]?.split('?')[0];

		if (conversationId) {
			const phantomMessages = await getPhantomMessages(conversationId);

			if (phantomMessages && phantomMessages.length > 0) {
				const lastPhantomUuid = phantomMessages[phantomMessages.length - 1].uuid;

				let body;
				try {
					body = JSON.parse(config.body);
				} catch (e) {
					return originalFetch(...args);
				}

				if (body.parent_message_uuid === lastPhantomUuid) {
					console.log('Fixing parent_message_uuid from phantom to root for completion request');
					body.parent_message_uuid = "00000000-0000-4000-8000-000000000000";

					const newConfig = {
						...config,
						body: JSON.stringify(body)
					};

					return originalFetch(input, newConfig);
				}
			}
		}
	}

	return originalFetch(...args);
};

function injectPhantomMessages(data, phantomMessages) {
	const timestamp = new Date().toISOString();

	phantomMessages = phantomMessages.map(msg => {
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

		completeMsg.content = completeMsg.content.map(item => ({
			start_timestamp: timestamp,
			stop_timestamp: timestamp,
			type: "text",
			text: "",
			citations: [],
			...item
		}));

		completeMsg.content.forEach(item => {
			if (item.text !== undefined) {
				item.text = item.text + '\n\n' + PHANTOM_MARKER;
			}
		});

		return completeMsg;
	});

	console.log(`Injecting ${phantomMessages.length} phantom messages into conversation`);

	const lastPhantom = phantomMessages[phantomMessages.length - 1];
	const rootMessages = data.chat_messages.filter(
		msg => msg.parent_message_uuid === "00000000-0000-4000-8000-000000000000"
	);

	if (rootMessages.length > 0 && lastPhantom) {
		rootMessages.forEach(msg => {
			msg.parent_message_uuid = lastPhantom.uuid;
		});
	}

	data.chat_messages = [...phantomMessages, ...data.chat_messages];
}

// Listen for messages from ISOLATED world
window.addEventListener('message', (event) => {
	if (event.source !== window) return;

	if (event.data.type === 'STORE_PHANTOM_MESSAGES') {
		const { conversationId, phantomMessages } = event.data;
		storePhantomMessages(conversationId, phantomMessages);
	}
});

// Style phantom messages in the DOM
function stylePhantomMessages() {
	const { allMessages, userMessages } = getUIMessages();
	const userMessageSet = new Set(userMessages);

	allMessages.forEach(container => {
		const textContent = container.textContent || '';
		const hasMarker = textContent.includes(PHANTOM_MARKER);
		const isMarkedPhantom = container.hasAttribute('data-phantom-styled');

		if (hasMarker) {
			container.setAttribute('data-phantom-styled', 'true');
			removeMarkerFromElement(container);
		}

		if (hasMarker || isMarkedPhantom) {
			if (container.parentElement && container.parentElement.parentElement) {
				container.parentElement.parentElement.style.filter = 'brightness(0.70)';
			}

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

			if (p.textContent.trim() === '') {
				p.style.display = 'none';
			}
		}
	});
}

setInterval(stylePhantomMessages, 1000);