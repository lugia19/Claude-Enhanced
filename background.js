// background.js
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
