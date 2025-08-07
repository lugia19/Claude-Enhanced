// content-bridge.js
(function () {
    'use strict';

    window.addEventListener('message', async (event) => {
        if (event.source !== window) return;

        if (event.data.type === 'GM_setValue') {
            chrome.storage.local.set({
                [event.data.key]: event.data.value
            }).catch(err => console.error('Storage set error:', err));
        }

        if (event.data.type === 'GM_getValue') {
            try {
                const result = await chrome.storage.local.get(event.data.key);
                window.postMessage({
                    type: 'GM_getValue_response',
                    requestId: event.data.requestId,
                    value: result[event.data.key]
                }, '*');
            } catch (err) {
                console.error('Storage get error:', err);
                window.postMessage({
                    type: 'GM_getValue_response',
                    requestId: event.data.requestId,
                    value: undefined
                }, '*');
            }
        }

        if (event.data.type === 'GM_deleteValue') {
            chrome.storage.local.remove(event.data.key)
                .catch(err => console.error('Storage delete error:', err));
        }
    });

    console.log('Content bridge initialized');
})();