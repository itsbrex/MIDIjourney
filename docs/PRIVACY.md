# Privacy and data handling

MIDI Journey sends your written message, the currently selected MIDI clip's basic metadata/notes, and bounded recent conversation context to Pollinations when you press Send. It does not send audio or your entire Live Set. Pollinations and its model providers process the request under their own policies.

## Login

The shared `@pollinations/sdk` owns OAuth/PKCE, account state, and browser-local session storage. The shared `@pollinations/ui` account menu displays profile and balance with profile/usage permissions.

Inside Live, login opens the system browser for passkeys and provider sign-in. After you confirm the account, a capability-protected, ten-minute loopback handoff supplies the resulting session to the SDK in Live. The transport's temporary token is cleared after acknowledgement, cancellation, expiry, or server shutdown. User tokens are not placed in URLs, process arguments, Max dictionaries, Live Sets, the AMXD, or Git.

The embedded browser and system browser keep separate SDK sessions. Signing out in one does not automatically sign out the other. Closing the editor keeps the local session for reopening; it does not revoke access. Account revocation is available through Pollinations.

The publishable app key identifies this app; it is not a personal account token. Normal builds reuse the existing approved key and never create, rotate, or revoke one.

## Conversation and copies

The current chat is saved in embedded-browser localStorage, bounded to 30 exchanges and 3 million serialized characters. This includes prompts, MIDI, model/token metadata and bounded original response text. Older turns may be dropped to stay within the limit. Storage failures are reported; reopening does not send a request or create a clip.

**New chat** cancels active generation and clears the app's conversation, draft and creative context. It does not remove clips, sign out, or erase older device versions' saved history.

There is no response-copy control or visible technical-details panel. Original provider messages are retained only in bounded local call diagnostics: messages larger than 512,000 characters are not retained, and credential-like text is redacted. They are not automatically sent to Max logs.

Prompt Copy/Paste uses the embedded browser's native right-click menu, with a 12,000-character prompt limit. There is no custom OS clipboard transport or clipboard polling. Clipboard text and provider response bodies are not printed in app logs.

The app makes one bounded retry for certain transient provider failures; it never switches models or retries Live writes automatically. A timeout after a Live write requires checking the clip before trying again.

## Local connector

The server binds only to loopback and checks Host, method and authentication capability for the browser handoff. It serves bundled assets and a minimal read-only connection/destination status. There is no HTTP endpoint for creating clips or reading the clipboard. Actual MIDI changes require the embedded Max message bridge and validated data.

UI test fixtures use fake accounts and responses and are not bundled. Light/dark preference is stored separately by the UI package. Avoid putting confidential information in musical prompts even though credential-like values are redacted.
