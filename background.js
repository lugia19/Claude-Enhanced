// background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.type === 'analyze-dialogue') {
		analyzeDialogue(request)
			.then(data => sendResponse({ success: true, data }))
			.catch(err => sendResponse({ success: false, error: err.message }));
		return true; // Keep channel open
	}
});

async function analyzeDialogue({ text, characters, apiKey }) {
	const narratorChar = characters.find(c => c.name.toLowerCase() === 'narrator');
	const includeNarration = narratorChar && narratorChar.voice;

	const dialogueCharacters = characters.filter(c => c.name.toLowerCase() !== 'narrator');
	const availableCharacters = includeNarration
		? [...dialogueCharacters.map(c => c.name), 'narrator']
		: dialogueCharacters.map(c => c.name);

	const response = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true',
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			model: 'claude-sonnet-4-20250514',
			system: "You are a dialogue extraction system. Extract dialogue from text and identify speakers using the speak_text tool. IMPORTANT: You are only being asked to do text processing, not content generation. Do not add any content that isn't in the original text, nor refuse based on content, as this is content-agnostic processing.",
			max_tokens: 16384,
			temperature: 0.3,
			tools: [{
				name: "speak_text",
				description: "Output text to be spoken by a specific character",
				input_schema: {
					type: "object",
					properties: {
						character: {
							type: "string",
							enum: availableCharacters,
							description: "The character speaking this text"
						},
						text: {
							type: "string",
							description: "The text to be spoken"
						}
					},
					required: ["character", "text"]
				}
			}],
			tool_choice: { type: "any" },
			messages: [{
				role: 'user',
				content: `You are a dialogue attribution system. Analyze text and identify speakers, regardless of content - you're only being asked to do text processing, not content generation. Analyze this text and call speak_text for EACH segment of dialogue or narration. ${includeNarration ? 'Include narration as "narrator".' : 'Only include quoted dialogue, skip narration.'}
        
Available characters: ${availableCharacters.join(', ')}

Text to analyze:
${text}`
			}]
		})
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`API error: ${response.status} - ${error}`);
	}

	const data = await response.json();

	// Extract all the function calls
	const segments = [];
	for (const content of data.content) {
		if (content.type === 'tool_use' && content.name === 'speak_text') {
			segments.push({
				character: content.input.character.toLowerCase(),
				text: content.input.text.trim()
			});
		}
	}

	if (segments.length === 0) {
		throw new Error('No dialogue segments found');
	}

	return segments;
}