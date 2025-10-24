// claude-styles.js
// Shared style utilities for Claude.ai extension
// No IIFE - runs in shared global context

const CLAUDE_CLASSES = {
	// Buttons
	ICON_BTN: 'inline-flex items-center justify-center relative shrink-0 ring-offset-2 ring-offset-bg-300 ring-accent-main-100 focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none text-text-200 border-transparent transition-colors font-styrene active:bg-bg-400 hover:bg-bg-500/40 hover:text-text-100 h-9 w-9 rounded-md active:scale-95',
	BTN_PRIMARY: 'inline-flex items-center justify-center px-4 py-2 font-base-bold bg-text-000 text-bg-000 rounded hover:bg-text-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[5rem] h-9',
	BTN_SECONDARY: 'inline-flex items-center justify-center px-4 py-2 hover:bg-bg-500/40 rounded transition-colors min-w-[5rem] h-9 text-text-000 font-base-bold border-0.5 border-border-200',

	// Modal
	MODAL_BACKDROP: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50',
	MODAL_CONTAINER: 'bg-bg-100 rounded-lg p-6 shadow-xl max-w-md w-full mx-4 border border-border-300',
	MODAL_HEADING: 'text-lg font-semibold mb-4 text-text-100',

	// Form elements
	INPUT: 'w-full p-2 rounded bg-bg-200 text-text-100 border border-border-300 hover:border-border-200',
	SELECT: 'w-full p-2 rounded bg-bg-200 text-text-100 border border-border-300 hover:border-border-200 cursor-pointer',
	CHECKBOX: 'mr-2 rounded border-border-300 accent-accent-main-100',
	LABEL: 'block text-sm font-medium text-text-200 mb-1',

	// Text
	TEXT_SM: 'text-sm text-text-400 sm:text-[0.75rem]',
	TEXT_MUTED: 'text-sm text-text-400',

	// Tooltip
	TOOLTIP_WRAPPER: 'fixed left-0 top-0 min-w-max z-[100] pointer-events-none',
	TOOLTIP_CONTENT: 'px-2 py-1 text-xs font-normal font-ui leading-tight rounded-md shadow-md text-white bg-black/80 backdrop-blur break-words max-w-[13rem]',

	// Layout helpers
	FLEX_CENTER: 'flex items-center justify-center',
	FLEX_BETWEEN: 'flex items-center justify-between',
	FLEX_GAP_2: 'flex items-center gap-2',

	// List components
	LIST_CONTAINER: 'space-y-2 overflow-y-auto',
	LIST_ITEM: 'p-3 rounded bg-bg-200 border border-border-300 hover:bg-bg-300 cursor-pointer transition-colors',
};

const mobileModalButtons = [];
const spinnerStyles = document.createElement('style');
spinnerStyles.textContent = `
	@keyframes claude-modal-spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
	.claude-modal-spinner {
		animation: claude-modal-spin 1s linear infinite;
	}
`;
if (document.head) document.head.appendChild(spinnerStyles);

// Component creators
class ClaudeModal {
	constructor(title = '', content = '', dismissible = true) {
		this.config = { title, content, dismissible };
		this.isVisible = false;
		this.buttons = [];

		this._buildModal();
		this._attachEventListeners();
	}

	_buildModal() {
		this.backdrop = document.createElement('div');
		this.backdrop.className = CLAUDE_CLASSES.MODAL_BACKDROP;
		this.backdrop.style.display = 'none';

		this.modal = document.createElement('div');
		this.modal.className = CLAUDE_CLASSES.MODAL_CONTAINER;
		this.modal.setAttribute('role', 'dialog');
		this.modal.setAttribute('aria-modal', 'true');

		this.titleElement = document.createElement('h2');
		this.titleElement.id = 'modal-title';
		this.titleElement.className = CLAUDE_CLASSES.MODAL_HEADING;
		this.modal.setAttribute('aria-labelledby', 'modal-title');
		this.modal.appendChild(this.titleElement);
		this._updateTitle(this.config.title);

		this.contentDiv = document.createElement('div');
		this.contentDiv.className = 'mb-4';
		this._setContent(this.config.content);
		this.modal.appendChild(this.contentDiv);

		this.buttonContainer = document.createElement('div');
		this.buttonContainer.className = 'flex justify-end gap-2';
		this.modal.appendChild(this.buttonContainer);

		this.backdrop.appendChild(this.modal);
	}

