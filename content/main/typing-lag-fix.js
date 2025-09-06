// typing-lag-fix.js
(function () {
	'use strict';

	// Simple storage using localStorage since we're in MAIN world
	const storage = {
		set: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
		get: (key, defaultValue) => {
			const value = localStorage.getItem(key);
			return value ? JSON.parse(value) : defaultValue;
		},
		remove: (key) => localStorage.removeItem(key)
	};

	const processedProseMirrors = new WeakSet();
	let currentTextarea = null;
	let draftSaveTimer;
	let draftDebounce = 300; // 0.3 seconds debounce for draft saving
	const messageCountThreshold = 50; // Threshold for long conversations

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

	async function saveDraft(text) {
		const key = getDraftKey();
		if (!key) return;

		clearTimeout(draftSaveTimer);
		draftSaveTimer = setTimeout(() => {
			if (text.trim()) {
				storage.set(key, text);
				console.log('💾 Draft saved for chat:', getDraftKey());
			} else {
				storage.remove(key);
				console.log('🗑️ Empty draft deleted for chat:', getDraftKey());
			}
		}, draftDebounce);
	}

	async function loadDraft() {
		const key = getDraftKey();
		if (!key) return '';

		const draft = storage.get(key, '');
		if (draft) {
			console.log('📂 Draft loaded for chat:', getDraftKey());
		}
		return draft;
	}

	async function clearDraft() {
		const key = getDraftKey();
		if (key) {
			storage.remove(key);
			console.log('🗑️ Draft cleared for chat:', getDraftKey());
		}
	}

	function extractTextFromProseMirror(proseMirrorDiv) {
		// Handle different possible structures in ProseMirror
		const paragraphs = proseMirrorDiv.querySelectorAll('p');
		if (paragraphs.length > 0) {
			return Array.from(paragraphs)
				.map(p => p.textContent || '')
				.join('\n')
				.trim();
		}

		// Fallback to just getting all text content
		return proseMirrorDiv.textContent?.trim() || '';
	}

	function monitorProseMirrorChanges(proseMirrorDiv) {
		const observer = new MutationObserver((mutations) => {
			// Check if ProseMirror now has content
			const proseMirrorText = extractTextFromProseMirror(proseMirrorDiv);

			if (proseMirrorText && currentTextarea) {
				const textareaText = currentTextarea.value.trim();

				// If ProseMirror has text but our textarea is empty (likely an error return)
				if (!textareaText) {
					console.log('🔄 Error detected - copying text back from ProseMirror.');
					currentTextarea.value = proseMirrorText;

					// Save as draft
					saveDraft(proseMirrorText);

					// Trigger resize
					currentTextarea.dispatchEvent(new Event('input', { bubbles: true }));

					// Clear the ProseMirror again
					setTimeout(() => {
						proseMirrorDiv.innerHTML = '';
						proseMirrorDiv.textContent = '';
					}, 100);
				}
			}
		});

		// Observe changes to the ProseMirror div
		observer.observe(proseMirrorDiv, {
			childList: true,
			subtree: true,
			characterData: true
		});

		return observer;
	}

	async function replaceProseMirror() {
		const proseMirrorDiv = document.querySelector('.ProseMirror');
		if (!proseMirrorDiv || processedProseMirrors.has(proseMirrorDiv)) {
			return;
		}

		console.log('🔄 Replacing ProseMirror with textarea');
		processedProseMirrors.add(proseMirrorDiv);

		// Extract existing text from ProseMirror BEFORE clearing it
		const existingProseMirrorText = extractTextFromProseMirror(proseMirrorDiv);
		if (existingProseMirrorText) {
			console.log('📋 Found existing text in ProseMirror:', existingProseMirrorText);
		}

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

		// Set up mutation observer AFTER hiding but BEFORE clearing
		monitorProseMirrorChanges(proseMirrorDiv);

		// Create textarea
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
		simpleTextarea.placeholder = 'Write your prompt to Claude (Lagfix active)...';

		// Auto-resize function
		async function autoResize() {
			simpleTextarea.style.height = 'auto';
			const newHeight = Math.max(24, simpleTextarea.scrollHeight);
			const maxHeight = window.innerHeight * 0.4;
			simpleTextarea.style.height = Math.min(newHeight, maxHeight) + 'px';

			if (newHeight > maxHeight) {
				simpleTextarea.style.overflowY = 'auto';
			} else {
				simpleTextarea.style.overflowY = 'hidden';
			}
		}

		// Add auto-resize to input events
		simpleTextarea.addEventListener('input', async () => {
			await saveDraft(simpleTextarea.value);
			await autoResize();
		});

		// Load text - use whichever is longer between ProseMirror text and draft
		const existingDraft = await loadDraft();
		let initialText = '';

		if (existingProseMirrorText && existingDraft) {
			// Both exist - use the longer one
			if (existingProseMirrorText.length > existingDraft.length) {
				initialText = existingProseMirrorText;
				console.log('📋 Using ProseMirror text (longer)');
			} else {
				initialText = existingDraft;
				console.log('📂 Using draft text (longer)');
			}
		} else if (existingProseMirrorText) {
			initialText = existingProseMirrorText;
			console.log('📋 Using ProseMirror text (only source)');
		} else if (existingDraft) {
			initialText = existingDraft;
			console.log('📂 Using draft text (only source)');
		}

		if (initialText) {
			simpleTextarea.value = initialText;
			await saveDraft(initialText);
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

	function isLongConversation() {
		const userMessages = document.querySelectorAll('[data-testid="user-message"]')
		const estimatedTotal = userMessages.length * 2;
		return estimatedTotal > messageCountThreshold;
	}

	// Separate polling for each component
	async function checkAndMaintain() {
		// Only enable performance mode if current conversation is in the long conversations set
		if (isLongConversation() || (messageCountThreshold <= 0 && window.location.pathname.indexOf("new") != -1)) {
			const proseMirrorExists = !!document.querySelector('.ProseMirror');
			const ourTextareaExists = !!document.querySelector('.claude-simple-input');
			const ourButtonExists = !!document.querySelector('.claude-custom-submit');

			if (proseMirrorExists && !ourTextareaExists) {
				await replaceProseMirror();
			}

			if (!ourButtonExists) {
				replaceSubmitButton();
			}
		}
	}

	// Monkey patch fetch
	const originalFetch = window.fetch;
	window.fetch = function (...args) {
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
						setTimeout(async () => {
							currentTextarea.value = '';
							await clearDraft();
						}, 100);
					} catch (e) {
						console.error('❌ Failed to modify request:', e);
					}
				}
			} else {
				console.log('⚡ Textarea not focused or empty, skipping injection');
			}
		}

		return originalFetch.apply(this, args);
	};

	// Start
	setInterval(checkAndMaintain, 500);
})();