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
	const DB_NAME = 'claudeSearchIndex';
	const DB_VERSION = 1;
	const METADATA_STORE = 'metadata';
	const MESSAGES_STORE = 'messages';

	class SearchDatabase {
		constructor() {
			this.db = null;
		}

		async init() {
			console.log('[IndexedDB] Starting init...');

			if (this.initPromise) {
				console.log('[IndexedDB] Already initializing, waiting...');
				return this.initPromise;
			}

			if (this.db) {
				console.log('[IndexedDB] Already initialized');
				return;
			}

			this.initPromise = new Promise((resolve, reject) => {
				console.log('[IndexedDB] Opening database...');
				const request = indexedDB.open(DB_NAME, DB_VERSION);

				request.onerror = () => {
					console.error('[IndexedDB] Error:', request.error);
					this.initPromise = null;
					reject(request.error);
				};

				request.onsuccess = () => {
					console.log('[IndexedDB] Success!');
					this.db = request.result;
					this.initPromise = null;
					resolve();
				};

				request.onupgradeneeded = (event) => {
					console.log('[IndexedDB] Upgrade needed');
					const db = event.target.result;
					// Metadata store: uuid -> full conversation object from API
					if (!db.objectStoreNames.contains(METADATA_STORE)) {
						db.createObjectStore(METADATA_STORE, { keyPath: 'uuid' });
					}

					// Messages store: uuid -> compressed messages
					if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
						db.createObjectStore(MESSAGES_STORE, { keyPath: 'uuid' });
					}
				};

				request.onblocked = () => {
					console.warn('[IndexedDB] BLOCKED - close other tabs!');
				};
			});

			return this.initPromise;
		}

		async getMetadata(conversationId) {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				const transaction = this.db.transaction([METADATA_STORE], 'readonly');
				const store = transaction.objectStore(METADATA_STORE);
				const request = store.get(conversationId);

				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		}

		async getAllMetadata() {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				const transaction = this.db.transaction([METADATA_STORE], 'readonly');
				const store = transaction.objectStore(METADATA_STORE);
				const request = store.getAll();

				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		}

		async setMetadata(conversationObj) {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				const transaction = this.db.transaction([METADATA_STORE], 'readwrite');
				const store = transaction.objectStore(METADATA_STORE);
				const request = store.put(conversationObj);

				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});
		}

		async getMessages(conversationId) {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				const transaction = this.db.transaction([MESSAGES_STORE], 'readonly');
				const store = transaction.objectStore(MESSAGES_STORE);
				const request = store.get(conversationId);

				request.onsuccess = () => {
					const result = request.result;
					if (!result) {
						resolve(null);
						return;
					}

					// Decompress
					const decompressed = LZString.decompressFromUTF16(result.compressedData);
					resolve(JSON.parse(decompressed));
				};
				request.onerror = () => reject(request.error);
			});
		}

		async setMessages(conversationId, messages) {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				// Compress
				const json = JSON.stringify(messages);
				const compressed = LZString.compressToUTF16(json);

				const transaction = this.db.transaction([MESSAGES_STORE], 'readwrite');
				const store = transaction.objectStore(MESSAGES_STORE);
				const request = store.put({
					uuid: conversationId,
					compressedData: compressed
				});

				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});
		}

		async deleteConversation(conversationId) {
			if (!this.db) await this.init();
			return new Promise((resolve, reject) => {
				const transaction = this.db.transaction([METADATA_STORE, MESSAGES_STORE], 'readwrite');

				const metadataStore = transaction.objectStore(METADATA_STORE);
				const messagesStore = transaction.objectStore(MESSAGES_STORE);

				metadataStore.delete(conversationId);
				messagesStore.delete(conversationId);

				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
		}
	}

	// Global database instance
	window.ClaudeSearchShared.searchDB = new SearchDatabase();
})();