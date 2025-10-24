// claude_api.js

class ClaudeConversation {
	constructor(orgId, conversationId = null) {
		this.orgId = orgId;
		this.conversationId = conversationId;
		this.created = conversationId ? true : false;
	}

	// Create a new conversation
	async create(name, model = null, projectUuid = null, paprikaMode = false) {
		if (this.conversationId) {
			throw new Error('Conversation already exists');
		}

		this.conversationId = this.generateUuid();
		const bodyJSON = {
			uuid: this.conversationId,
			name: name,
			include_conversation_preferences: true,
			project_uuid: projectUuid,
		};

		if (model) bodyJSON.model = model;
		if (paprikaMode) bodyJSON.paprika_mode = "extended";

		const response = await fetch(`/api/organizations/${this.orgId}/chat_conversations`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(bodyJSON)
		});

		if (!response.ok) {
			throw new Error('Failed to create conversation');
		}

		this.created = true;
		return this.conversationId;
	}

	// Send a message and wait for response
	async sendMessageAndWaitForResponse(prompt, options = {}) {
		const {
			model = null,
			parentMessageUuid = '00000000-0000-4000-8000-000000000000',
			attachments = [],
			files = [],
			syncSources = [],
			personalizedStyles = null
		} = options;

		const waitMinutes = 4;
		// Build the request body dynamically
		const requestBody = {
			prompt,
			parent_message_uuid: parentMessageUuid,
			attachments,
			files,
			sync_sources: syncSources,
			personalized_styles: personalizedStyles,
			rendering_mode: "messages"
		};

		// Only add model if it's not null
		if (model !== null) {
			requestBody.model = model;
		}

		// Send the message
		const response = await fetch(`/api/organizations/${this.orgId}/chat_conversations/${this.conversationId}/completion`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(requestBody)
		});

		if (!response.ok) {
			console.error(await response.json());
			throw new Error('Failed to send message');
		}

		// Wait for completion using the new status endpoint
		await this.waitForCompletion(waitMinutes);

		// Now fetch the actual assistant message
		let messages = await this.getMessages(false, true);
		let assistantMessage = messages.find(msg => msg.sender === 'assistant');

		// Retry once if not found
		if (!assistantMessage) {
			console.log('Assistant message not found, waiting 10 seconds and retrying...');
			await new Promise(r => setTimeout(r, 10000));
			messages = await this.getMessages(false, true);
			assistantMessage = messages.find(msg => msg.sender === 'assistant');
		}

		if (!assistantMessage) {
			throw new Error('Completion finished but no assistant message found after retry');
		}

		return assistantMessage;
	}

	// Wait for completion using the status endpoint
	async waitForCompletion(maxMinutes = 2) {
		const maxRetries = Math.floor((maxMinutes * 60) / 5); // Check every 5 seconds
		const pollInterval = 5000; // 5 seconds

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			await new Promise(r => setTimeout(r, pollInterval));

			console.log(`Checking completion status for ${this.conversationId} (attempt ${attempt + 1}/${maxRetries})...`);

			const response = await fetch(
				`/api/organizations/${this.orgId}/chat_conversations/${this.conversationId}/completion_status?poll=false`
			);

			if (!response.ok) {
				throw new Error('Failed to check completion status');
			}

			const status = await response.json();

			// Check for errors
			if (status.is_error) {
				throw new Error(`Completion error: ${status.error_detail || status.error_code || 'Unknown error'}`);
			}

			// Check if complete
			if (!status.is_pending) {
				console.log('Completion finished');
				return;
			}
		}

		throw new Error(`Completion timed out after ${maxMinutes} minutes`);
	}

	// Lazy load conversation data
	async getData(tree = false, forceRefresh = false) {
		if (!this.conversationData || forceRefresh || (tree && !this.conversationData.chat_messages)) {
			const response = await fetch(
				`/api/organizations/${this.orgId}/chat_conversations/${this.conversationId}?tree=${tree}&rendering_mode=messages&render_all_tools=true`
			);
			if (!response.ok) {
				throw new Error('Failed to get conversation data');
			}
			this.conversationData = await response.json();
		}
		return this.conversationData;
	}

	// Get messages (now uses getData)
	async getMessages(tree = false, forceRefresh = false) {
		const data = await this.getData(tree, forceRefresh);
		return data.chat_messages || [];
	}

	// Find longest leaf from a message ID
	findLongestLeaf(startMessageId) {
		const messageMap = new Map();
		for (const msg of this.conversationData.chat_messages) {
			messageMap.set(msg.uuid, msg);
		}

		// Get all children of the message we're starting from
		const children = Array.from(messageMap.values()).filter(
			msg => msg.parent_message_uuid === startMessageId
		);
		// No children -> it's a leaf, just return
		if (children.length === 0) {
			const message = messageMap.get(startMessageId);
			return {
				leafId: startMessageId,
				depth: 0,
				timestamp: new Date(message.created_at).getTime()
			};
		}

		let longestPath = { leafId: null, depth: -1, timestamp: 0 };
		// For each child, find its longest leaf (recursion)
		for (const child of children) {
			const result = this.findLongestLeaf(child.uuid);
			const totalDepth = result.depth + 1;	//Account for the fact we're looking at the parent of this message
			// If this path is longer than the previous longest, or same length but newer, update
			if (totalDepth > longestPath.depth ||
				(totalDepth === longestPath.depth && result.timestamp > longestPath.timestamp)) {
				longestPath = {
					leafId: result.leafId,
					depth: totalDepth,
					timestamp: result.timestamp
				};
			}
		}

		return longestPath;
	}

	// Navigate to a specific leaf
	async setCurrentLeaf(leafId) {
		const url = `/api/organizations/${this.orgId}/chat_conversations/${this.conversationId}/current_leaf_message_uuid`;

		const response = await fetch(url, {
			method: 'PUT',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ current_leaf_message_uuid: leafId })
		});

		if (!response.ok) {
			throw new Error('Failed to set current leaf');
		}
	}

	// Delete conversation
	async delete() {
		const response = await fetch(`/api/organizations/${this.orgId}/chat_conversations/${this.conversationId}`, {
			method: 'DELETE'
		});

		if (!response.ok) {
			console.error('Failed to delete conversation');
		}
	}

	// Extract text from message content
	static extractMessageText(message) {
		if (!message.content) return '';

		const textPieces = [];

		function extractFromContent(content) {
			if (content.text) {
				textPieces.push(content.text);
			}
			if (content.input) {
				textPieces.push(JSON.stringify(content.input));
			}
			if (content.content) {
				// Handle nested content array
				if (Array.isArray(content.content)) {
					for (const nestedContent of content.content) {
						extractFromContent(nestedContent);
					}
				}
				// Handle single nested content object
				else if (typeof content.content === 'object') {
					extractFromContent(content.content);
				}
			}
		}

		// Process all content items in the message
		for (const content of message.content) {
			extractFromContent(content);
		}

		return textPieces.join('\n');
	}

	generateUuid() {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
			const r = Math.random() * 16 | 0;
			const v = c === 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	}
}



