// ==UserScript==
// @name         Claude Chat Exporter
// @namespace    lugia19.com
// @match        https://claude.ai/*
// @version      2.0.0
// @author       lugia19
// @license      GPLv3
// @description  Allows exporting chat conversations from claude.ai.
// @grant        none
// ==/UserScript==

(function () {
	'use strict';

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function createExportButton() {
		const button = document.createElement('button');
		button.className = `inline-flex items-center justify-center relative shrink-0 ring-offset-2 ring-offset-bg-300 
			ring-accent-main-100 focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none 
			disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none text-text-200 border-transparent 
			transition-colors font-styrene active:bg-bg-400 hover:bg-bg-500/40 hover:text-text-100 h-9 w-9 
			rounded-md active:scale-95 shrink-0`;
		
		button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 16 16">
			<path d="M8 12V2m0 10 5-5m-5 5L3 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
			<path opacity="0.4" d="M2 15h12v-3H2v3Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
		</svg>`;

		// Add tooltip wrapper div
		const tooltipWrapper = document.createElement('div');
		tooltipWrapper.setAttribute('data-radix-popper-content-wrapper', '');
		tooltipWrapper.style.cssText = `
			position: fixed;
			left: 0px;
			top: 0px;
			min-width: max-content;
			--radix-popper-transform-origin: 50% 0px;
			z-index: 50;
			display: none;
		`;

		// Add tooltip content
		tooltipWrapper.innerHTML = `
			<div data-side="bottom" data-align="center" data-state="delayed-open" 
				class="px-2 py-1 text-xs font-medium font-sans leading-tight rounded-md shadow-md text-white bg-black/80 backdrop-blur break-words z-tooltip max-w-[13rem]">
				Export chatlog
				<span role="tooltip" style="position: absolute; border: 0px; width: 1px; height: 1px; padding: 0px; margin: -1px; overflow: hidden; clip: rect(0px, 0px, 0px, 0px); white-space: nowrap; overflow-wrap: normal;">
					Export chatlog
				</span>
			</div>
		`;

		// Add hover events
		button.addEventListener('mouseenter', () => {
			tooltipWrapper.style.display = 'block';
			const rect = button.getBoundingClientRect();
			const tooltipRect = tooltipWrapper.getBoundingClientRect();
			const centerX = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
			tooltipWrapper.style.transform = `translate(${centerX}px, ${rect.bottom + 5}px)`;
		});

		button.addEventListener('mouseleave', () => {
			tooltipWrapper.style.display = 'none';
		});
		
		button.onclick = async () => {
			// Show format selection modal
			const format = await showFormatModal();
			if (!format) return;

			const messages = await getMessages();
			const conversationId = getConversationId();
			const filename = `Claude_export_${conversationId}.${format}`;
			const content = formatExport(messages, format);
			downloadFile(filename, content);
		};
		
		// Add tooltip to document
		document.body.appendChild(tooltipWrapper);

		return button;
	}
	
	async function showFormatModal() {
		// Create and show a modal similar to Claude's style
		const modal = document.createElement('div');
		modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
		
		modal.innerHTML = `
			<div class="bg-bg-100 rounded-lg p-6 shadow-xl max-w-sm w-full mx-4 border border-border-300">
				<h3 class="text-lg font-semibold mb-4 text-text-100">Export Format</h3>
				<select class="w-full p-2 rounded mb-4 bg-bg-200 text-text-100 border border-border-300">
					<option value="txt">Text (.txt)</option>
					<option value="jsonl">JSONL (.jsonl)</option>
				</select>
				<div class="flex justify-end gap-2">
					<button class="px-4 py-2 text-text-200 hover:bg-bg-500/40 rounded" id="cancelExport">Cancel</button>
					<button class="px-4 py-2 bg-accent-main-100 text-oncolor-100 rounded" id="confirmExport">Export</button>
				</div>
			</div>
		`;

		document.body.appendChild(modal);

		return new Promise((resolve) => {
			const select = modal.querySelector('select');
			
			modal.querySelector('#cancelExport').onclick = () => {
				modal.remove();
				resolve(null);
			};

			modal.querySelector('#confirmExport').onclick = () => {
				const format = select.value;
				modal.remove();
				resolve(format);
			};

			modal.onclick = (e) => {
				if (e.target === modal) {
					modal.remove();
					resolve(null);
				}
			};
		});
	}
	
	
	function getOrgId() {
		const cookies = document.cookie.split(';');
		for (const cookie of cookies) {
			const [name, value] = cookie.trim().split('=');
			if (name === 'lastActiveOrg') {
				return value;
			}
		}
		throw new Error('Could not find organization ID');
	}

	async function getMessages() {
		const conversationId = getConversationId();
		if (!conversationId) {
			throw new Error('Not in a conversation');
		}

		const orgId = getOrgId();

		const response = await fetch(`/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=False&rendering_mode=messages&render_all_tools=true`);
		const conversationData = await response.json();

		const messages = [];

		for (const message of conversationData.chat_messages) {
			let messageContent = [];

			for (const content of message.content) {
				if (content.text) {
					messageContent.push(content.text);
				}
				if (content.input?.code) {
					messageContent.push(content.input.code);
				}
				if (content.content?.text) {
					messageContent.push(content.content.text);
				}
			}

			messages.push({
				role: message.role === 'human' ? 'user' : 'assistant',
				content: messageContent.join(' ')
			});
		}

		return messages;
	}

	function formatExport(messages, format) {
		switch (format) {
			case 'txt':
				return messages.map(msg => {
					const role = msg.role === 'user' ? 'User' : 'Assistant';
					return `[${role}]\n${msg.content}\n`;
				}).join('\n');
			case 'jsonl':
				return messages.map(JSON.stringify).join('\n');
			default:
				throw new Error(`Unsupported format: ${format}`);
		}
	}

	function downloadFile(filename, content) {
		const blob = new Blob([content], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}

	function initialize() {
		// Try to add the button immediately
		tryAddButton();
		
		// Also check every 5 seconds
		setInterval(tryAddButton, 5000);
	}

	function tryAddButton() {
		const container = document.querySelector('.right-3 .right-4 .hidden');
		if (!container || container.querySelector('.export-button')) {
			return; // Either container not found or button already exists
		}

		const exportButton = createExportButton();
		exportButton.classList.add('export-button'); // Add class to check for existence
		container.appendChild(exportButton);
	}

	initialize();
})();