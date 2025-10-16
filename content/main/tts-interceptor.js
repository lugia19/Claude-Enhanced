// tts-interceptor.js
(function () {
	'use strict';

	const pendingRequests = new Map(); // conversationId -> timestamp

	// Override clipboard API
	const originalWrite = navigator.clipboard.write;
	navigator.clipboard.write = async (data) => {
		// Extract text from clipboard data
		let capturedText = null;
		try {
			const item = data[0];
			if (item && item.types.includes('text/plain')) {
				const blob = await item.getType('text/plain');
				capturedText = await blob.text();
			}
		} catch (error) {
			console.error('Error extracting clipboard text:', error);
		}

		if (capturedText) {
			// Ask ISOLATED script if we should intercept this copy
			const shouldIntercept = await new Promise((resolve) => {
				const requestId = Math.random().toString(36).substr(2, 9);

				const listener = (event) => {
					if (event.data.type === 'tts-clipboard-response' &&
						event.data.requestId === requestId) {
						window.removeEventListener('message', listener);
						resolve(event.data.shouldIntercept);
					}
				};

				window.addEventListener('message', listener);

				window.postMessage({
					type: 'tts-clipboard-request',
					text: capturedText,
					requestId: requestId
				}, '*');

				// Timeout after 50ms - default to allowing copy
				setTimeout(() => {
					window.removeEventListener('message', listener);
					resolve(false);
				}, 50);
			});

			if (shouldIntercept) {
				// Intercept - don't actually copy to clipboard
				return Promise.resolve();
			}
		}

		// Normal copy operation
		return originalWrite.call(navigator.clipboard, data);
	};

	const originalFetch = window.fetch;
	window.fetch = async (...args) => {
		const [input, config] = args;

		let url = undefined;
		if (input instanceof URL) {
			url = input.href;
		} else if (typeof input === 'string') {
			url = input;
		} else if (input instanceof Request) {
			url = input.url;
		}

		// Track completion requests
		if (url && (url.includes('/completion') || url.includes('/retry_completion')) && config?.method === 'POST') {
			const urlParts = url.split('/');
			const conversationId = urlParts[urlParts.indexOf('chat_conversations') + 1];
			pendingRequests.set(conversationId, Date.now());
		}

		const response = await originalFetch(...args);

		// Check for conversation updates
		if (url && url.includes('/chat_conversations/') &&
			url.includes('tree=True') &&
			config?.method === 'GET') {

			const urlParts = url.split('/');
			const conversationId = urlParts[urlParts.indexOf('chat_conversations') + 1]?.split('?')[0];

			const requestTime = pendingRequests.get(conversationId);
			if (requestTime) {
				// Wait for response to complete
				response.clone().json().then(async (data) => {
					// Check if we have a new message
					const lastMessage = data.chat_messages?.[data.chat_messages.length - 1];
					if (lastMessage && lastMessage.sender === 'assistant') {
						const messageTime = new Date(lastMessage.created_at).getTime();

						// If message is newer than our request, notify for auto-speak
						if (messageTime > requestTime) {
							// Extract text from message content
							let messageText = '';
							for (const content of lastMessage.content) {
								if (content.text) {
									messageText += content.text + '\n';
								}
							}

							if (messageText) {
								window.postMessage({
									type: 'tts-new-message',
									conversationId: conversationId,
									text: messageText
								}, '*');
							}

							pendingRequests.delete(conversationId);
						}
					}
				});
			}
		}

		return response;
	};

	// Handle dialogue analysis requests from ISOLATED world
	window.addEventListener('message', async (event) => {
		if (event.data.type === 'tts-analyze-dialogue-request') {
			const { prompt, requestId } = event.data;

			try {
				const orgId = getOrgId();
				const conversation = new ClaudeConversation(orgId);

				await conversation.create('TTS Actor Analysis', null, null, false);

				const response = await conversation.sendMessageAndWaitForResponse(prompt);

				let responseText = ClaudeConversation.extractMessageText(response);

				// Strip markdown code blocks if present
				responseText = responseText.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();

				await conversation.delete();

				window.postMessage({
					type: 'tts-analyze-dialogue-response',
					requestId: requestId,
					success: true,
					data: responseText
				}, '*');

			} catch (error) {
				console.error('Dialogue analysis failed:', error);
				window.postMessage({
					type: 'tts-analyze-dialogue-response',
					requestId: requestId,
					success: false,
					error: error.message
				}, '*');
			}
		}
	});
})();