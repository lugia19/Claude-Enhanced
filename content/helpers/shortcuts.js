// shortcuts.js
// Centralized keyboard shortcut management for Claude.ai extension
// No IIFE - runs in shared global context (ISOLATED only)

class ShortcutManager {
	constructor() {
		if (ShortcutManager.instance) {
			return ShortcutManager.instance;
		}
		ShortcutManager.instance = this;

		this.registry = {}; // Active shortcuts: { 'stt-toggle': shortcutConfig, ... }
		this.storageKey = 'shortcut_registry';

		// Set up global keydown listener
		document.addEventListener('keydown', (event) => {
			this._handleKeydown(event);
		});
	}

	/**
	 * Register an action to listen for shortcuts
	 * Loads the shortcut from storage if it exists
	 * @param {string} actionId - Unique identifier for the action (e.g., 'stt-toggle')
	 */
	async register(actionId) {
		const shortcuts = await this._loadShortcuts();
		this.registry[actionId] = shortcuts[actionId] || null;
	}

	/**
	 * Get the current shortcut for an action
	 * @param {string} actionId - The action identifier
	 * @returns {Object|null} Shortcut config or null
	 */
	async getShortcut(actionId) {
		const shortcuts = await this._loadShortcuts();
		return shortcuts[actionId] || null;
	}

	/**
	 * Set/update a shortcut for an action
	 * @param {string} actionId - The action identifier
	 * @param {Object|null} shortcut - Shortcut config with {key, ctrlKey, altKey, shiftKey, metaKey} or null to clear
	 */
	async setShortcut(actionId, shortcut) {
		const shortcuts = await this._loadShortcuts();

		if (shortcut === null) {
			delete shortcuts[actionId];
		} else {
			shortcuts[actionId] = shortcut;
		}

		await this._saveShortcuts(shortcuts);
		this.registry[actionId] = shortcut;
	}

	/**
	 * Load all shortcuts from storage
	 * @private
	 */
	async _loadShortcuts() {
		return new Promise((resolve) => {
			chrome.storage.local.get([this.storageKey], (result) => {
				resolve(result[this.storageKey] || {});
			});
		});
	}

	/**
	 * Save all shortcuts to storage
	 * @private
	 */
	async _saveShortcuts(shortcuts) {
		return new Promise((resolve) => {
			chrome.storage.local.set({ [this.storageKey]: shortcuts }, resolve);
		});
	}

	/**
	 * Handle keydown events and check against registered shortcuts
	 * @private
	 */
	_handleKeydown(event) {
		for (const [actionId, shortcut] of Object.entries(this.registry)) {
			if (this._matchesShortcut(event, shortcut)) {
				window.postMessage({
					type: 'shortcut',
					action: actionId
				}, '*');
				event.preventDefault();
				break; // Only trigger one shortcut per keypress
			}
		}
	}

	/**
	 * Check if a keyboard event matches a shortcut config
	 * @private
	 */
	_matchesShortcut(event, shortcut) {
		if (!shortcut || event.key !== shortcut.key) return false;
		if (event.ctrlKey !== shortcut.ctrlKey) return false;
		if (event.altKey !== shortcut.altKey) return false;
		if (event.shiftKey !== shortcut.shiftKey) return false;
		if (event.metaKey !== shortcut.metaKey) return false;
		return true;
	}
}

// Create singleton instance
const shortcutManager = new ShortcutManager();

/**
 * Creates a shortcut recorder UI component
 * @param {Object} currentShortcut - Current shortcut config or null
 * @param {Function} onSave - Callback when shortcut is recorded
 * @returns {HTMLElement} The shortcut recorder container
 */
function createShortcutRecorder(currentShortcut, onSave) {
	const container = document.createElement('div');
	container.className = 'mb-4';

	const label = document.createElement('label');
	label.className = CLAUDE_CLASSES.LABEL;
	label.textContent = 'Keyboard Shortcut';
	container.appendChild(label);

	// Display current shortcut
	const displayBox = document.createElement('div');
	displayBox.className = CLAUDE_CLASSES.INPUT + ' mb-2 font-mono';
	displayBox.style.cursor = 'default';

	function updateDisplay(shortcut) {
		if (!shortcut) {
			displayBox.textContent = 'Not set';
			displayBox.style.color = '#999';
			return;
		}

		const parts = [];
		if (shortcut.ctrlKey) parts.push('Ctrl');
		if (shortcut.altKey) parts.push('Alt');
		if (shortcut.shiftKey) parts.push('Shift');
		if (shortcut.metaKey) parts.push('Meta');
		parts.push(shortcut.key.toUpperCase());

		displayBox.textContent = parts.join(' + ');
		displayBox.style.color = '';
	}

	updateDisplay(currentShortcut);
	container.appendChild(displayBox);

	// Record button row
	const buttonRow = document.createElement('div');
	buttonRow.className = CLAUDE_CLASSES.FLEX_GAP_2;

	let isRecording = false;
	let recordedShortcut = null;

	const recordBtn = createClaudeButton('Record', 'secondary');
	const clearBtn = createClaudeButton('Clear', 'secondary');

	recordBtn.onclick = () => {
		if (isRecording) return;

		isRecording = true;
		recordBtn.textContent = 'Press any key...';
		recordBtn.disabled = true;
		displayBox.textContent = 'Waiting...';
		displayBox.style.color = '#999';

		const captureKey = (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Ignore modifier-only presses
			if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
				return;
			}

			recordedShortcut = {
				key: e.key,
				ctrlKey: e.ctrlKey,
				altKey: e.altKey,
				shiftKey: e.shiftKey,
				metaKey: e.metaKey
			};

			updateDisplay(recordedShortcut);
			if (onSave) onSave(recordedShortcut);

			document.removeEventListener('keydown', captureKey, true);
			isRecording = false;
			recordBtn.textContent = 'Record';
			recordBtn.disabled = false;
		};

		document.addEventListener('keydown', captureKey, true);
	};

	clearBtn.onclick = () => {
		recordedShortcut = null;
		updateDisplay(null);
		if (onSave) onSave(null);
	};

	buttonRow.appendChild(recordBtn);
	buttonRow.appendChild(clearBtn);
	container.appendChild(buttonRow);

	return container;
}
