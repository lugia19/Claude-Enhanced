// background.js
if (typeof importScripts !== 'undefined') {
	importScripts('lib/jszip.min.js');
}

if (chrome.action) {
	chrome.action.onClicked.addListener((tab) => {
		chrome.tabs.create({ url: 'https://ko-fi.com/lugia19' });
	});
}


chrome.runtime.onMessageExternal.addListener(
	(request, sender, sendResponse) => {
		if (request.ping) sendResponse({ installed: true });
	}
);


// Handle GDPR export download
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'DOWNLOAD_GDPR_EXPORT') {
		console.log('[Background] Downloading GDPR export:', message.url);

		(async () => {
			try {
				// Download
				const response = await fetch(message.url);
				if (!response.ok) {
					throw new Error(`Download failed: ${response.status}`);
				}

				const arrayBuffer = await response.arrayBuffer();
				console.log('[Background] Downloaded', arrayBuffer.byteLength, 'bytes');

				// Unzip
				const zip = await JSZip.loadAsync(arrayBuffer);
				console.log('[Background] Zip loaded, files:', Object.keys(zip.files));

				const conversationsFile = zip.file('conversations.json');
				if (!conversationsFile) {
					throw new Error('conversations.json not found in export');
				}

				console.log('[Background] Extracting conversations.json...');
				const jsonText = await conversationsFile.async('text');
				console.log('[Background] Extracted JSON, length:', jsonText.length);

				// Parse
				console.log('[Background] Parsing JSON...');
				const conversations = JSON.parse(jsonText);
				console.log('[Background] Parsed', conversations.length, 'conversations');

				// Send initial response with total count
				sendResponse({
					success: true,
					totalCount: conversations.length
				});

				// Send conversations in batches of 50
				const tabs = await chrome.tabs.query({ url: "https://claude.ai/recents*" });
				if (tabs.length === 0) {
					throw new Error('No recents tab found');
				}

				const tabId = tabs[0].id; // Just use the first one
				console.log('[Background] Sending to tab:', tabId);

				const BATCH_SIZE = 50;
				for (let i = 0; i < conversations.length; i += BATCH_SIZE) {
					const batch = conversations.slice(i, i + BATCH_SIZE);

					chrome.tabs.sendMessage(tabId, {
						type: 'GDPR_BATCH',
						batch: batch,
						index: i,
						total: conversations.length
					});

					// Small delay to avoid overwhelming
					await new Promise(resolve => setTimeout(resolve, 30));
				}

				// Signal completion
				chrome.tabs.sendMessage(tabId, {
					type: 'GDPR_COMPLETE'
				});

				console.log('[Background] All batches sent');

			} catch (error) {
				console.error('[Background] Download failed:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();

		return true; // Keep channel open for async response
	}
});