	_setContent(content) {
		this.contentDiv.innerHTML = '';
		if (!content) return;

		if (typeof content === 'string') {
			this.contentDiv.innerHTML = content;
		} else if (content instanceof HTMLElement) {
			this.contentDiv.appendChild(content);
		}
	}

	_updateTitle(title) {
		if (title) {
			this.titleElement.textContent = title;
			this.titleElement.style.display = '';
		} else {
			this.titleElement.style.display = 'none';
		}
	}

	_attachEventListeners() {
		this._handleEscape = (e) => {
			if (e.key === 'Escape' && this.isVisible && this.config.dismissible) {
				this.hide();
			}
		};

		this.backdrop.onclick = (e) => {
			if (e.target === this.backdrop && this.config.dismissible) {
				this.hide();
			}
		};
	}

	addButton(text, variant = 'primary', onClick = null, closeOnClick = true) {
		const button = createClaudeButton(text, variant);

		button.onclick = async () => {
			try {
				let shouldClose = closeOnClick;

				if (onClick) {
					let result = onClick(button, this);
					if (result instanceof Promise) {
						result = await result;
					}
					if (result === false) {
						shouldClose = false;
					}
				}

				if (shouldClose) {
					this.destroy();
				}
			} catch (error) {
				console.error('Modal button handler error:', error);
			}
		};

		this.buttonContainer.appendChild(button);
		this.buttons.push(button);

		return button;
	}

	addCancel(text = 'Cancel', onClick = null) {
		return this.addButton(text, 'secondary', onClick, true);
	}

	addConfirm(text = 'Confirm', onClick = null, closeOnClick = true) {
		return this.addButton(text, 'primary', onClick, closeOnClick);
	}

	clearButtons() {
		this.buttons.forEach(btn => btn.remove());
		this.buttons = [];
		return this;
	}

	show() {
		if (this.isVisible) return this;

		this.backdrop.style.display = 'flex';
		document.body.appendChild(this.backdrop);
		document.addEventListener('keydown', this._handleEscape);
		this.isVisible = true;

		// Steal focus
		this.backdrop.setAttribute('tabindex', '-1');
		this.backdrop.focus();

		return this;
	}

	hide() {
		if (!this.isVisible) return this;

		this.backdrop.style.display = 'none';
		document.removeEventListener('keydown', this._handleEscape);
		this.isVisible = false;

		return this;
	}

	destroy() {
		this.hide();
		this.backdrop.remove();
	}

	setContent(content) {
		this._setContent(content);
		return this;
	}

	setTitle(title) {
		this.config.title = title;
		this._updateTitle(title);
		return this;
	}
}

function createLoadingContent(text) {
	const div = document.createElement('div');
	div.className = 'flex items-start gap-3'; // Changed from items-center to items-start

	// Split on newlines and create proper line breaks
	const lines = text.split('\n');
	const textContent = document.createElement('div');
	textContent.className = 'text-text-200';

	lines.forEach((line, index) => {
		const span = document.createElement('span');
		span.textContent = line;
		textContent.appendChild(span);
		if (index < lines.length - 1) {
			textContent.appendChild(document.createElement('br'));
		}
	});

	div.innerHTML = `
		<div class="claude-modal-spinner rounded-full h-5 w-5 border-2 border-border-300 flex-shrink-0" style="border-top-color: #2c84db"></div>
	`;
	div.appendChild(textContent);

	return div;
}

function createLoadingModal(text = 'Loading...') {
	return new ClaudeModal('', createLoadingContent(text), false);
}

function showClaudeConfirm(title, message) {
	return new Promise((resolve) => {
		const messageEl = document.createElement('p');
		messageEl.className = 'text-text-100';
		messageEl.textContent = message;

		const modal = new ClaudeModal(title, messageEl);

		modal.addCancel('Cancel', () => {
			resolve(false);
		});

		modal.addConfirm('Confirm', () => {
			resolve(true);
		});

		// Override backdrop click to resolve with false
		modal.backdrop.onclick = (e) => {
			if (e.target === modal.backdrop) {
				modal.hide();
				resolve(false);
			}
		};

		modal.show();
	});
}

