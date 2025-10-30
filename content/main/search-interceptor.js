// search-interceptor.js
(function () {
	'use strict';

	const originalFetch = window.fetch;
	const pendingSearches = new Map();
	let messageIdCounter = 0;
	let lastSearchQuery = null; // Track latest search query

	// Listen for responses from ISOLATED
	window.addEventListener('message', (event) => {
		if (event.source !== window) return;
		if (event.data.type !== 'SEARCH_RESPONSE') return;

		const { messageId, intercept, results } = event.data;
		const resolver = pendingSearches.get(messageId);

		if (resolver) {
			resolver({ intercept, results });
			pendingSearches.delete(messageId);
		}
	});

	// Monkeypatch fetch
	window.fetch = async function (...args) {
		const [input, config] = args;

		let url;
		if (input instanceof URL) {
			url = input.href;
		} else if (typeof input === 'string') {
			url = input;
		} else if (input instanceof Request) {
			url = input.url;
		}

		// Check if this is a conversation search request
		if (url && url.includes('/chat_conversations')) {
			const urlObj = new URL(url, window.location.origin);
			const searchQuery = urlObj.searchParams.get('searchQuery');
			lastSearchQuery = searchQuery; // Store the query

			if (searchQuery) {
				console.log('[Search Interceptor] Detected search query:', searchQuery);

				// Ask ISOLATED if we should intercept
				const messageId = messageIdCounter++;

				const responsePromise = new Promise((resolve) => {
					pendingSearches.set(messageId, resolve);

					// Timeout after 30 seconds
					setTimeout(() => {
						if (pendingSearches.has(messageId)) {
							console.warn('[Search Interceptor] Timeout waiting for ISOLATED response');
							resolve({ intercept: false });
							pendingSearches.delete(messageId);
						}
					}, 30000);
				});

				window.postMessage({
					type: 'SEARCH_INTERCEPT',
					messageId,
					query: searchQuery,
					url: url
				}, '*');

				const response = await responsePromise;

				if (response.intercept) {
					console.log('[Search Interceptor] Intercepting with custom results:', response.results.length);

					// Return fake Response with our results
					return new Response(JSON.stringify(response.results), {
						status: 200,
						statusText: 'OK',
						headers: {
							'Content-Type': 'application/json'
						}
					});
				} else {
					console.log('[Search Interceptor] Passing through to original fetch');
				}
			}
		}

		// Not a search request, or ISOLATED said don't intercept - use original fetch
		return originalFetch.apply(this, args);
	};

	// Attach click handlers to conversation links
	function attachClickHandlers() {
		if (!window.location.pathname.includes('/recents')) {
			return;
		}

		if (sessionStorage.getItem('text_search_enabled') !== 'true') {
			return;
		}

		if (!lastSearchQuery) {
			return;
		}

		const conversationLinks = document.querySelectorAll('a[href^="/chat/"]');

		conversationLinks.forEach(link => {
			// Only attach to links that contain our match count pattern
			if (!/\(\d+ match(es)?\)/.test(link.textContent)) {
				return;
			}

			if (link.dataset.searchHandlerAttached) {
				return;
			}

			console.log('[Click Handler] Attaching handler to:', link.textContent.substring(0, 50));
			link.dataset.searchHandlerAttached = 'true';

			link.addEventListener('click', () => {
				console.log('[Click Handler] Link clicked!');

				// Extract conversation ID from href
				const match = link.getAttribute('href').match(/\/chat\/([a-f0-9-]+)/);
				if (!match) {
					console.log('[Click Handler] Could not extract conversation ID from:', link.getAttribute('href'));
					return;
				}

				const conversationId = match[1];
				console.log('[Search Interceptor] Storing query for conversation:', conversationId, lastSearchQuery);

				// Get existing queries object
				const queries = JSON.parse(localStorage.getItem('global_search_queries') || '{}');
				queries[conversationId] = lastSearchQuery;
				localStorage.setItem('global_search_queries', JSON.stringify(queries));
				console.log('[Search Interceptor] Stored queries:', queries);
			});
		});
	}

	// Run click handler attachment periodically
	setInterval(attachClickHandlers, 500);

	console.log('[Search Interceptor] Installed');
})();