chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.type === 'GM_xmlhttpRequest') {
		handleHttpRequest(request.details).then(sendResponse);
		return true; // Keep channel open for async
	}
});

async function handleHttpRequest(details) {
	try {
		let body = null;

		// Reconstruct FormData if needed
		if (details.data && details.data.type === 'formdata') {
			const formData = new FormData();

			for (const [key, entry] of Object.entries(details.data.entries)) {
				if (entry.type === 'blob') {
					// Convert base64 back to blob
					const response = await fetch(entry.data);
					const blob = await response.blob();
					// Note: Groq API doesn't care about filename, but including it anyway
					formData.append(key, blob, entry.filename);
				} else {
					formData.append(key, entry.data);
				}
			}
			body = formData;
		} else {
			body = details.data;
		}

		// Make the actual request
		const response = await fetch(details.url, {
			method: details.method,
			headers: details.headers,
			body: body
		});

		const responseText = await response.text();

		return {
			responseText: responseText,
			status: response.status,
			statusText: response.statusText,
			responseHeaders: Object.fromEntries(response.headers.entries())
		};
	} catch (error) {
		return { error: error.message };
	}
}