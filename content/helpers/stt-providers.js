// stt-providers.js
(function () {
	'use strict';

	// ======== ABSTRACT BASE CLASS ========
	class STTProvider {
		constructor(apiKey) {
			this.apiKey = apiKey;
		}

		static async validateApiKey(apiKey) {
			throw new Error('validateApiKey must be implemented by subclass');
		}

		static isAvailable() {
			throw new Error('isAvailable must be implemented by subclass');
		}

		async startRecording(deviceId) {
			throw new Error('startRecording must be implemented by subclass');
		}

		async stopRecording() {
			throw new Error('stopRecording must be implemented by subclass');
		}

		static async validateApiKey(apiKey) {
			throw new Error('validateApiKey must be implemented by subclass');
		}
	}

	// ======== GROQ PROVIDER ========
	class GroqSTTProvider extends STTProvider {
		constructor(apiKey) {
			super(apiKey);
			this.mediaRecorder = null;
			this.audioChunks = [];
			this.audioStream = null;
		}

		static async validateApiKey(apiKey) {
			try {
				const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${apiKey}`
					},
					body: new FormData()
				});
				return response.status === 400 || response.status === 200;
			} catch (error) {
				return false;
			}
		}

		static isAvailable() {
			return true;
		}

		async startRecording(deviceId) {
			const constraints = {
				audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } }
			};

			try {
				this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
			} catch (error) {
				// Fallback to default device if specified device fails
				if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
					console.log('Selected device not available, falling back to default');
					this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
				} else {
					throw error;
				}
			}

			this.mediaRecorder = new MediaRecorder(this.audioStream, {
				mimeType: 'audio/webm'
			});

			this.audioChunks = [];

			this.mediaRecorder.ondataavailable = (event) => {
				this.audioChunks.push(event.data);
			};

			this.mediaRecorder.start();
		}

		async stopRecording() {
			if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
				return '';
			}

			return new Promise((resolve, reject) => {
				this.mediaRecorder.onstop = async () => {
					try {
						const transcription = await this._transcribe();
						this._cleanup();
						resolve(transcription);
					} catch (error) {
						this._cleanup();
						reject(error);
					}
				};

				this.mediaRecorder.stop();
			});
		}

		async _transcribe() {
			if (!this.apiKey) {
				throw new Error('API key required');
			}

			const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
			const formData = new FormData();
			formData.append('file', audioBlob, 'recording.webm');
			formData.append('model', 'whisper-large-v3-turbo');
			formData.append('temperature', '0');
			formData.append('response_format', 'text');

			const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.apiKey}`
				},
				body: formData
			});

			if (!response.ok) {
				throw new Error('Transcription failed');
			}

			return await response.text();
		}

		_cleanup() {
			if (this.audioStream) {
				this.audioStream.getTracks().forEach(track => track.stop());
				this.audioStream = null;
			}
			this.audioChunks = [];
			this.mediaRecorder = null;
		}
	}

	// ======== OPENAI PROVIDER ========
	class OpenAISTTProvider extends STTProvider {
		constructor(apiKey) {
			super(apiKey);
			this.mediaRecorder = null;
			this.audioChunks = [];
			this.audioStream = null;
		}

		static async validateApiKey(apiKey) {
			try {
				const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${apiKey}`
					},
					body: new FormData()
				});
				// OpenAI returns 400 for bad request (missing file), 401 for bad auth
				return response.status === 400 || response.status === 200;
			} catch (error) {
				return false;
			}
		}

		static isAvailable() {
			return true;
		}

		async startRecording(deviceId) {
			const constraints = {
				audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } }
			};

			try {
				this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
			} catch (error) {
				// Fallback to default device if specified device fails
				if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
					console.log('Selected device not available, falling back to default');
					this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
				} else {
					throw error;
				}
			}

			this.mediaRecorder = new MediaRecorder(this.audioStream, {
				mimeType: 'audio/webm'
			});

			this.audioChunks = [];

			this.mediaRecorder.ondataavailable = (event) => {
				this.audioChunks.push(event.data);
			};

			this.mediaRecorder.start();
		}

		async stopRecording() {
			if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
				return '';
			}

			return new Promise((resolve, reject) => {
				this.mediaRecorder.onstop = async () => {
					try {
						const transcription = await this._transcribe();
						this._cleanup();
						resolve(transcription);
					} catch (error) {
						this._cleanup();
						reject(error);
					}
				};

				this.mediaRecorder.stop();
			});
		}

		async _transcribe() {
			if (!this.apiKey) {
				throw new Error('API key required');
			}

			const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
			const formData = new FormData();
			formData.append('file', audioBlob, 'recording.webm');
			formData.append('model', 'gpt-4o-mini-transcribe');
			formData.append('response_format', 'text');

			const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.apiKey}`
				},
				body: formData
			});

			if (!response.ok) {
				throw new Error('Transcription failed');
			}

			return await response.text();
		}

		_cleanup() {
			if (this.audioStream) {
				this.audioStream.getTracks().forEach(track => track.stop());
				this.audioStream = null;
			}
			this.audioChunks = [];
			this.mediaRecorder = null;
		}
	}

	// ======== BROWSER PROVIDER ========
	class BrowserSTTProvider extends STTProvider {
		constructor() {
			super(null); // No API key needed
			this.recognition = null;
			this.audioStream = null;
			this.transcriptParts = []; // Accumulate text chunks
		}

		static async validateApiKey(apiKey) {
			return true; // No key needed
		}

		static isAvailable() {
			return !!(window.SpeechRecognition);
		}

		async startRecording(deviceId) {
			const SpeechRecognition = window.SpeechRecognition;

			if (!SpeechRecognition) {
				throw new Error('Speech Recognition not supported');
			}

			// Get audio stream for device selection (for MST support)
			const constraints = {
				audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } }
			};

			try {
				this.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
			} catch (error) {
				if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
					console.log('Selected device not available, falling back to default');
					this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
				} else {
					throw error;
				}
			}

			const audioTrack = this.audioStream.getAudioTracks()[0];

			this.recognition = new SpeechRecognition();
			this.recognition.continuous = true; // Keep listening until manually stopped
			this.recognition.interimResults = false; // Only final results (no partial transcriptions)
			this.recognition.lang = 'en-US';

			this.transcriptParts = [];

			// Accumulate transcription results
			this.recognition.onresult = (event) => {
				for (let i = event.resultIndex; i < event.results.length; i++) {
					if (event.results[i].isFinal) {
						const transcript = event.results[i][0].transcript;
						this.transcriptParts.push(transcript);
					}
				}
			};

			// Try MediaStreamTrack support, fallback to default mic
			try {
				this.recognition.start(audioTrack);
			} catch (err) {
				console.warn('MediaStreamTrack not supported, using default mic');
				this.recognition.start();
			}
		}

		async stopRecording() {
			if (!this.recognition) {
				return '';
			}

			return new Promise((resolve, reject) => {
				this.recognition.onend = () => {
					// Join all accumulated text parts
					const fullTranscript = this.transcriptParts.join(' ');
					this._cleanup();
					resolve(fullTranscript);
				};

				this.recognition.onerror = (event) => {
					this._cleanup();
					reject(new Error(event.error));
				};

				this.recognition.stop();
			});
		}

		_cleanup() {
			if (this.audioStream) {
				this.audioStream.getTracks().forEach(track => track.stop());
				this.audioStream = null;
			}
			this.recognition = null;
			this.transcriptParts = [];
		}
	}

	// Update exports
	window.STTProvider = STTProvider;
	window.GroqSTTProvider = GroqSTTProvider;
	window.OpenAISTTProvider = OpenAISTTProvider;
	window.BrowserSTTProvider = BrowserSTTProvider;
})();