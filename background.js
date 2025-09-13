chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.type === 'anthropic-api') {
		fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': request.apiKey,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json',
			},
			body: JSON.stringify(request.payload)
		})
			.then(r => r.json())
			.then(data => sendResponse({ success: true, data }))
			.catch(err => sendResponse({ success: false, error: err.message }));

		return true; // Keep the message channel open for async response
	}
});