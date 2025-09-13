// claude-styles.js
// Shared style utilities for Claude.ai extension
// No IIFE - runs in shared global context

const claudeStyleMap = {
	// Icon buttons (top bar and message controls)
	'claude-icon-btn': 'inline-flex items-center justify-center relative shrink-0 ring-offset-2 ring-offset-bg-300 ring-accent-main-100 focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none text-text-200 border-transparent transition-colors font-styrene active:bg-bg-400 hover:bg-bg-500/40 hover:text-text-100 h-9 w-9 rounded-md active:scale-95',

	// Modal backdrop
	'claude-modal-backdrop': 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50',

	// Modal content box
	'claude-modal': 'bg-bg-100 rounded-lg p-6 shadow-xl max-w-md w-full mx-4 border border-border-300',

	// Primary button (white action buttons)
	'claude-btn-primary': 'inline-flex items-center justify-center px-4 py-2 font-base-bold bg-text-000 text-bg-000 rounded hover:bg-text-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[5rem] h-9',

	// Secondary button (cancel/neutral buttons)
	'claude-btn-secondary': 'inline-flex items-center justify-center px-4 py-2 hover:bg-bg-500/40 rounded transition-colors min-w-[5rem] h-9 text-text-000 font-base-bold border-0.5 border-border-200',

	// Select dropdown
	'claude-select': 'w-full p-2 rounded bg-bg-200 text-text-100 border border-border-300 hover:border-border-200 cursor-pointer',

	// Checkbox
	'claude-checkbox': 'mr-2 rounded border-border-300 accent-accent-main-100',

	// Text input
	'claude-input': 'w-full p-2 rounded bg-bg-200 text-text-100 border border-border-300 hover:border-border-200',

	// Tooltip wrapper (positioned absolutely)
	'claude-tooltip': 'fixed left-0 top-0 min-w-max z-50 pointer-events-none',

	// Tooltip content
	'claude-tooltip-content': 'px-2 py-1 text-xs font-normal font-ui leading-tight rounded-md shadow-md text-white bg-black/80 backdrop-blur break-words max-w-[13rem]',

	// Modal section headings
	'claude-modal-heading': 'text-lg font-semibold mb-4 text-text-100',

	// Modal section text/labels
	'claude-modal-text': 'text-sm text-text-400',

	// Form label
	'claude-label': 'block text-sm font-medium text-text-200 mb-1',

	// Radio/checkbox container
	'claude-check-group': 'flex items-center text-text-100',

	// Small/fine print text
	'claude-text-sm': 'text-sm text-text-400 sm:text-[0.75rem]',

	// Toggle switch container
	'claude-toggle': 'group/switch relative select-none cursor-pointer inline-block',

	// Hidden checkbox (screen reader only)
	'claude-toggle-input': 'peer sr-only',

	// Toggle track/background
	'claude-toggle-track': 'border-border-300 rounded-full bg-bg-500 transition-colors peer-checked:bg-accent-secondary-100 peer-disabled:opacity-50',

	// Toggle thumb/circle
	'claude-toggle-thumb': 'absolute flex items-center justify-center rounded-full bg-white transition-transform group-hover/switch:opacity-80',
};

function applyClaudeStyling(element) {
	// Apply to the element itself if it has claude- classes
	const elementClasses = Array.from(element.classList || []);
	elementClasses.forEach(className => {
		if (className.startsWith('claude-') && claudeStyleMap[className]) {
			element.classList.remove(className);
			claudeStyleMap[className].split(' ').forEach(c => {
				if (c) element.classList.add(c);
			});
		}
	});

	// Find and process all child elements with claude- classes
	const elements = element.querySelectorAll('[class*="claude-"]');
	elements.forEach(el => {
		const classes = Array.from(el.classList);
		classes.forEach(className => {
			if (className.startsWith('claude-') && claudeStyleMap[className]) {
				el.classList.remove(className);
				claudeStyleMap[className].split(' ').forEach(c => {
					if (c) el.classList.add(c);
				});
			}
		});
	});
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
	tooltipWrapper.className = 'claude-tooltip';
	tooltipWrapper.style.display = 'none';
	tooltipWrapper.setAttribute('data-radix-popper-content-wrapper', '');

	// Add tooltip content
	const tooltipContent = document.createElement('div');
	tooltipContent.className = 'claude-tooltip-content tooltip-content';
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

	// Apply styling
	applyClaudeStyling(tooltipWrapper);

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

	// Hide on click if element is clickable
	const originalOnclick = element.onclick;
	if (originalOnclick) {
		element.onclick = (e) => {
			tooltipWrapper.style.display = 'none';
			return originalOnclick.call(element, e);
		};
	}

	// Add tooltip to document body
	document.body.appendChild(tooltipWrapper);

	// Clean up tooltip when element is removed
	const originalRemove = element.remove.bind(element);
	element.remove = () => {
		tooltipWrapper.remove();
		originalRemove();
	};

	// Return wrapper in case manual control is needed
	return tooltipWrapper;
}


function tryAddTopRightButton(buttonClass, createButtonFn) {
	const BUTTON_PRIORITY = [
		'tts-settings-button',
		'style-selector-button',
		'stt-settings-button',
		'export-button'
	];

	const container = document.querySelector('.md\\:absolute.md\\:right-0.md\\:top-0.z-20')
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