// phantom-storage.js
// IndexedDB storage for phantom messages - ISOLATED world only
(function () {
	'use strict';

	// Separate database just for phantom messages
	const phantomDB = new Dexie('ClaudePhantomMessagesDB');

	phantomDB.version(1).stores({
		phantomMessages: 'conversationId'
	});

	// Message handlers
	window.addEventListener('message', async (event) => {
		if (event.source !== window) return;

		try {
			switch (event.data.type) {
				case 'STORE_PHANTOM_MESSAGES_IDB':
					await phantomDB.phantomMessages.put({
						conversationId: event.data.conversationId,
						messages: event.data.phantomMessages,
						timestamp: Date.now()
					});
					console.log(`[IDB] Stored ${event.data.phantomMessages.length} phantom messages for ${event.data.conversationId}`);

					// Send confirmation
					window.postMessage({
						type: 'PHANTOM_MESSAGES_STORED',
						conversationId: event.data.conversationId
					}, '*');
					break;

				case 'GET_PHANTOM_MESSAGES_IDB':
					const result = await phantomDB.phantomMessages.get(event.data.conversationId);
					window.postMessage({
						type: 'PHANTOM_MESSAGES_RESPONSE',
						conversationId: event.data.conversationId,
						messages: result?.messages || null
					}, '*');
					break;

				case 'CLEAR_PHANTOM_MESSAGES_IDB':
					await phantomDB.phantomMessages.delete(event.data.conversationId);
					console.log(`[IDB] Cleared phantom messages for ${event.data.conversationId}`);

					window.postMessage({
						type: 'PHANTOM_MESSAGES_CLEARED',
						conversationId: event.data.conversationId
					}, '*');
					break;
			}
		} catch (error) {
			console.error('[IDB] Error handling phantom message operation:', error);
			window.postMessage({
				type: 'PHANTOM_MESSAGES_ERROR',
				conversationId: event.data.conversationId,
				error: error.message
			}, '*');
		}
	});

	console.log('[IDB] Phantom message storage initialized');
})();