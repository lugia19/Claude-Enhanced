// pref-switcher.js
(function () {
	'use strict';

	// Listen for messages from the fetch watcher
	window.addEventListener('message', async (event) => {
		if (event.data.type === 'pref-switcher-external-update') {
			console.log('Detected external preferences update, refreshing UI...');
			setTimeout(async () => {
				const select = document.querySelector('.preset-switcher-dropdown select');
				if (select) {
					await updateDropdownOptions(select);
				}
			}, 500);
		}
	});

	// ======== API FUNCTIONS ========
	async function getCurrentPreferences() {
		try {
			const response = await fetch('https://claude.ai/api/account_profile', {
				method: 'GET'
			});
			const data = await response.json();
			return data.conversation_preferences || '';
		} catch (error) {
			console.error('Failed to fetch preferences:', error);
			return '';
		}
	}

	async function setPreferences(preferencesText) {
		try {
			const response = await fetch('https://claude.ai/api/account_profile?source=preset-manager', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					conversation_preferences: preferencesText
				})
			});

			if (response.ok) {
				// Manually trigger the UI update since our fetch won't go through the interceptor
				window.postMessage({
					type: 'pref-switcher-external-update'
				}, '*');
			}

			return response.ok;
		} catch (error) {
			console.error('Failed to set preferences:', error);
			return false;
		}
	}

	function showPrompt(title, placeholder = '') {
		return new Promise((resolve) => {
			const input = createClaudeInput({
				type: 'text',
				placeholder: placeholder
			});

			const modal = new ClaudeModal(title, input);

			modal.addCancel('Cancel', () => {
				resolve(null);
			});

			modal.addConfirm('OK', () => {
				resolve(input.value.trim() || null);
			});

			// Override backdrop click to resolve with null
			modal.backdrop.onclick = (e) => {
				if (e.target === modal.backdrop) {
					modal.hide();
					resolve(null);
				}
			};

			modal.show();

			// Focus input after modal is shown
			setTimeout(() => input.focus(), 0);

			// Add keyboard handlers
			input.onkeydown = (e) => {
				if (e.key === 'Enter') {
					resolve(input.value.trim() || null);
					modal.hide();
				}
				if (e.key === 'Escape') {
					resolve(null);
					modal.hide();
				}
			};
		});
	}

	function showConfirm(message) {
		return new Promise((resolve) => {
			const messageEl = document.createElement('p');
			messageEl.className = 'text-text-100';
			messageEl.textContent = message;

			const modal = new ClaudeModal('', messageEl);

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

	// ======== PRESET MANAGEMENT ========
	async function getStoredPresets() {
		const result = await chrome.storage.local.get('preference_presets');
		const presets = result.preference_presets || {};
		// Ensure "None" preset always exists
		if (!presets['None']) {
			presets['None'] = {
				name: 'None',
				content: '',
				lastModified: Date.now()
			};
		}
		return presets;
	}

	async function savePreset(name, content) {
		const presets = await getStoredPresets();
		presets[name] = {
			name: name,
			content: content,
			lastModified: Date.now()
		};
		await chrome.storage.local.set({ preference_presets: presets });
	}

	async function getCurrentPresetName() {
		const currentPrefs = await getCurrentPreferences();
		const presets = await getStoredPresets();

		// Check if current preferences match any stored preset
		for (const [name, preset] of Object.entries(presets)) {
			if (preset.content === currentPrefs) {
				return name;
			}
		}

		// If no match and preferences are not empty, return "Unsaved"
		return currentPrefs ? 'Unsaved' : 'None';
	}

	// ======== UI COMPONENTS ========
	function createPresetDropdown() {
		const container = document.createElement('div');
		container.className = 'relative w-full';

		const select = document.createElement('select');
		select.className = `preset-selector text-text-100 transition-colors cursor-pointer appearance-none 
        w-full h-8 px-3 pr-8 rounded-md bg-bg-000 border border-border-300 hover:border-border-200 text-sm`;

		// Add temporary loading option
		const loadingOption = document.createElement('option');
		loadingOption.value = '__loading';
		loadingOption.textContent = 'Preset: Loading...';
		select.appendChild(loadingOption);

		// Add dropdown arrow
		const arrowContainer = document.createElement('div');
		arrowContainer.className = 'pointer-events-none absolute top-0 right-0 flex items-center px-2 text-text-500 h-8';
		arrowContainer.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 20 20">
            <path d="M14.128 7.16482C14.3126 6.95983 14.6298 6.94336 14.835 7.12771C15.0402 7.31242 15.0567 7.62952 14.8721 7.83477L10.372 12.835L10.2939 12.9053C10.2093 12.9667 10.1063 13 9.99995 13C9.85833 12.9999 9.72264 12.9402 9.62788 12.835L5.12778 7.83477L5.0682 7.75273C4.95072 7.55225 4.98544 7.28926 5.16489 7.12771C5.34445 6.96617 5.60969 6.95939 5.79674 7.09744L5.87193 7.16482L9.99995 11.7519L14.128 7.16482Z"/>
        </svg>
    `;

		container.appendChild(select);
		container.appendChild(arrowContainer);

		// Set up change handler
		select.addEventListener('change', async () => {
			const selectedPreset = select.value;

			if (selectedPreset === '__unsaved' || selectedPreset === '__loading') {
				// Don't do anything for these special options
				return;
			}

			const presets = await getStoredPresets();
			const preset = presets[selectedPreset];

			if (preset) {
				const success = await setPreferences(preset.content);
				if (!success) {
					// Revert selection on failure
					await updateDropdownOptions(select);
				}
			}
		});

		// Initial population
		updateDropdownOptions(select);

		return container;
	}

	async function updateDropdownOptions(select) {
		const presets = await getStoredPresets();
		const currentPresetName = await getCurrentPresetName();

		// Store current selection
		const previousValue = select.value;

		// Clear and rebuild options
		select.innerHTML = '';

		// Add Unsaved option if needed
		if (currentPresetName === 'Unsaved') {
			const option = document.createElement('option');
			option.value = '__unsaved';
			option.textContent = 'Preset: Unsaved';
			select.appendChild(option);
		}

		// Add all stored presets
		for (const name of Object.keys(presets)) {
			const option = document.createElement('option');
			option.value = name;
			option.textContent = `Preset: ${name}`;
			select.appendChild(option);
		}

		// Set current selection
		if (currentPresetName === 'Unsaved') {
			select.value = '__unsaved';
		} else {
			select.value = currentPresetName;
		}
	}

	// ======== SIDEBAR INJECTION ========
	async function findSidebarContainers() {
		const sidebarNav = document.querySelector('nav.flex');
		if (!sidebarNav) {
			return null;
		}

		const containerWrapper = sidebarNav.querySelector('.flex.flex-grow.flex-col.overflow-y-auto');
		const mainContainer = containerWrapper?.querySelector('.transition-all.duration-200');
		if (!mainContainer) {
			return null;
		}

		// Look for the Starred section
		const starredSection = mainContainer.querySelector('div.flex.flex-col.mb-6');
		// Check if the Recents section exists as the next sibling
		let recentsSection = null;
		if (starredSection) {
			recentsSection = starredSection.nextElementSibling;
		} else {
			recentsSection = mainContainer.firstChild;
		}

		if (!recentsSection) {
			return null;
		}

		return {
			container: mainContainer,
			starredSection: starredSection,
			recentsSection: recentsSection
		};
	}

	function createPresetSection() {
		const section = document.createElement('div');
		section.className = 'flex flex-col mb-6 preset-switcher-section';

		// Header
		const header = document.createElement('div');
		header.className = 'sticky bg-gradient-to-b from-bg-200 from-50% to-bg-200/40 px-1.5';
		header.style.paddingBottom = '0.5rem';
		header.style.zIndex = '9999';

		const title = document.createElement('h3');
		title.textContent = 'Preferences Switcher';
		title.className = 'text-text-300 flex items-center gap-1.5 text-xs select-none z-10';
		createClaudeTooltip(title, 'Changing preferences will reset the caching status of the conversation');

		header.appendChild(title);

		// Content
		const content = document.createElement('div');
		content.className = 'flex min-h-0 flex-col pl-2';
		content.style.paddingRight = '0.25rem';

		const dropdown = createPresetDropdown();
		dropdown.classList.add('preset-switcher-dropdown');
		content.appendChild(dropdown);

		section.appendChild(header);
		section.appendChild(content);

		return section;
	}

	// ======== SETTINGS PAGE INTEGRATION ========
	async function findSettingsTextarea() {
		const textarea = document.getElementById('conversation-preferences');
		if (!textarea) return null;

		// Find the parent container (div.group.relative)
		const container = textarea.closest('.group.relative');
		if (!container) return null;

		// Check if we've already processed this
		if (container.dataset.presetManagerProcessed) return null;

		return { textarea, container };
	}

	function createSettingsUI() {
		const container = document.createElement('div');
		container.className = 'preset-manager-settings';

		container.innerHTML = `
        <div class="flex flex-col gap-4">
            <!-- Preset selector row -->
            <div class="flex gap-2 items-end">
                <div class="flex-1">
                    <label class="text-text-200 mb-1 block text-sm">Active Preset</label>
                    <div class="relative">
                        <select class="preset-selector text-text-100 transition-colors cursor-pointer appearance-none w-full h-9 px-3 pr-8 rounded-[0.6rem] bg-bg-000 border border-border-300 hover:border-border-200">
                            <option value="__loading">Loading...</option>
                        </select>
                        <div class="pointer-events-none absolute top-0 right-0 flex items-center px-2 text-text-500 h-9">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M14.128 7.16482C14.3126 6.95983 14.6298 6.94336 14.835 7.12771C15.0402 7.31242 15.0567 7.62952 14.8721 7.83477L10.372 12.835L10.2939 12.9053C10.2093 12.9667 10.1063 13 9.99995 13C9.85833 12.9999 9.72264 12.9402 9.62788 12.835L5.12778 7.83477L5.0682 7.75273C4.95072 7.55225 4.98544 7.28926 5.16489 7.12771C5.34445 6.96617 5.60969 6.95939 5.79674 7.09744L5.87193 7.16482L9.99995 11.7519L14.128 7.16482Z"/>
                            </svg>
                        </div>
                    </div>
                </div>
                <button class="new-preset-btn inline-flex items-center justify-center relative shrink-0 
                    text-text-000 font-base-bold border-0.5 border-border-200 
                    bg-bg-300/0 hover:bg-bg-400 transition duration-100
                    h-9 px-4 py-2 rounded-lg min-w-[5rem]">
                    New Preset
                </button>
            </div>
            
            <!-- Preset content editor -->
            <div>
                <label class="text-text-200 mb-1 block text-sm">Preset Content</label>
                <div class="grid">
                    <textarea class="preset-content bg-bg-000 border border-border-300 p-3 leading-5 rounded-[0.6rem] transition-colors hover:border-border-200 placeholder:text-text-500 resize-none w-full" 
                        rows="6" 
                        placeholder="Enter your preferences here..."
                        data-1p-ignore="true"></textarea>
                </div>
            </div>
            
            <!-- Action buttons -->
            <div class="flex gap-3 justify-end">
                <button class="delete-preset-btn inline-flex items-center justify-center relative shrink-0 
                    text-text-000 font-base-bold border-0.5 border-border-200 
                    bg-bg-300/0 hover:bg-bg-400 transition duration-100
                    h-9 px-4 py-2 rounded-lg min-w-[5rem]
                    disabled:pointer-events-none disabled:opacity-50">
                    Delete
                </button>
                <button class="save-preset-btn inline-flex items-center justify-center relative shrink-0 
                    bg-text-000 text-bg-000 font-base-bold 
                    hover:bg-text-100 transition duration-100
                    h-9 px-4 py-2 rounded-lg min-w-[5rem]">
                    Save Changes
                </button>
            </div>
        </div>
    `;

		// Set up event handlers
		setupSettingsEventHandlers(container);

		return container;
	}

	async function setupSettingsEventHandlers(container) {
		const selector = container.querySelector('.preset-selector');
		const contentArea = container.querySelector('.preset-content');
		const saveBtn = container.querySelector('.save-preset-btn');
		const deleteBtn = container.querySelector('.delete-preset-btn');
		const newBtn = container.querySelector('.new-preset-btn');

		// Load presets into selector
		await updatePresetSelector(selector, contentArea);

		// Handle preset selection change
		selector.addEventListener('change', async () => {
			const presetName = selector.value;
			if (presetName === '__unsaved') {
				const currentPrefs = await getCurrentPreferences();
				contentArea.value = currentPrefs;
				deleteBtn.disabled = true;
			} else {
				const presets = await getStoredPresets();
				const preset = presets[presetName];
				if (preset) {
					contentArea.value = preset.content;
					// Disable delete button for "None" preset
					deleteBtn.disabled = (presetName === 'None');

					// Apply the preset immediately (like the sidebar does)
					await setPreferences(preset.content);
				}
			}
		});

		// Save button
		saveBtn.addEventListener('click', async () => {
			const presetName = selector.value;
			const content = contentArea.value;

			if (presetName === '__unsaved') {
				// Prompt for new name
				const name = await showPrompt('Enter a name for this preset:', 'Preset name');
				if (!name) return;

				await savePreset(name, content);
				await updatePresetSelector(selector, contentArea);
				selector.value = name;
			} else {
				// Update existing preset
				await savePreset(presetName, content);
			}

			// Apply the preferences (without source param to trigger sidebar update)
			await setPreferences(content);

			// Show success feedback
			saveBtn.textContent = 'Saved!';
			saveBtn.style.background = 'rgb(34, 197, 94)'; // Green color
			setTimeout(() => {
				saveBtn.textContent = 'Save Changes';
				saveBtn.style.background = ''; // Reset to default
			}, 2000);
		});

		// Delete button
		deleteBtn.addEventListener('click', async () => {
			const presetName = selector.value;
			if (presetName === 'None' || presetName === '__unsaved') return;

			if (await showConfirm(`Delete preset "${presetName}"?`)) {
				const presets = await getStoredPresets();
				delete presets[presetName];
				await chrome.storage.local.set({ preference_presets: presets });

				// Switch to None preset
				await setPreferences('');
				await updatePresetSelector(selector, contentArea);
				selector.value = 'None';
				contentArea.value = '';
			}
		});

		// New preset button
		newBtn.addEventListener('click', async () => {
			const name = await showPrompt('Enter a name for the new preset:', 'Preset name');
			if (!name || name === "") return;

			await savePreset(name, '');
			await updatePresetSelector(selector, contentArea);
			selector.value = name;
			contentArea.value = '';
			contentArea.focus();
		});
	}

	async function updatePresetSelector(selector, contentArea) {
		const presets = await getStoredPresets();
		const currentPresetName = await getCurrentPresetName();

		// Clear and rebuild options
		selector.innerHTML = '';

		// Add Unsaved option if needed
		if (currentPresetName === 'Unsaved') {
			const option = document.createElement('option');
			option.value = '__unsaved';
			option.textContent = 'Unsaved';
			selector.appendChild(option);
		}

		// Add all stored presets
		for (const name of Object.keys(presets)) {
			const option = document.createElement('option');
			option.value = name;
			option.textContent = name;
			selector.appendChild(option);
		}

		// Set current selection
		if (currentPresetName === 'Unsaved') {
			selector.value = '__unsaved';
			const currentPrefs = await getCurrentPreferences();
			contentArea.value = currentPrefs;
		} else {
			selector.value = currentPresetName;
			const preset = presets[currentPresetName];
			if (preset) {
				contentArea.value = preset.content;
			}
		}
	}

	async function tryInjectSettingsUI() {
		const elements = await findSettingsTextarea();
		if (!elements) return;

		const { textarea, container } = elements;

		// Hide the original container
		container.style.display = 'none';
		container.dataset.presetManagerProcessed = 'true';

		// Create and insert our UI
		const settingsUI = createSettingsUI();
		container.parentNode.insertBefore(settingsUI, container);

		console.log('Settings UI injected');
	}

	async function tryInjectUI() {
		// Check if already injected
		if (document.querySelector('.preset-switcher-section')) {
			return;
		}

		const containers = await findSidebarContainers();
		if (!containers) {
			return;
		}

		const presetSection = createPresetSection();

		// Insert between starred and recents (or at the beginning)
		if (containers.starredSection) {
			containers.container.insertBefore(presetSection, containers.starredSection);
		} else {
			containers.container.insertBefore(presetSection, containers.recentsSection);
		}
	}

	// ======== INITIALIZATION ========
	function initialize() {
		// Try to inject the settings UI immediately
		tryInjectSettingsUI();
		setInterval(tryInjectSettingsUI, 1000);

		setTimeout(() => {
			tryInjectUI();
			setInterval(tryInjectUI, 1000);
		}, 5000);

		// Also listen for navigation changes
		let lastPath = window.location.pathname;
		setInterval(() => {
			if (window.location.pathname !== lastPath) {
				lastPath = window.location.pathname;
				setTimeout(() => {
					tryInjectUI();
					tryInjectSettingsUI();
				}, 500);
			}
		}, 1000);

		// Handle tab visibility changes for multi-tab sync
		document.addEventListener('visibilitychange', async () => {
			if (!document.hidden) {
				console.log('Tab became visible, checking for preference changes...');

				// Update sidebar dropdown if present
				const sidebarSelect = document.querySelector('.preset-switcher-dropdown select');
				if (sidebarSelect) {
					const currentValue = sidebarSelect.value;
					await updateDropdownOptions(sidebarSelect);
					const newValue = sidebarSelect.value;

					if (currentValue !== newValue) {
						console.log(`Preset changed from "${currentValue}" to "${newValue}"`);
					}
				}

				// Update settings UI if present
				const settingsSelect = document.querySelector('.preset-manager-settings .preset-selector');
				const settingsContent = document.querySelector('.preset-manager-settings .preset-content');
				if (settingsSelect && settingsContent) {
					await updatePresetSelector(settingsSelect, settingsContent);
				}
			}
		});
	}

	// Start the script
	setTimeout(initialize);
})();