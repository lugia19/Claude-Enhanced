// perchat-styles-fetch-interceptor.js
(function() {
    'use strict';
    
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const [input, config] = args;

        // Get the URL string
        let url = undefined;
        if (input instanceof URL) {
            url = input.href;
        } else if (typeof input === 'string') {
            url = input;
        } else if (input instanceof Request) {
            url = input.url;
        }

        // Handle style deletion notifications
        if (url && url.includes('/styles/') && url.includes('/delete') && config?.method === 'DELETE') {
            // Extract the style ID from the URL
            const styleIdMatch = url.match(/styles\/([^\/]+)\/delete/);
            if (styleIdMatch) {
                const deletedStyleId = styleIdMatch[1];
                
                // Let the deletion complete first
                const response = await originalFetch(input, config);
                
                // Notify the isolated script
                window.postMessage({
                    type: 'perchat-style-deleted',
                    styleId: deletedStyleId
                }, '*');
                
                return response;
            }
        }

        // Check if this is a completion or retry_completion request
        if (url && (url.includes('/completion') || url.includes('/retry_completion')) && config?.body) {
            const conversationMatch = url.match(/chat_conversations\/([^\/]+)/);
            const conversationId = conversationMatch ? conversationMatch[1] : null;

            if (conversationId) {
                // Request style from isolated script
                const styleData = await new Promise((resolve) => {
                    const requestId = Math.random().toString(36).substr(2, 9);
                    
                    const listener = (event) => {
                        if (event.data.type === 'perchat-style-response' &&
                            event.data.requestId === requestId) {
                            window.removeEventListener('message', listener);
                            resolve(event.data.style);
                        }
                    };
                    
                    window.addEventListener('message', listener);
                    
                    window.postMessage({
                        type: 'perchat-style-request',
                        conversationId: conversationId,
                        requestId: requestId
                    }, '*');
                    
                    // Timeout after 100ms to not slow down requests
                    setTimeout(() => {
                        window.removeEventListener('message', listener);
                        resolve(null);
                    }, 100);
                });

                if (styleData) {
                    try {
                        const bodyJSON = JSON.parse(config.body);
                        
                        if (styleData.type !== 'none') {
                            // Replace with custom style
                            bodyJSON.personalized_styles = [styleData];
                        } else {
                            // "Use current" selected - send empty array
                            bodyJSON.personalized_styles = [];
                        }
                        
                        config.body = JSON.stringify(bodyJSON);
                    } catch (error) {
                        console.error('Error modifying request:', error);
                    }
                }
            }
        }

        return originalFetch(input, config);
    };
})();