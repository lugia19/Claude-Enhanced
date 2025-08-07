// ==UserScript==
// @name         Claude typing lag fix
// @namespace    https://lugia19.com
// @version      1.3.0
// @description  Fix typing lag in long claude chats by replacing the text entry field.
// @author       lugia19
// @match        https://claude.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// @license      MIT
// ==/UserScript==


(function () {
	'use strict';

	const processedProseMirrors = new WeakSet();
	let currentTextarea = null;
	let draftSaveTimer;
	let draftDebounce = 300; // 0.3 seconds debounce for draft saving
	const messageCountThreshold = 50; // Threshold for long conversations
	const longConversations = new Set();

	document.addEventListener('keydown', (e) => {
		// Blacklist: elements where typing SHOULD work normally
		const isInputField = e.target.matches('input, select, option');
		const isTextarea = e.target.matches('textarea');
		const isContentEditable = e.target.getAttribute('contenteditable') === 'true' && !e.target.classList.contains('ProseMirror');
		const isCodeEditor = e.target.closest('.monaco-editor, .cm-editor'); // Common code editor classes

		// Skip if it's an actual input field
		if (isInputField || isTextarea || isContentEditable || isCodeEditor) {
			return; // Let normal typing happen
		}

		const hasModifiers = e.ctrlKey || e.altKey || e.metaKey;

		const isNavigationKey = [
			'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
			'PageUp', 'PageDown', 'Home', 'End',
			'Tab', 'Escape', 'Delete', 'Backspace', 'Enter',
			'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
			'Shift', 'Control', 'Alt', 'Meta'
		].includes(e.key);

		// Intercept typing on EVERYTHING else
		if (!isNavigationKey && !hasModifiers && currentTextarea) {
			console.log('🎯 Intercepting typing from:', e.target.tagName, e.target.className.substring(0, 50));

			e.stopImmediatePropagation();
			e.preventDefault();

			currentTextarea.focus();
			currentTextarea.value += e.key;
			currentTextarea.dispatchEvent(new Event('input', { bubbles: true }));

			return false;
		}
	}, { capture: true });


	//Draft storage
	function getDraftKey() {
		if (window.location.pathname.indexOf('/new') != -1) {
			// New chat, common key
			return "claude-draft-homepage";
		}
		const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
		const uuid = match ? match[1] : null;
		return uuid ? `claude-draft-${uuid}` : null;
	}

	function saveDraft(text) {
		const key = getDraftKey();
		if (!key) return;

		clearTimeout(draftSaveTimer);
		draftSaveTimer = setTimeout(() => {
			if (text.trim()) {
				GM_setValue(key, text);
				console.log('💾 Draft saved for chat:', getDraftKey());
			} else {
				GM_deleteValue(key);
				console.log('🗑️ Empty draft deleted for chat:', getDraftKey());
			}
		}, draftDebounce); // 0.5 second debounce
	}

	function loadDraft() {
		const key = getDraftKey();
		if (!key) return '';

		const draft = GM_getValue(key, '');
		if (draft) {
			console.log('📂 Draft loaded for chat:', getDraftKey());
		}
		return draft;
	}

	function clearDraft() {
		const key = getDraftKey();
		if (key) {
			GM_deleteValue(key);
			console.log('🗑️ Draft cleared for chat:', getDraftKey());
		}
	}

	//Actual replacement
	function replaceProseMirror() {
		const proseMirrorDiv = document.querySelector('.ProseMirror');
		if (!proseMirrorDiv || processedProseMirrors.has(proseMirrorDiv)) {
			return;
		}

		console.log('📝 Replacing ProseMirror with textarea');
		processedProseMirrors.add(proseMirrorDiv);

		// Hide and clear original
		proseMirrorDiv.innerHTML = '';
		proseMirrorDiv.textContent = '';
		proseMirrorDiv.setAttribute('contenteditable', 'false');
		proseMirrorDiv.setAttribute('tabindex', '-1');
		proseMirrorDiv.style.cssText = `
			opacity: 0 !important;
			pointer-events: none !important;
			position: absolute !important;
			z-index: -1 !important;
			height: 0 !important;
			overflow: hidden !important;
		`;

		// Create textarea
		// In the replaceProseMirror function, update the textarea creation:

		const simpleTextarea = document.createElement('textarea');
		simpleTextarea.className = 'claude-simple-input';
		simpleTextarea.style.cssText = `
			width: 100%;
			min-height: 1.5rem;
			max-height: none;
			border: none;
			outline: none;
			resize: none;
			overflow: hidden;
			font-family: inherit;
			font-size: inherit;
			line-height: inherit;
			padding: 0;
			background: transparent;
			color: inherit;
		`;
		simpleTextarea.placeholder = 'Write your prompt to Claude';



		// Auto-resize function
		function autoResize() {
			// Reset height to measure scrollHeight accurately
			simpleTextarea.style.height = 'auto';

			// Calculate new height
			const newHeight = Math.max(24, simpleTextarea.scrollHeight); // 24px minimum (1.5rem)
			const maxHeight = unsafeWindow.innerHeight * 0.4; // Max 40% of viewport height

			// Apply the height
			simpleTextarea.style.height = Math.min(newHeight, maxHeight) + 'px';

			// If we hit max height, show scrollbar
			if (newHeight > maxHeight) {
				simpleTextarea.style.overflowY = 'auto';
			} else {
				simpleTextarea.style.overflowY = 'hidden';
			}
		}

		// Add auto-resize to input events
		simpleTextarea.addEventListener('input', () => {
			saveDraft(simpleTextarea.value);
			autoResize();
		});

		// Load existing draft
		const existingDraft = loadDraft();
		if (existingDraft) {
			simpleTextarea.value = existingDraft;
		}

		// Initial resize
		setTimeout(autoResize, 0);

		// Insert textarea
		proseMirrorDiv.parentNode.insertBefore(simpleTextarea, proseMirrorDiv);
		currentTextarea = simpleTextarea;

		// Handle focus hijacking
		proseMirrorDiv.addEventListener('focus', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (currentTextarea) currentTextarea.focus();
		}, true);

		// Also intercept clicks on the container area
		const container = proseMirrorDiv.parentNode;
		container.addEventListener('click', (e) => {
			// If they clicked in the general area but not on our textarea
			if (e.target !== currentTextarea && currentTextarea) {
				console.log('🖱️ Redirecting container click to textarea');
				currentTextarea.focus();
			}
		});

		// Handle Enter key
		simpleTextarea.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				const text = simpleTextarea.value.trim();
				if (text) {
					submitMessage(text);
				}
			}
		});

		simpleTextarea.focus();
	}

	function replaceSubmitButton() {
		const originalSubmitButton = document.querySelector('button[aria-label="Send message"]:not(.claude-custom-submit)');
		const existingCustomButton = document.querySelector('.claude-custom-submit');

		if (!originalSubmitButton || existingCustomButton) {
			return; // No original button or custom already exists
		}

		console.log('🔘 Replacing submit button');

		// Create our button
		const newSubmitButton = document.createElement('button');
		newSubmitButton.innerHTML = originalSubmitButton.innerHTML;
		newSubmitButton.className = originalSubmitButton.className + ' claude-custom-submit';
		newSubmitButton.type = 'button';
		newSubmitButton.setAttribute('aria-label', 'Send message');
		newSubmitButton.disabled = false;

		// Replace the button
		originalSubmitButton.style.display = 'none';
		originalSubmitButton.parentNode.insertBefore(newSubmitButton, originalSubmitButton);

		// Handle click
		newSubmitButton.addEventListener('click', (e) => {
			e.preventDefault();
			if (currentTextarea) {
				const text = currentTextarea.value.trim();
				if (text) {
					submitMessage(text);
				}
			}
		});
	}

	function processMarkdownCodeBlocks(text) {
		// Replace ```language\ncode\n``` with proper HTML
		return text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
			let lang = language || '';
			const escapedCode = code.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');
			return `<pre><code class="language-${lang}">${escapedCode}</code></pre>`;
		});
	}

	function submitMessage(text) {
		console.log('📤 Submitting message');

		const proseMirrorDiv = document.querySelector('.ProseMirror');
		if (proseMirrorDiv) {
			// FIRST: Clear it completely, no matter what
			proseMirrorDiv.innerHTML = '';
			proseMirrorDiv.textContent = '';

			// Wait a bit to ensure it's properly cleared
			setTimeout(() => {
				// Temporarily re-enable it for submission
				proseMirrorDiv.setAttribute('contenteditable', 'true');

				// Process markdown first
				const processedText = processMarkdownCodeBlocks(text);

				// If it has code blocks, use innerHTML (but escaped), otherwise use paragraphs
				if (processedText !== text) {
					proseMirrorDiv.innerHTML = processedText;
				} else {
					// Original paragraph approach for non-code text
					proseMirrorDiv.innerHTML = '';
					const lines = text.split('\n');
					lines.forEach(line => {
						const p = document.createElement('p');
						p.textContent = line || '\u00A0';
						proseMirrorDiv.appendChild(p);
					});
				}

				proseMirrorDiv.dispatchEvent(new Event('input', { bubbles: true }));
				proseMirrorDiv.dispatchEvent(new Event('change', { bubbles: true }));

				setTimeout(() => {
					// Find and click submit...
					let hiddenSubmit = document.querySelector('button[aria-label="Send message"][style*="display: none"]');
					if (!hiddenSubmit) {
						hiddenSubmit = document.querySelector('button[aria-label="Send message"]:not(.claude-custom-submit)');
					}

					if (hiddenSubmit && !hiddenSubmit.disabled) {
						hiddenSubmit.click();
					}

					// Disable it again after submission
					// Clear our textarea and clean up the original
					setTimeout(() => {
						console.log('🧹 Cleaning up after submission');
						if (currentTextarea) {
							currentTextarea.value = '';
							currentTextarea.style.height = 'auto';
							currentTextarea.style.height = '1.5rem';
							currentTextarea.style.overflowY = 'hidden';
							currentTextarea.focus();
						}

						// Clear the original
						proseMirrorDiv.innerHTML = '';
						proseMirrorDiv.textContent = '';
						proseMirrorDiv.setAttribute('contenteditable', 'false');

						// Scroll to bottom with multiple attempts
						const scrollToBottom = () => {
							const chatContainer = document.querySelector('.relative.h-full.flex-1.flex.overflow-x-hidden.overflow-y-scroll.pt-6');
							if (chatContainer) {
								chatContainer.scrollTo(0, chatContainer.scrollHeight);
							}
						};

						scrollToBottom(); // Immediate
						setTimeout(scrollToBottom, 500); // 0.5s
						setTimeout(scrollToBottom, 1000); // 1s
						setTimeout(clearDraft, 200);
					}, 100);
				}, 50);
			}, 100);
		}
	}

	// Separate polling for each component
	function checkAndMaintain() {
		const currentUrlMatch = unsafeWindow.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
		const currentConvId = currentUrlMatch ? currentUrlMatch[1] : null;

		// Only enable performance mode if current conversation is in the long conversations set
		if ((currentConvId && longConversations.has(currentConvId)) || (messageCountThreshold <= 0 && unsafeWindow.location.pathname.indexOf("new") != -1)) {
			const proseMirrorExists = !!document.querySelector('.ProseMirror');
			const ourTextareaExists = !!document.querySelector('.claude-simple-input');
			const ourButtonExists = !!document.querySelector('.claude-custom-submit');

			if (proseMirrorExists && !ourTextareaExists) {
				replaceProseMirror();
			}

			if (!ourButtonExists) {
				replaceSubmitButton();
			}
		}
	}

	// Monkey patch fetch
	const originalFetch = unsafeWindow.fetch;
	unsafeWindow.fetch = function (...args) {
		const url = args[0];

		// Intercept completion calls
		if (typeof url === 'string' && url.includes('/completion')) {
			console.log('🎯 Intercepting completion call');

			// ONLY inject if our textarea is focused AND has content
			if (currentTextarea &&
				currentTextarea.value.trim() &&
				document.activeElement === currentTextarea) {

				let savedText = currentTextarea.value.trim();
				savedText = savedText.replace(/```(\w+)\n/g, '```\n'); // Normalize code block start
				console.log('💉 Textarea is focused, injecting our text:', savedText);

				// Parse and modify the body
				if (args[1] && args[1].body) {
					try {
						const bodyText = args[1].body;
						const bodyData = JSON.parse(bodyText);

						// Just inject the plain text - no HTML formatting needed!
						if (bodyData.prompt !== undefined) {
							bodyData.prompt = savedText;
						} else if (bodyData.text !== undefined) {
							bodyData.text = savedText;
						} else if (bodyData.content !== undefined) {
							bodyData.content = savedText;
						}

						console.log('📦 Modified body with plain text');
						args[1].body = JSON.stringify(bodyData);

						// Clear our textarea after successful injection
						setTimeout(() => {
							currentTextarea.value = '';
							clearDraft();
						}, 100);
					} catch (e) {
						console.error('❌ Failed to modify request:', e);
					}
				}
			} else {
				console.log('⏭️ Textarea not focused or empty, skipping injection');
			}
		}

		if (typeof url === 'string' && url.includes('/chat_conversations/') && url.includes('tree=True')) {
			console.log('🔍 Intercepted tree=True call, making tree=False call');

			// Extract conversation ID
			const conversationIdMatch = url.match(/chat_conversations\/([a-f0-9-]+)/);
			const fetchedConvId = conversationIdMatch ? conversationIdMatch[1] : null;

			if (fetchedConvId) {
				// Make our own call with tree=False to get visible message count
				const visibleMessagesUrl = url.replace('tree=True', 'tree=False');

				originalFetch(visibleMessagesUrl, args[1])
					.then(response => response.json())
					.then(data => {
						const visibleMessageCount = data.chat_messages?.length || 0;
						console.log(`📊 Conversation ${fetchedConvId} has ${visibleMessageCount} visible messages`);

						if (visibleMessageCount > messageCountThreshold) {
							longConversations.add(fetchedConvId);
							console.log('📝 Added to long conversations set (based on visible messages)');
						} else {
							longConversations.delete(fetchedConvId);
							console.log('📝 Removed from long conversations set');
						}
					})
					.catch(err => {
						console.log('❌ Failed to fetch visible messages:', err);
					});
			}
		}

		return originalFetch.apply(this, args);
	};
	// Start
	setInterval(checkAndMaintain, 100);

})();