// Account settings management
async function getAccountSettings() {
	const response = await fetch('/api/account');
	if (!response.ok) {
		throw new Error('Failed to fetch account settings');
	}
	return await response.json();
}

async function updateAccountSettings(settings) {
	const response = await fetch('/api/account', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ settings })
	});
	if (!response.ok) {
		throw new Error('Failed to update account settings');
	}
	return await response.json();
}

// File operations
async function uploadFile(orgId, file) {
	const formData = new FormData();
	formData.append('file', file.data, file.name);
	const response = await fetch(`/api/${orgId}/upload`, {
		method: 'POST',
		body: formData
	});

	if (!response.ok) {
		throw new Error(`Failed to upload file ${file.name}`);
	}

	const uploadResult = await response.json();
	return uploadResult;
}

async function downloadFile(url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download from ${url}`);
	}
	return await response.blob();
}

// Sync source processing
async function processSyncSource(orgId, syncsource) {
	const response = await fetch(`/api/organizations/${orgId}/sync/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			sync_source_config: syncsource?.config,
			sync_source_type: syncsource?.type
		})
	});

	if (!response.ok) {
		console.error(`Failed to process sync source: ${response.statusText}`);
		return null;
	}

	const result = await response.json();
	return result.uuid;
}

// Check if user is pro/free
async function getUserType(orgId) {
	const response = await fetch(`/api/bootstrap/${orgId}/statsig`, {
		method: 'GET',
		headers: { 'Content-Type': 'application/json' },
	});

	if (!response.ok) {
		console.error('Failed to fetch user type');
		return 'unknown';
	}

	const data = await response.json();
	const orgType = data?.user?.custom?.orgType;
	return orgType === 'claude_free' ? 'free' : 'pro';
}

// UUID generator
function generateUuid() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
		const r = Math.random() * 16 | 0;
		const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
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

function getConversationId() {
	const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
	return match ? match[1] : null;
}