# MIDIjourney

MIDIjourney turns plain-language musical ideas into editable MIDI clips inside Ableton Live. It can create a new clip or use the selected clip as material for a variation, continuation, or transformation.

V3 keeps the focused workflow of the original device while modernizing its AI connection, MIDI validation, security, and Live 12 compatibility.

## What it does

- Generates or remixes MIDI from a written prompt.
- Uses the selected MIDI clip as optional source material.
- Keeps a visible, clearable history of prompts and results.
- Can include that history as creative context when History is enabled.
- Explains the musical choices behind each result.
- Names and colors clips using their detected musical key.
- Connects to Pollinations with browser-based BYOP authorization—there is no personal API key to paste into Live.

## Requirements

- Ableton Live 12 with Max for Live.
- Max 9 (the version bundled with Live 12 is recommended).
- macOS (tested). A Windows 11 code path is included, but Windows acceptance is still pending.
- An internet connection and a Pollinations account for generation.

V3 is developed and tested against Ableton Live 12.4.5 with Max 9.0.3. See [Compatibility](docs/COMPATIBILITY.md) for the current test matrix.

See [Privacy](docs/PRIVACY.md) for what is sent to Pollinations and how authorization is stored.

## Install and connect

1. Download `MIDIjourney.amxd` from the latest release.
2. Place it anywhere in your Ableton User Library.
3. Add MIDIjourney to Live's **Main** track. It is intentionally packaged as a transparent Max Audio Effect so one device can create or edit clips anywhere in the Set through the Live Object Model.
4. Use the compact **Create / History / Connect** controls directly in the device panel, and click **Connect**.
5. Complete the authorization in the Pollinations browser window that opens. The device button changes to **Connected** when approval finishes.
6. Click **Create** to open MIDIjourney's floating editor, select a MIDI clip or empty MIDI clip slot in Live, describe the music you want, and create the clip.

While MIDIjourney checks the connection, opens the browser, or waits for authorization, the compact button shows **Connecting...** and is temporarily disabled. It returns to **Connect** after a disconnection or authorization error. Authorization is stored in the operating system credential store: Keychain on macOS and user-scoped DPAPI protection on Windows. It is not stored in the Live Set, prompt history, AMXD, or Max dictionaries. Click **Connected** to cancel any in-flight generation, disconnect, and remove the saved authorization from that computer.

## History

History is deliberately preserved in V3.

- The history view lets you revisit earlier prompts and results.
- The newest 100 messages are saved per MIDIjourney device with the Live Set and restored without starting a request or creating a clip.
- When History is enabled, recent interactions are also sent as creative context for the next request.
- When History is disabled, the visible history remains available but is not sent as model context.
- **Clear** cancels any active generation and removes both the saved visible archive and its reusable context, so saving and reopening the Set keeps it empty.

History is bounded to prevent Live Sets and requests from growing without limit. Pollinations-style `sk_` and `pk_` credential strings are redacted before history is stored or sent. Do not paste other private data into musical prompts.

## Development

The source device is organized as follows:

- `MIDIjourney.amxd` — frozen, self-contained release device.
- `MIDIjourney.source.amxd` — editable source container used by the build scripts.
- `patchers/` — editable Max patcher abstractions.
- `js/` — Pollinations client, authorization, history, and MIDI validation.
- `scripts/` — deterministic device and verification utilities.

Use Node 20.12 or newer for the complete release toolchain; the tested versions are Node 20.17 and 22.21. The application test suite also runs on Node 18, but the pinned release compiler requires the `crypto.hash` API introduced in Node 20.12.

Install and verify the Node layer:

```sh
cd js
npm ci --ignore-scripts
npm run verify
```

The official `@pollinations/sdk` dependency is pinned to an exact version. Runtime dependency installation is intentionally disabled; release builds must include their tested dependencies. Before device authorization, MIDIjourney asks Pollinations whether its configured publishable App Key is registered. A recognized key is passed to the SDK as `clientId` for app attribution. If Pollinations definitively reports that key as unregistered, MIDIjourney leaves the key unchanged and falls back to the SDK's registered device client so users can still connect; that fallback is not attributed to MIDIjourney and does not produce MIDIjourney app earnings.

The current release-packaging pipeline validates and embeds the existing Pollinations publishable App Key through the ignored `js/config.release.js` input. `MIDIJOURNEY_POLLINATIONS_APP_KEY` is used only when that local build input must be created. The publishable key identifies MIDIjourney during device authorization; it is not a personal user token and cannot replace the scoped user token returned after consent. User authorization tokens must never be committed, placed in environment templates, or stored in Max dictionaries.

