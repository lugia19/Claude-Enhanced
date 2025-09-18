// claude-styles.js
// Shared style utilities for Claude.ai extension
// No IIFE - runs in shared global context

const CLAUDE_STYLES = {
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
	TOOLTIP_WRAPPER: 'fixed left-0 top-0 min-w-max z-50 pointer-events-none',
	TOOLTIP_CONTENT: 'px-2 py-1 text-xs font-normal font-ui leading-tight rounded-md shadow-md text-white bg-black/80 backdrop-blur break-words max-w-[13rem]',

	// Layout helpers
	FLEX_CENTER: 'flex items-center justify-center',
	FLEX_BETWEEN: 'flex items-center justify-between',
	FLEX_GAP_2: 'flex items-center gap-2',
};

// Component creators
function createClaudeButton(content, variant = 'primary', onClick = null, contentIsHTML = false) {
	const button = document.createElement('button');

	switch (variant) {
		case 'primary':
			button.className = CLAUDE_STYLES.BTN_PRIMARY;
			break;
		case 'secondary':
			button.className = CLAUDE_STYLES.BTN_SECONDARY;
			break;
		case 'icon':
			button.className = CLAUDE_STYLES.ICON_BTN;
			contentIsHTML = true; // Always use innerHTML for icon variant
			break;
		default:
			button.className = CLAUDE_STYLES.BTN_PRIMARY;
	}

	if (contentIsHTML) {
		button.innerHTML = content;
	} else {
		button.textContent = content;
	}

	if (onClick) button.onclick = onClick;
	return button;
}

function createClaudeModal({ title, content, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel' }) {
	const backdrop = document.createElement('div');
	backdrop.className = CLAUDE_STYLES.MODAL_BACKDROP;

	const modal = document.createElement('div');
	modal.className = CLAUDE_STYLES.MODAL_CONTAINER;

	if (title) {
		const heading = document.createElement('h2');
		heading.className = CLAUDE_STYLES.MODAL_HEADING;
		heading.textContent = title;
		modal.appendChild(heading);
	}

	// Content area
	const contentDiv = document.createElement('div');
	contentDiv.className = 'mb-4';
	if (typeof content === 'string') {
		contentDiv.innerHTML = content;
	} else {
		contentDiv.appendChild(content);
	}
	modal.appendChild(contentDiv);

	// Buttons
	const buttonContainer = document.createElement('div');
	buttonContainer.className = 'flex justify-end gap-2';

	if (onCancel) {
		const cancelBtn = createClaudeButton(cancelText, 'secondary');
		cancelBtn.onclick = () => {
			backdrop.remove();
			onCancel();
		};
		buttonContainer.appendChild(cancelBtn);
	}

	if (onConfirm) {
		const confirmBtn = createClaudeButton(confirmText, 'primary');
		confirmBtn.onclick = () => {
			backdrop.remove();
			onConfirm();
		};
		buttonContainer.appendChild(confirmBtn);
	}

	modal.appendChild(buttonContainer);
	backdrop.appendChild(modal);

	// Close on backdrop click
	backdrop.onclick = (e) => {
		if (e.target === backdrop) {
			backdrop.remove();
			if (onCancel) onCancel();
		}
	};

	return backdrop;
}

function createClaudeInput({ type = 'text', placeholder = '', value = '', onChange = null } = {}) {
	const input = document.createElement('input');
	input.type = type;
	input.className = CLAUDE_STYLES.INPUT;
	input.placeholder = placeholder;
	input.value = value;

	if (onChange) {
		input.addEventListener('input', onChange);
	}

	return input;
}

function createClaudeSelect(options, selectedValue = '', onChange = null) {
	const select = document.createElement('select');
	select.className = CLAUDE_STYLES.SELECT;

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
	container.className = CLAUDE_STYLES.FLEX_GAP_2;

	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.className = CLAUDE_STYLES.CHECKBOX;
	checkbox.checked = checked;

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
	toggleWrapper.appendChild(toggleContainer);

	container.appendChild(toggleWrapper);

	// Add label text if provided
	if (labelText) {
		const label = document.createElement('span');
		label.className = 'text-text-100 select-none cursor-pointer';
		label.style.transform = 'translateY(-3px)'; // Slight upward adjustment
		label.textContent = labelText;
		label.onclick = () => input.click(); // Make label clickable
		container.appendChild(label);
	}

	return { container, input, toggle: toggleContainer };
}

function createClaudeTooltip(element, tooltipText) {
	// Create tooltip wrapper
	const tooltipWrapper = document.createElement('div');
	tooltipWrapper.className = CLAUDE_STYLES.TOOLTIP_WRAPPER;
	tooltipWrapper.style.display = 'none';
	tooltipWrapper.setAttribute('data-radix-popper-content-wrapper', '');

	// Add tooltip content
	const tooltipContent = document.createElement('div');
	tooltipContent.className = CLAUDE_STYLES.TOOLTIP_CONTENT + ' tooltip-content'; // Keep the extra class if needed
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

	// Add hover events to element
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

	// Rest stays the same...
	// Hide on click if element is clickable
	const originalOnclick = element.onclick;
	if (originalOnclick) {
		element.onclick = (e) => {
			tooltipWrapper.style.display = 'none';
			return originalOnclick.call(element, e);
		};
	}

	document.body.appendChild(tooltipWrapper);

	// Clean up tooltip when element is removed
	const originalRemove = element.remove.bind(element);
	element.remove = () => {
		tooltipWrapper.remove();
		originalRemove();
	};

	return tooltipWrapper;
}


function tryAddTopRightButton(buttonClass, createButtonFn) {
	const BUTTON_PRIORITY = [
		'tts-settings-button',
		'style-selector-button',
		'stt-settings-button',
		'export-button'
	];

	const container = document.querySelector('div.right-3:has(> div.flex > button)') || document.querySelector('div.right-3:has(> button)')
	if (!container || container.querySelectorAll("button").length == 0) {
		return false;
	}

	let madeChanges = false;

	// Add button if it doesn't exist
	if (!container.querySelector('.' + buttonClass)) {
		const button = createButtonFn();
		button.classList.add(buttonClass);
		container.appendChild(button);
		madeChanges = true;
	}

	// Check if reordering is needed
	const currentButtons = Array.from(container.querySelectorAll('button'));

	// Build desired order
	const priorityButtons = [];
	for (const className of BUTTON_PRIORITY) {
		const button = container.querySelector('.' + className);
		if (button) {
			priorityButtons.push(button);
		}
	}

	const nonPriorityButtons = currentButtons.filter(btn =>
		!BUTTON_PRIORITY.some(className => btn.classList.contains(className))
	);

	const desiredOrder = [...priorityButtons, ...nonPriorityButtons];

	// Only reorder if the current order doesn't match desired order
	const needsReordering = currentButtons.length !== desiredOrder.length ||
		!currentButtons.every((btn, index) => btn === desiredOrder[index]);

	if (needsReordering) {
		desiredOrder.forEach(button => {
			container.appendChild(button);
		});
		madeChanges = true;
	}

	return madeChanges;
}

function findMessageControls(messageElement) {
	const group = messageElement.closest('.group');
	const buttons = group?.querySelectorAll('button');
	if (!buttons) return null;
	const copyButton = group.querySelector('[data-testid="action-bar-copy"]');
	return copyButton?.closest('.justify-between');
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