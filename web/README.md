# MIDIjourney — Pollinations UI / Ableton Extensions prototype

This is a separate, local prototype. It does not replace or rebuild the Max device.

## Architecture

- All interface components, typography, theme CSS, account controls and branding come from `@pollinations/ui`.
- `@pollinations/sdk/react` owns browser authorization and account state; `@pollinations/sdk` performs generation.
- The existing MIDI validator, prompt builder, generation client and history formatter are bundled from `../js`. There is no second model-routing implementation or model selector.
- `../extension` uses the real `@ableton-extensions/sdk` supplied in the Ableton beta download. No Max objects, Remote Scripts, guessed RPC methods or simulated Live connection are used in production code.
- The SDK opens this interface in its native webview. “Create clip & close” returns only validated musical data through its documented `close_and_send` message. The extension then creates the clip and verifies the result through the SDK.
- A standalone browser is useful for development, but cannot write to Live: the SDK message receiver must actually be present.

The app uses an unmodified, pinned snapshot of the shared UI package from the local Pollinations checkout, with its compatible SDK `5.1.0-alpha.7`. The published UI alpha is older and lacks the shared `ColorModeToggle` and dark-mode tokens. See [snapshot provenance](vendor/README.md). The Vite configuration selects the SDK's ESM entry because its `browser` entry is a global-script bundle, not an ES module. No package source is forked.

The main interface has no length control, connection badge or Pollinations brand header. Clip timing stays internal. Light/dark mode uses the package's `ColorModeToggle`, design tokens and persisted preference. The shared account menu remains available.

The compact editor puts the MIDIjourney title, theme toggle and account control in one header, with smaller shared typography/buttons and reduced panel spacing. The workspace scrolls independently below that header, so it cannot cover controls. The prompt field scales with viewport height and can also be resized vertically by its native handle. Layout checks cover widths from 390 to 1024 pixels, retained prompt text, both color modes, and no horizontal page overflow. The shared `AppHeader` hardcodes the Pollinations wordmark, so this requested app-title header composes the package's `Heading` and existing controls without replacing their visual styles.

Live's default SDK dialog dimensions are now **760 × 620** (screen size can also reflect Live's UI scaling), down from 940 × 820. The updated editor was visually verified inside Live beta 12.4.15b2 after restart. Dragging its right edge and bottom-right corner did not change the native window dimensions. SDK 1.0.0-beta.1 exposes only `showModalDialog(url, width, height)`, not a resize option or live-resize command. **The web layout is responsive, but free resizing of this native Live dialog is not implemented/supported through the available API.** Do not claim browser viewport tests prove native window resizing.

## Setup

```sh
# From the repository root:
npm --prefix web ci
node extension/scripts/setup-sdk.mjs "/path/to/extensions-sdk-1.0.0-beta.1"
npm --prefix extension ci
npm --prefix extension run build
```

The extension installs its own Node 24.16.0 runtime for the SDK CLI; system Node and the existing Max runtime are unchanged. SDK archives are local and ignored by Git. Do not publish the standalone SDK archives or its downloaded documentation as part of this repository.

### Browser preview

```sh
npm --prefix web run dev
```

Open **http://localhost:5178/**. Use `localhost`, not the numeric loopback address, because the SDK webview permits `http://localhost` and OAuth callbacks must match exactly.

The build reuses the existing publishable app identity from `js/config.release.js` / `MIDIJOURNEY_POLLINATIONS_APP_KEY`. It never creates or rotates a key. No saved Max user token is read, copied or migrated into the browser.

Before real browser sign-in, add **http://localhost:5178/** to the existing app's allowed redirect URLs in Pollinations, retaining its current callback. This registration change was not performed by the prototype build. The shared SDK uses browser OAuth, not the old device-code login.

### Run inside Ableton

1. Use the **Extensions-enabled Live Suite beta**. The installed `12.4.15b2` host was verified on macOS; the regular 12.4.5 installation lacks Extensions.
2. Stop the Vite preview so port 5178 is free.
3. Install `extension/MIDIjourney-preview.ablx` through **Settings → Extensions → Choose file**, approve the local app, then **restart Live**. Keep Developer Mode off for the installed package.
4. For development instead of a normal installation, enable Developer Mode and use the SDK CLI (the earlier CLI connection attempt was not verified; do not run both hosts together):

```sh
npm --prefix extension start -- --live "/path/to/Extensions-enabled Live Beta.app"
```

5. In a disposable test Set, right-click an empty MIDI clip slot and choose **Create with MIDIjourney**.
6. Connect through the shared Pollinations account menu, enter a prompt and generate.
7. Click **Create clip & close**. Confirm the new MIDI clip appears, its notes/length match, and Undo works.