// Full-featured prompt with all options
function showClaudePrompt(title, message, placeholder = '', defaultValue = '', onValidate = null) {
	return new Promise((resolve, reject) => {
		const contentDiv = document.createElement('div');

		if (message) {
			const label = document.createElement('label');
			label.className = CLAUDE_CLASSES.LABEL;
			label.textContent = message;
			contentDiv.appendChild(label);
		}

		const input = createClaudeInput({
			type: 'text',
			placeholder: placeholder,
			value: defaultValue,
		});
		contentDiv.appendChild(input);

		const modal = new ClaudeModal(title, contentDiv);

		modal.addCancel('Cancel', () => {
			reject(new Error('User cancelled'));
		});

		modal.addConfirm('OK', async (btn, modal) => {
			const value = input.value.trim();

			// Run validation if provided
			if (onValidate) {
				const validationResult = await onValidate(value);
				if (validationResult !== true) {
					// Show error message if validation failed
					if (typeof validationResult === 'string') {
						showClaudeAlert('Validation Error', validationResult);
					}
					return false; // Keep modal open
				}
			}

			resolve(value);
			return true; // Close modal
		});

		modal.show();

		// Focus the input
		setTimeout(() => input.focus(), 100);

		// Allow Enter key to submit
		input.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				const confirmBtn = modal.buttons[modal.buttons.length - 1];
				if (confirmBtn) confirmBtn.click();
			}
		});
	});
}

// Full-featured alert with customization
function showClaudeAlert(title, message, buttonText = 'OK') {
	return new Promise((resolve) => {
		const contentDiv = document.createElement('div');
		contentDiv.className = 'text-text-200';

		if (typeof message === 'string') {
			contentDiv.textContent = message;
		} else if (message instanceof HTMLElement) {
			contentDiv.appendChild(message);
		}

		const modal = new ClaudeModal(title, contentDiv);
		modal.addButton(buttonText, 'primary', () => {
			resolve();
		});
		modal.show();
	});
}

function createClaudeButton(content, variant = 'primary', onClick = null, contentIsHTML = false) {
	const button = document.createElement('button');
	button.setAttribute('data-toolbox-button', 'true');

	switch (variant) {
		case 'primary':
			button.className = CLAUDE_CLASSES.BTN_PRIMARY;
			break;
		case 'secondary':
			button.className = CLAUDE_CLASSES.BTN_SECONDARY;
			break;
		case 'icon':
			button.className = CLAUDE_CLASSES.ICON_BTN;
			contentIsHTML = true; // Always use innerHTML for icon variant
			break;
		default:
			button.className = CLAUDE_CLASSES.BTN_PRIMARY;
	}

	if (contentIsHTML) {
		button.innerHTML = content;
	} else {
		button.textContent = content;
	}

	if (onClick) button.onclick = onClick;
	return button;
}


function createClaudeInput({ type = 'text', placeholder = '', value = '', onChange = null } = {}) {
	const input = document.createElement('input');
	input.type = type;
	input.className = CLAUDE_CLASSES.INPUT;
	input.placeholder = placeholder;
	input.value = value;

	if (onChange) {
		input.addEventListener('input', onChange);
	}

	return input;
}

function createClaudeSelect(options, selectedValue = '', onChange = null) {
	const select = document.createElement('select');
	select.className = CLAUDE_CLASSES.SELECT;

	options.forEach(option => {
		const optionEl = document.createElement('option');
		optionEl.value = option.value;
		optionEl.textContent = option.label;
		optionEl.selected = option.value === selectedValue;
		select.appendChild(optionEl);
	});

	if (onChange) {
		select.addEventListener('change', onChange);
	}

	return select;
}

function createClaudeCheckbox(labelText = '', checked = false, onChange = null) {
	const container = document.createElement('div');
	container.className = CLAUDE_CLASSES.FLEX_GAP_2;

	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.className = CLAUDE_CLASSES.CHECKBOX;
	checkbox.checked = checked;

	// Add aria-label for screen readers
	if (labelText) {
		checkbox.setAttribute('aria-label', labelText);
	}

	if (onChange) {
		checkbox.addEventListener('change', (e) => onChange(e.target.checked));
	}

	container.appendChild(checkbox);

	if (labelText) {
		const label = document.createElement('label');
		label.className = 'text-text-100 cursor-pointer select-none';
		label.textContent = labelText;
		label.onclick = () => checkbox.click();
		container.appendChild(label);
	}

	return { container, checkbox };
}

