# Claude QoL Extension

This extension adds a bunch of QOL/Utility features to claude.ai, like Search, Navigation, TTS, STT, forking, exporting, etc.

Available on:
- [Firefox (Desktop+Mobile)](https://addons.mozilla.org/en-US/firefox/addon/claude-qol/)
- [Chrome](https://chromewebstore.google.com/detail/claude-toolbox/dkdnancajokhfclpjpplkhlkbhaeejob)
- The desktop client - Via [Claude-WebExtension-Launcher](https://github.com/lugia19/Claude-WebExtension-Launcher)

# Features

## Forking
<img width="614" height="696" alt="image" src="https://github.com/user-attachments/assets/45a5f08e-baef-41f1-8d8c-7b89f5f30eb1" />

Allows you to start a new chat by forking an existing one. The new chat will include all the content of the old one up to that point (or a summary of the content up to that point) and optionally any attachments.

## Search
<img width="710" height="298" alt="image" src="https://github.com/user-attachments/assets/fb240eca-68ac-4236-81b1-b6fbbdcd28a4" />

Allows you to search for text in the entire chat, including all branches.

## Navigation
<img width="546" height="423" alt="image" src="https://github.com/user-attachments/assets/f8fc08dc-bdd0-4798-9dd8-b9656574defb" />

Lets you save points in the conversation tree and navigate back to them.

## Speech to text
<img width="428" height="364" alt="image" src="https://github.com/user-attachments/assets/8db85861-6644-487d-aea0-93ab29b468b7" />
<img width="741" height="93" alt="image" src="https://github.com/user-attachments/assets/6c77a230-e71f-46cf-b024-f5e97045cf93" />

Uses groq (You have to provide your own API key) to recognize speech from your microphone and send it as text.

## Text to speech
<img width="432" height="650" alt="image" src="https://github.com/user-attachments/assets/b30136e6-1903-466b-95b8-13d0fa9879b8" />

Uses elevenlabs (bring your own key) to speak messages out loud. Includes options for auto-speaking.

### Actor mode
<img width="853" height="515" alt="image" src="https://github.com/user-attachments/assets/076f5827-6e0f-496c-8219-f30b3662010c" />

This allows you to assign text from specific characters to specific voices.

## Exporting and importing
<img width="543" height="575" alt="image" src="https://github.com/user-attachments/assets/90b01918-e0c9-4551-a266-94a544f0509b" />

You can export a chat to various formats. Txt, JSON, etc.

You can also IMPORT a chat from a Txt format export, and it will appear as though all the messages are actually there.

## Preferences switcher
<img width="269" height="80" alt="image" src="https://github.com/user-attachments/assets/ce6583f6-3d28-43cc-bd89-3ab0b98d93e0" />
<img width="878" height="384" alt="image" src="https://github.com/user-attachments/assets/910abd61-a311-4a45-ac58-20eb23c058f0" />

Adds a dropdown to the sidebar to let you switch between different preferences. You can create/edit presets in the settings.

## Style selector
<img width="440" height="220" alt="image" src="https://github.com/user-attachments/assets/e90642a6-1780-4418-8f9c-74ad6f2140ed" />

Allows you to set a style for a given chat, which will take precedence over the global style.
