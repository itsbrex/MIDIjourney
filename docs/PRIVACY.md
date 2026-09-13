# Privacy and data handling

MIDIjourney sends only the information needed to generate MIDI through Pollinations:

- the current written instruction;
- selected MIDI notes and basic clip information when remixing a clip;
- recent creative history only when **History** is enabled; and
- generation settings such as model and temperature.

The visible history is saved per MIDIjourney device inside the Live Set through a hidden Stored-Only Max parameter and is capped at the 100 most recent messages. It remains available when History is disabled, but it is not included as model context. Clearing history removes both the saved visible entries and their reusable context. Restoring saved history does not start a generation.

MIDIjourney does not intentionally log prompt bodies, generated responses, history content, personal authorization tokens, or complete account records. Diagnostic messages are limited to safe event names, timings, provider status categories, and model identifiers.

Browser authorization uses the official SDK's device-code flow and produces a scoped Pollinations user token. When Pollinations recognizes MIDIjourney's configured publishable App Key, MIDIjourney sends it as the OAuth `clientId` so authorization can be attributed to this app. If Pollinations definitively reports the configured key as unregistered, the device leaves that key unchanged and uses the SDK's registered device client; login and generation still work, but the session is not attributed to MIDIjourney for app earnings. The publishable identifier is distinct from the personal user token returned after consent. On macOS the user token is passed to Keychain through standard input rather than the child process argument list. On Windows it is encrypted for the current user with DPAPI. If secure persistence is unavailable, authorization is kept only for the current session. User tokens are not stored in Live Sets, Max dictionaries, prompt history, or the AMXD. Clicking the device's **Connected** button cancels any active generation, disconnects, and removes the locally saved authorization.

For a transient HTTP 408, 429, or provider 5xx response, MIDIjourney may send the same generation request one additional time after a short, bounded delay. Canceling generation or disconnecting aborts that retry path. Authorization, balance, cancellation, and invalid-response failures are not retried automatically.

Pollinations processes generation requests and applies its own terms and privacy policy. Users should avoid putting confidential or personally identifying information in musical prompts.
