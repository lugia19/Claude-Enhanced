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

        if (event.data.type === 'GM_xmlhttpRequest') {
            const { requestId, details } = event.data;

            // Serialize FormData if present
            let serializedData = details.data;
            if (details.data instanceof FormData) {
                const formEntries = {};
                for (const [key, value] of details.data.entries()) {
                    if (value instanceof Blob) {
                        // Convert blob to base64
                        const reader = new FileReader();
                        const base64 = await new Promise((resolve) => {
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(value);
                        });
                        formEntries[key] = {
                            type: 'blob',
                            data: base64,
                            mimeType: value.type,
                            filename: value.name || 'file'
                        };
                    } else {
                        formEntries[key] = {
                            type: 'string',
                            data: value
                        };
                    }
                }
                serializedData = { type: 'formdata', entries: formEntries };
            }

            // Send to background
            chrome.runtime.sendMessage({
                type: 'GM_xmlhttpRequest',
                details: {
                    method: details.method,
                    url: details.url,
                    headers: details.headers,
                    data: serializedData
                }
            }, (response) => {
                // Send response back to page
                window.postMessage({
                    type: 'GM_xmlhttpRequest_response',
                    requestId: requestId,
                    ...response
                }, '*');
            });
        }
    });

    console.log('Content bridge initialized');
})();