function createClaudeToggle(labelText = '', checked = false, onChange = null) {
	// Container for toggle + label
	const container = document.createElement('div');
	container.className = 'flex items-center gap-2';

	// Toggle wrapper
	const toggleWrapper = document.createElement('label');

	const toggleContainer = document.createElement('div');
	toggleContainer.className = 'group/switch relative select-none cursor-pointer inline-block';

	const input = document.createElement('input');
	input.type = 'checkbox';
	input.className = 'peer sr-only';
	input.role = 'switch';
	input.checked = checked;
	input.style.width = '36px';
	input.style.height = '20px';

	if (labelText) {
		input.setAttribute('aria-label', labelText);
	}


	const track = document.createElement('div');
	track.className = 'border-border-300 rounded-full bg-bg-500 transition-colors peer-checked:bg-accent-secondary-100 peer-disabled:opacity-50';
	track.style.width = '36px';
	track.style.height = '20px';

	const thumb = document.createElement('div');
	thumb.className = 'absolute flex items-center justify-center rounded-full bg-white transition-transform group-hover/switch:opacity-80';
	thumb.style.width = '16px';
	thumb.style.height = '16px';
	thumb.style.left = '2px';
	thumb.style.top = '2px';
	thumb.style.transform = checked ? 'translateX(16px)' : 'translateX(0)';

	input.addEventListener('change', (e) => {
		thumb.style.transform = e.target.checked ? 'translateX(16px)' : 'translateX(0)';
		if (onChange) onChange(e.target.checked);
	});

	toggleContainer.appendChild(input);
	toggleContainer.appendChild(track);
	toggleContainer.appendChild(thumb);
	toggleContainer.style.transform = 'translateY(3px)'; // Slight vertical align
	toggleWrapper.appendChild(toggleContainer);

	container.appendChild(toggleWrapper);

	// Add label text if provided
	if (labelText) {
		const label = document.createElement('span');
		label.className = 'text-text-100 select-none cursor-pointer';
		label.textContent = labelText;
		label.onclick = () => input.click(); // Make label clickable
		container.appendChild(label);
	}

	return { container, input, toggle: toggleContainer };
}


function createClaudeTooltip(element, tooltipText, deleteOnClick) {
	const tooltipId = `tooltip-${Math.random().toString(36).substring(2, 11)}`;

	// Link element to tooltip for screen readers
	element.setAttribute('aria-describedby', tooltipId);

	// Create tooltip wrapper
	const tooltipWrapper = document.createElement('div');
	tooltipWrapper.className = CLAUDE_CLASSES.TOOLTIP_WRAPPER;
	tooltipWrapper.style.display = 'none';
	tooltipWrapper.setAttribute('data-radix-popper-content-wrapper', '');

	// Add tooltip content with the ID
	const tooltipContent = document.createElement('div');
	tooltipContent.id = tooltipId;
	tooltipContent.className = CLAUDE_CLASSES.TOOLTIP_CONTENT + ' tooltip-content';
	tooltipContent.setAttribute('data-side', 'bottom');
	tooltipContent.setAttribute('data-align', 'center');
	tooltipContent.setAttribute('data-state', 'delayed-open');
	tooltipContent.innerHTML = `
        ${tooltipText}
        <span role="tooltip" style="position: absolute; border: 0px; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; overflow-wrap: normal;">
            ${tooltipText}
        </span>
    `;
	tooltipWrapper.appendChild(tooltipContent);

	// Add hover events
	element.addEventListener('mouseenter', () => {
		tooltipWrapper.style.display = 'block';
		const rect = element.getBoundingClientRect();
		const tooltipRect = tooltipWrapper.getBoundingClientRect();
		const centerX = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
		tooltipWrapper.style.transform = `translate(${centerX}px, ${rect.bottom + 5}px)`;
	});

	element.addEventListener('mouseleave', () => {
		tooltipWrapper.style.display = 'none';
	});

	// Handle click behavior
	const shouldHideOnClick = deleteOnClick === undefined
		? (element.onclick !== null)
		: deleteOnClick;

	if (shouldHideOnClick) {
		element.addEventListener('click', () => {
			tooltipWrapper.style.display = 'none';
		});
	}

	document.body.appendChild(tooltipWrapper);

	// Clean up when element is removed
	const originalRemove = element.remove.bind(element);
	element.remove = () => {
		tooltipWrapper.remove();
		originalRemove();
	};

	// Create tooltip API object
	const tooltipAPI = {
		wrapper: tooltipWrapper,
		updateText: (newText) => {
			tooltipContent.innerHTML = `
                ${newText}
                <span role="tooltip" style="position: absolute; border: 0px; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; overflow-wrap: normal;">
                    ${newText}
                </span>
            `;
		}
	};

	// Store tooltip on the element itself
	element.tooltip = tooltipAPI;

	// Still return it for convenience
	return tooltipAPI;
}


