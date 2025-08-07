chrome.runtime.onInstalled.addListener(async () => {
	// List your userscripts here
	const userscripts = [
		'claude-exporter.user.js',
		'claude-typing-replacement.user.js',
		'claude-forking.user.js'
	];

	const registrations = [
		// Content bridge for storage API
		{
			id: 'content-bridge',
			matches: ['https://claude.ai/*'],
			js: ['content-bridge.js'],
			world: 'ISOLATED',
			runAt: 'document_start'
		},
		// All userscripts
		...userscripts.map(script => ({
			id: script.replace('.js', ''),
			matches: ['https://claude.ai/*'],
			js: [`userscripts/${script}`],
			world: 'MAIN',
			runAt: 'document_idle'
		}))
	];

	// Clear existing and register new
	try {
		const existing = await chrome.scripting.getRegisteredContentScripts();
		if (existing.length > 0) {
			await chrome.scripting.unregisterContentScripts();
		}

		await chrome.scripting.registerContentScripts(registrations);
		console.log(`Registered ${userscripts.length} userscripts`);
	} catch (error) {
		console.error('Failed to register scripts:', error);
	}
});