Right-clicking an existing MIDI clip takes a snapshot for inspiration and reserves an empty slot on the same track. It never replaces the source. No free slot, an audio-track destination, a deleted/moved target, an occupied slot or duplicate submission is rejected before a destructive write. Creation and note/name changes are separate SDK undo operations; they are not advertised as one atomic transaction. A partial-write/readback error asks the user to inspect Live and Undo; it never retries the write.

## History and authorization

The SDK uses its normal browser-local authorization storage, separate from the Max OS-keychain session. The shared menu provides balance, top-up access and logout. Tokens are not sent through the Live bridge or saved in the Set. Browser/webview storage persistence across actual host restarts still needs Live-beta acceptance.

Inside Live, **Connect** opens the system browser; do not complete Google/GitHub/passkey sign-in inside Live's webview. The shared `PolliProvider` handles OAuth/PKCE and the callback in that browser. After sign-in, check the account in the shared menu and click **Connect to Ableton Live**. Keep the original editor open: it receives the session through a short-lived loopback handoff and calls the SDK's `setApiKey`. The browser shows success only after Live acknowledges delivery. No manual key entry or app-key rotation is involved.

The handoff uses separate random capabilities for the Live window and browser, expires after ten minutes, and can be canceled in Live. Credentials travel only in authenticated local HTTP bodies/responses, never URL parameters, command arguments, logs or the Set. The temporary server copy is cleared on delivery, cancellation, expiry or editor close. Only the SDK keeps its normal local session storage. Browser OAuth still uses the existing `http://localhost:5178/` callback. This is a transport adapter, not a custom OAuth implementation or a return to device-code authorization.

The browser workspace stores bounded, credential-redacted prompt/response history in `localStorage` under `midijourney:workspace:v1`. Recent history is currently included in subsequent generation requests. This prototype's History control opens the archive; it is not the Max device's context toggle. Existing Set history is neither migrated nor removed. Closing the webview before applying a result must not modify the Set.

### Optional technical log

The collapsed **Technical log** records each SDK generation call, including individual retry attempts, in memory for the current window (latest 30). It shows the reported model separately from the requested alias, provider-reported input/output/total tokens, elapsed time and status. Missing model or usage metadata is explicitly “Not reported”, never estimated. A canceled call may still incur provider usage that the app never receives.

Each entry can expand **Technical details** for finish reason, reported cached/reasoning tokens, validation outcome, MIDI key/timing/note count/pitch range and a validated note preview (first 128, with omitted count). Failed calls show safe status/code metadata. This is not a raw HTTP/account/auth log: it excludes headers, credentials, request prompts and malformed provider bodies, and is not saved with history or sent to Live.

## Verification

```sh
npm --prefix web test
npm --prefix extension run typecheck
npm --prefix extension test
npm --prefix extension run build

# With the Vite preview running and an isolated agent-browser session opened:
node web/scripts/verify-browser.mjs /path/to/agent-browser
```

The browser fixture lives under `web/test/` and is excluded from the production build. It uses the real App, UI package, SDK provider and client with fake account/network responses. It cannot spend Pollen or write to Live. The browser script uses only its named `midijourney-sdk-preview` test session; close that session after testing.

Verified locally: browser build, both type checks, generation/validation/model attribution, cancellation, source-preserving SDK adapter tests, local-server boundary tests, shared Connect navigation, account menu, mocked generation, history reload, mobile overflow, persisted light/dark modes, and per-call technical logging including missing usage, failure and cancellation.

Verified in Live beta `12.4.15b2` on 2026-09-13: normal package installation and host handshake after restart; **Extensions → MIDIjourney Preview: Create with MIDIjourney** on an empty MIDI slot; the actual webview renders the updated shared UI and reports `1-MIDI · empty slot 1`; Connect reaches provider sign-in. Closing the initial editor with Escape left the empty Set unchanged. A host-only HTTP 400 was fixed by importing `URL` from `node:url` rather than assuming the global exists; a bundled VM regression test covers this.

This beta refuses to overwrite an existing package directory during installation. Preserve a backup, uninstall the old package, install its replacement, and restart Live. Never remove user session/storage data as part of the code update.

The embedded Google/passkey flow was reported blocked. On 2026-09-13 the browser-handoff replacement passed 14 web unit tests, 12 extension tests, both type checks, and isolated browser checks for Connect staying in Live, cancel/retry, SDK session delivery, explicit browser account confirmation and acknowledgement. The updated package is installed in the actual Live beta. Subsequently the user completed the real browser handoff: Chrome displayed **Connected to Ableton Live**, and the Live webview displayed the signed-in account and **5 Pollen**. This verifies actual browser-to-Live session delivery and authenticated balance access, separately from the fake-session test suite.

Still required: real generation and MIDI readback/Undo in Live; close/reopen session persistence; fresh logged-out OAuth and invalid-session handling; Windows testing. **This is not a release or a completed MIDI-generation end-to-end test.**
