# Privacy and data handling

## Existing Max for Live device

MIDIjourney sends only the information needed to generate MIDI through Pollinations:

- the current written instruction;
- selected MIDI notes and basic clip information when remixing a clip;
- recent creative history only when **History** is enabled; and
- generation settings such as model and temperature.

The visible history is saved per MIDIjourney device inside the Live Set through a hidden Stored-Only Max parameter and is capped at the 100 most recent messages. It remains available when History is disabled, but it is not included as model context. Clearing history removes both the saved visible entries and their reusable context. Restoring saved history does not start a generation.

MIDIjourney does not intentionally log prompt bodies, generated responses, history content, personal authorization tokens, or complete account records. Diagnostic messages are limited to safe event names, timings, provider status categories, and model identifiers.

Browser authorization uses the official SDK's device-code flow and produces a scoped Pollinations user token. When Pollinations recognizes MIDIjourney's configured publishable App Key, MIDIjourney sends it as the OAuth `clientId` so authorization can be attributed to this app. If Pollinations definitively reports the configured key as unregistered, the device leaves that key unchanged and uses the SDK's registered device client; login and generation still work, but the session is not attributed to MIDIjourney for app earnings. The publishable identifier is distinct from the personal user token returned after consent. On macOS the user token is passed to Keychain through standard input rather than the child process argument list. On Windows it is encrypted for the current user with DPAPI. If secure persistence is unavailable, authorization is kept only for the current session. User tokens are not stored in Live Sets, Max dictionaries, prompt history, or the AMXD. The minimal header has no separate account menu. Closing the device cancels generation without deleting the saved authorization.

The embedded device panel requests only the available balance for its account display. It does not request a profile, display a name or avatar, or download/cache a profile image. These balance requests do not send your musical prompts. The balance stays a display, including at zero. The separate **↗** button opens the Pollinations dashboard in your browser at any balance; it uses the browser's existing session and does not transmit the device token, purchase credits automatically, or change MIDIjourney's configured app key.

Account controls live in the bottom device panel, not in the floating Create window. **Connect** starts browser authorization and becomes a passive **Connected** label. There is no Disconnect button. Moving these controls does not clear saved authorization, sign out your browser, remove prompt history, or change the configured app key.

For a transient HTTP 408, 429, or provider 5xx response, MIDIjourney may send the same generation request one additional time after a short, bounded delay. Canceling generation or disconnecting aborts that retry path. Authorization, balance, cancellation, and invalid-response failures are not retried automatically. Retries never switch models.

Pollinations processes generation requests and applies its own terms and privacy policy. Users should avoid putting confidential or personally identifying information in musical prompts.

## Experimental browser / Ableton Extensions app

The separate `web/` prototype uses the shared Pollinations UI and SDK's browser OAuth and normal browser-local token storage, not the Max device-code/keychain flow described above. Its account menu requests profile and usage permissions to display the signed-in account and balance. It does not import the existing Max user token or change the app key.

When running inside Live, Connect opens the system browser for provider sign-in and passkeys. The user confirms the displayed browser account before attaching it to Live. The SDK performs OAuth/PKCE and exchanges the authorization code; a capability-protected, ten-minute loopback handoff transfers the resulting session to the SDK in Live. The server's temporary in-memory copy is cleared after acknowledgement, cancellation, expiry or editor close. Tokens are not included in browser URLs, launch arguments or logs. Browser and Live keep their own normal SDK local session storage; signing out in one does not automatically revoke the other.

Browser history is a separate bounded, credential-redacted localStorage archive. Recent entries are included in subsequent generation requests; the prototype's History control opens the archive and is not a context on/off toggle. Nothing in this prototype clears or migrates history saved inside existing Live Sets.

The optional browser **Technical log** keeps the latest 30 generation calls in window memory only. It includes requested/reported model identifiers, provider-reported token counts, elapsed time, status/finish reason and validated musical output details (up to 128 notes per call). It does not retain credentials, headers, input prompt bodies, account/auth requests or malformed response text. It is not written to localStorage, saved in Live Sets or transmitted elsewhere. Light/dark preference is saved separately by the shared UI package.

The extension serves only its built UI and captured MIDI context over a loopback-only HTTP server. Host and cross-site context checks restrict browser access. There are no HTTP endpoints for modifying Live. Creating a clip requires the actual SDK webview's message handler; only musical clip data crosses that bridge, not tokens, profile information or the prompt archive. The SDK adapter revalidates MIDI before creating a clip and never overwrites the source.

The browser verification fixtures use fake accounts/responses only and are excluded from production builds. They cover local login delivery, cancellation and account confirmation. Real browser-to-Live session delivery and authenticated balance access were also observed on 2026-09-13. Fresh logged-out OAuth, webview persistence and Live-hosted MIDI acceptance still require further testing.
