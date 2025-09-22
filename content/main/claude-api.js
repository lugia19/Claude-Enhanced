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
			personalizedStyles = null,
			waitMinutes = 2
		} = options;

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

		// Wait for assistant response
		return await this.waitForAssistantMessage(waitMinutes);
	}

	// Wait for assistant message
	async waitForAssistantMessage(maxMinutes = 2) {
		const maxRetries = Math.floor((maxMinutes * 60) / 10);

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			await new Promise(r => setTimeout(r, 10000));

			console.log(`Checking for assistant response in ${this.conversationId} (attempt ${attempt + 1}/${maxRetries})...`);

			const messages = await this.getMessages();
			const assistantMessage = messages.find(msg => msg.sender === 'assistant');

			if (assistantMessage) {
				console.log('Found assistant response');
				return assistantMessage;
			}
		}

		throw new Error(`No assistant response after ${maxMinutes} minutes`);
	}

	// Get all messages
	async getMessages() {
		const response = await fetch(
			`/api/organizations/${this.orgId}/chat_conversations/${this.conversationId}?tree=False&rendering_mode=messages&render_all_tools=true`
		);

		if (!response.ok) {
			throw new Error('Failed to get messages');
		}

		const data = await response.json();
		return data.chat_messages || [];
	}

	// Get conversation details
	async getDetails() {
		const response = await fetch(
			`/api/organizations/${this.orgId}/chat_conversations/${this.conversationId}?tree=False&rendering_mode=messages&render_all_tools=true`
		);

		if (!response.ok) {
			throw new Error('Failed to get conversation details');
		}

		return await response.json();
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
		let text = '';
		if (!message.content) return text;

		for (const content of message.content) {
			if (content.text) text += content.text;
			if (content.content?.text) text += content.content.text;
			if (content.input?.code) text += content.input.code;
		}
		return text;
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
	return uploadResult.file_uuid;
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