// All top right buttons must be in ISOLATED only!
// All top right buttons must be in ISOLATED only!
function tryAddTopRightButton(buttonClass, createButtonFn, tooltipText = '', forceDisplayOnMobile = false, displayOnNewPage = false) {
	const isChatPage = window.location.href.includes("/chat/");
	if (!isChatPage && !displayOnNewPage) return false;

	const BUTTON_PRIORITY = [
		'search-button',
		'navigation-button',
		'style-selector-button',
		'export-button',
		'stt-settings-button',
		'tts-settings-button',
	];

	let container;
	if (isChatPage) container = document.querySelector("[data-testid=\"chat-actions\"]")
	else container = document.querySelector(".absolute.top-3.right-3.z-header.draggable-none")

	if (!container) {
		console.log("Top right button container not found");
		return false;
	}

	const isMobile = window.innerHeight > window.innerWidth;
	let madeChanges = false;

	// On desktop OR if forceDisplay is true, add button to container
	if (!isMobile || forceDisplayOnMobile || (!isChatPage && displayOnNewPage)) {
		// Remove from mobile modal if it's there
		const modalIndex = mobileModalButtons.findIndex(b => b.class === buttonClass);
		if (modalIndex !== -1) {
			mobileModalButtons.splice(modalIndex, 1);
			madeChanges = true;
		}

		// Add button if it doesn't exist
		if (!container.querySelector('.' + buttonClass)) {
			const button = createButtonFn();
			button.classList.add(buttonClass);

			// Add negative margin if mobile (portrait mode)
			if (isMobile) {
				button.classList.add('-mx-1.5');
			}

			// Add tooltip
			if (tooltipText) {
				createClaudeTooltip(button, tooltipText);
			}

			container.appendChild(button);
			madeChanges = true;
		}

		// Check if reordering is needed
		const currentButtons = Array.from(container.querySelectorAll('button'));

		// Separate custom and native buttons
		const customButtons = currentButtons.filter(btn => btn.hasAttribute('data-toolbox-button'));
		const nativeButtons = currentButtons.filter(btn => !btn.hasAttribute('data-toolbox-button'));

		// Build custom button order: priority → non-priority → "More"
		const priorityButtons = [];
		for (const className of BUTTON_PRIORITY) {
			const button = customButtons.find(btn => btn.classList.contains(className));
			if (button) {
				priorityButtons.push(button);
			}
		}

		const nonPriorityButtons = customButtons.filter(btn =>
			!BUTTON_PRIORITY.some(className => btn.classList.contains(className)) &&
			!btn.classList.contains('more-actions-button')
		);

		const moreButton = customButtons.find(btn => btn.classList.contains('more-actions-button'));

		// Desired order: priority → non-priority → "More" → native
		const desiredOrder = [...priorityButtons, ...nonPriorityButtons];
		if (moreButton) {
			desiredOrder.push(moreButton);
		}
		desiredOrder.push(...nativeButtons);

		// Only reorder if the current order doesn't match desired order
		const needsReordering = currentButtons.length !== desiredOrder.length ||
			!currentButtons.every((btn, index) => btn === desiredOrder[index]);

		if (needsReordering) {
			desiredOrder.forEach(button => {
				container.appendChild(button);
			});
			madeChanges = true;
		}

		// Remove "More" button if we're on desktop and no buttons need it
		if (!isMobile && isChatPage) {
			const moreButton = container.querySelector('.more-actions-button');
			if (moreButton) {
				moreButton.remove();
				madeChanges = true;
			}
		}

		return madeChanges;
	}

	// If we're not on a chat page, ignore the mobile stuff
	if (!isChatPage) return false;

	// On mobile AND forceDisplay is false: handle mobile modal logic

	// Remove button from container if it exists
	const existingButtonInContainer = container.querySelector('.' + buttonClass);
	if (existingButtonInContainer) {
		existingButtonInContainer.remove();
		madeChanges = true;
	}

	// Add to modal array if not already there
	const existingButton = mobileModalButtons.find(b => b.class === buttonClass);
	if (!existingButton) {
		mobileModalButtons.push({
			class: buttonClass,
			createFn: createButtonFn,
			tooltip: tooltipText
		});
		madeChanges = true;
	}

	// Make sure the "More" button exists
	if (!container.querySelector('.more-actions-button')) {
		const moreButton = createClaudeButton(`
			<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
				<circle cx="8" cy="2" r="1.5"/>
				<circle cx="8" cy="8" r="1.5"/>
				<circle cx="8" cy="14" r="1.5"/>
			</svg>
		`, 'icon');

		moreButton.classList.add('more-actions-button', '-mx-1.5');

		moreButton.onclick = () => {
			showMoreActionsModal();
		};

		createClaudeTooltip(moreButton, 'More actions');
		container.appendChild(moreButton);
		madeChanges = true;
	}

	return madeChanges;
}

