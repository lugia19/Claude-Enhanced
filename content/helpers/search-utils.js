// claude-search-shared.js
(function () {
	'use strict';

	// ======== HELPERS ========
	window.ClaudeSearchShared = window.ClaudeSearchShared || {};

	window.ClaudeSearchShared.getRelativeTime = function (timestamp) {
		const now = Date.now();
		const messageTime = new Date(timestamp).getTime();
		const diff = now - messageTime;

		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);
		const weeks = Math.floor(days / 7);
		const months = Math.floor(days / 30);
		const years = Math.floor(days / 365);

		if (years > 0) return `${years}y ago`;
		if (months > 0) return `${months}mo ago`;
		if (weeks > 0) return `${weeks}w ago`;
		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (minutes > 0) return `${minutes}m ago`;
		return 'just now';
	};

	window.ClaudeSearchShared.simplifyText = function (text) {
		return text
			.toLowerCase()
			.replace(/[*_`~\[\]()]/g, '')  // Remove markdown chars
			.replace(/\s+/g, ' ')           // Normalize whitespace
			.replace(/[""'']/g, '"')        // Normalize quotes
			.trim();
	};

	window.ClaudeSearchShared.fuzzyMatch = function (searchText, targetText) {
		// Get words from search text (ignore very short words)
		const searchWords = searchText
			.toLowerCase()
			.split(/\s+/)
			.filter(word => word.length > 2);

		const targetLower = targetText.toLowerCase();

		// Count how many search words appear in target
		const matchedWords = searchWords.filter(word => targetLower.includes(word));

		const matchRatio = matchedWords.length / searchWords.length;
		return matchRatio >= 0.85;
	};

	// ======== INDEXEDDB MANAGEMENT ========
	const db = new Dexie('ClaudeSearchDB');

	db.version(1).stores({
		metadata: 'uuid',
		messages: 'uuid'
	});

	// One-time migration: delete old databases
	async function deleteOldDatabases() {
		try {
			await Dexie.delete('claudeSearchIndex');
			console.log('[DB] Deleted old database: claudeSearchIndex');
		} catch (e) {
			// Doesn't exist, that's fine
		}
	}

	deleteOldDatabases();

	class SearchDatabase {
		constructor() {
			// No initialization needed! Dexie handles it.
		}

		async setMetadata(conversationObj) {
			await db.metadata.put(conversationObj);
		}

		async getMetadata(conversationId) {
			return await db.metadata.get(conversationId);
		}

		async getAllMetadata() {
			return await db.metadata.toArray();
		}

		async setMessages(conversationId, messages) {
			// Extract searchable text only
			const searchableText = messages
				.map(m => ClaudeConversation.extractMessageText(m))
				.join('\n');

			await db.messages.put({
				uuid: conversationId,
				searchableText: searchableText
			});
		}

		async getMessages(conversationId) {
			const result = await db.messages.get(conversationId);
			return result ? result.searchableText : null;
		}

		async getAllMessages() {
			return await db.messages.toArray();
		}

		async deleteConversation(conversationId) {
			await Promise.all([
				db.metadata.delete(conversationId),
				db.messages.delete(conversationId)
			]);
		}
	}



	// Global database instance
	window.ClaudeSearchShared.searchDB = new SearchDatabase();
})();