Normal rebuilds reuse the existing ignored `js/config.release.js` and must not rotate it. Creating or replacing that release credential is deliberately outside the normal build and requires separate, explicit user approval.

`npm run build:max-release` compiles the Node runtime and prepares an ignored Max project. For an actual release, set `MIDIJOURNEY_MAX_RELEASE_ROOT` to a dedicated folder outside the repository before building. This keeps Max from collecting source files, tests, or build tooling. Preparation writes a deterministic manifest covering the source AMXD, production JavaScript, build configuration, lockfile, local release configuration, compiled bundle, patchers, images, staged assets, and `.maxproj`. It refuses to replace a nonempty target that is not owned by a valid MIDIjourney staging manifest and restores the prior owned project after a caught preparation failure. Keep the generated project unchanged and available through verification and promotion. Do not rerun preparation into that same project after Max freezes its candidate; use a fresh release root if another build is needed.

Use this native freeze sequence:

1. From `js/`, run `MIDIJOURNEY_MAX_RELEASE_ROOT="/absolute/external/folder" npm run build:max-release`.
2. Load that exact external **MIDIjourney V3 Release Candidate** on Live's **Main** track. Remove other development copies from the Set so only the release candidate is running.
3. In Live 12.2 or later, open the device title-bar context menu (or `...`) and choose **Edit in Max**. Do not open the AMXD or `.maxproj` directly in standalone Max; Live must create the Max for Live editing session.
4. In the Live-linked Max editor, choose **Freeze Device** in the bottom toolbar, then **File → Save**. Wait for Max to finish collecting dependencies before closing the editor.
5. Run `npm run verify:max-release-candidate -- "/absolute/path/to/MIDIjourney V3 Release Candidate.amxd" "/absolute/path/to/MIDIjourney V3 Release"`.
6. Promote the same candidate with `npm run finalize:max-release -- "/absolute/path/to/MIDIjourney V3 Release Candidate.amxd" "/absolute/path/to/MIDIjourney V3 Release"`.

Strict verification recompiles the current Node entry with the pinned `@vercel/ncc` and rejects a stale compiled bundle. It rechecks the staging manifest against current source inputs, staged assets, and `.maxproj`; compares the exact staged and embedded bytes; compares the complete active patcher state after only observed Max-generated normalization; and validates bounded ZIP local headers, central directories, footers, CRCs, decompression, concatenated archives, and Max's native dependency directory. Max-generated dependency paths are deliberately preserved because they are part of the frozen-device format.

Finalization holds a sibling `.<device filename>.finalize.lock`, promotes the exact verified in-memory candidate snapshot, `fsync`s temporary files and parent directories where the platform supports it, atomically replaces each destination file, and rechecks the installed AMXD and checksum. Caught write failures restore both previous files, but the AMXD/checksum pair cannot be crash-atomic across two paths. If a process interruption leaves the pair mismatched, first confirm no finalizer is still running, remove only its stale sibling lock, and rerun `npm run finalize:max-release -- <the same candidate> <the same staging project>`. Do not use checksum-only mode for recovery. Always run `npm run verify` afterward. With no arguments, `npm run finalize:max-release` only validates the existing tracked device's native container structure and records its checksum; it does not prove bundle, source, candidate, or staging freshness and is not a release-promotion substitute.

Before publishing, quit Live and Max, make the external staging project temporarily unavailable without deleting it, then load the exact promoted `MIDIjourney.amxd` in a fresh Live process and complete a connect-and-generate smoke test. Restore the staging folder afterward if more release work is needed.

## Release status

V3 has reached a macOS release candidate. The final `v3.0.0` tag and GitHub Release are intentionally on hold until the Pollinations agent supports model swapping in the device, and until Windows 11 and clean-machine acceptance are complete. The release checklist is in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md); the local implementation plan is intentionally not committed.

Upgrading users can follow [Migrating from V2 to V3](docs/MIGRATION_V2_TO_V3.md). Connection and clip-creation help is in [Troubleshooting](docs/TROUBLESHOOTING.md).

## Credits and license

MIDIjourney was created by Elliot Fouchy and Thomas Haferlach at Pixelynx's KORUS Labs, with artistic direction from Richie Hawtin and deadmau5. V3 uses [Pollinations](https://pollinations.ai/) for AI generation.

The project is available under the [MIT License](LICENSE).