function showMoreActionsModal() {
	const modal = new ClaudeModal('More Actions', '', true);

	const list = document.createElement('div');
	list.className = 'space-y-2';

	// Add each stored button to the modal
	mobileModalButtons.forEach(btnInfo => {
		const button = btnInfo.createFn();
		console.log('Adding button to modal:', btnInfo.class);
		// Create a list item wrapper
		const item = document.createElement('div');
		item.className = 'p-3 rounded bg-bg-200 border border-border-300 hover:bg-bg-300 cursor-pointer transition-colors flex items-center gap-3';

		// Add the button content (icon)
		const iconWrapper = document.createElement('div');
		iconWrapper.className = 'flex-shrink-0';
		iconWrapper.innerHTML = button.innerHTML;
		item.appendChild(iconWrapper);

		// Add the label text from tooltip
		if (btnInfo.tooltip) {
			const label = document.createElement('span');
			label.className = 'text-text-100 flex-1';
			label.textContent = btnInfo.tooltip;
			item.appendChild(label);
		}

		// When clicked, trigger the button's onclick and close modal
		item.onclick = () => {
			if (button.onclick) {
				button.onclick();
			}
			modal.destroy();
		};

		list.appendChild(item);
	});

	modal.setContent(list);
	modal.show();
}

function findMessageControls(messageElement) {
	// Check if it's a user message
	const isUserMessage = messageElement.closest('[data-testid="user-message"]') !== null;

	if (isUserMessage) {
		// User message logic
		const groupEl = messageElement.closest('.group');
		if (!groupEl) return null;

		return groupEl.querySelector('.absolute.bottom-0.right-2');
	} else {
		// Assistant message logic (original code)
		const group = messageElement.closest('.group');
		const buttons = group?.querySelectorAll('button');
		if (!buttons) return null;
		const copyButton = group.querySelector('[data-testid="action-bar-copy"]');
		return copyButton?.closest('.justify-between');
	}
}

// Retrieve all message elements from the UI
function getUIMessages() {
	const assistantMessages = document.querySelectorAll('.font-claude-response, .\\!font-claude-response');
	const userMessages = document.querySelectorAll('.font-user-message, .\\!font-user-message, [data-testid="user-message"]');
	return {
		assistantMessages,
		userMessages,
		allMessages: [...assistantMessages, ...userMessages]
	};
}

function addMessageButtonWithPriority(buttonGenerator, buttonClass) {
	const MESSAGE_BUTTON_PRIORITY = [
		'tts-speak-button',
		'fork-button',
	];

	const messages = document.querySelectorAll('.font-claude-response');
	messages.forEach((message) => {
		const container = findMessageControls(message);
		if (!container) {
			return;
		}
		if (container.querySelector('.' + buttonClass)) {
			return; // Already added
		}
		const button = buttonGenerator();
		button.classList.add(buttonClass);

		// Find where to insert the button based on priority
		let insertBefore = null;

		// Look for the first existing button with lower priority
		const currentPriority = MESSAGE_BUTTON_PRIORITY.indexOf(buttonClass);

		for (let i = currentPriority + 1; i < MESSAGE_BUTTON_PRIORITY.length; i++) {
			const lowerPriorityButton = container.querySelector('.' + MESSAGE_BUTTON_PRIORITY[i]);
			if (lowerPriorityButton) {
				insertBefore = lowerPriorityButton;
				break;
			}
		}

		// If no lower priority custom button found, try to insert before the copy button group
		if (!insertBefore) {
			const copyButtonParent = container.querySelector('[data-testid="action-bar-copy"]')?.parentElement;
			if (copyButtonParent) {
				insertBefore = copyButtonParent;
			}
		}

		// Insert the button
		if (insertBefore) {
			container.insertBefore(button, insertBefore);
		} else {
			// If no reference point found, just append at the end
			container.appendChild(button);
		}
	});
}


// Simple alert overwrite for ISOLATED context
if (typeof window !== 'undefined') {
	// Store original in case needed
	const nativeAlert = window.alert;

	// Override alert with Claude-styled version
	window.alert = function (message) {
		showClaudeAlert('', String(message || ''));
		// Returns immediately (fire-and-forget style)
	};

	// Provide access to original if ever needed
	window.nativeAlert = nativeAlert;
}
