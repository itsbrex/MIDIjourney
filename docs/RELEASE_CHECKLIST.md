# V3 release checklist

The checked packaging/Live smoke results below describe the previously promoted candidate H. The balance-and-dashboard source update must pass a fresh Live-hosted smoke, native freeze, and strict promotion before those results apply to the new UI.

## Build and dependencies

- [ ] `npm ci --ignore-scripts` succeeds from a clean checkout.
- [x] `npm run verify` passes on tested Node 20.17 and 22.21; all 88 application tests also pass on Node 18.18, while the pinned release compiler requires Node 20.12's `crypto.hash` API.
- [x] `npm audit --omit=dev` reports no known vulnerabilities.
- [x] The Pollinations SDK version matches the lockfile exactly.
- [x] The external staging manifest matches every current production JavaScript/build/lock/config input, source dependency, staged asset, and `.maxproj`.
- [x] Strict candidate verification recompiles the Node entry with the pinned `@vercel/ncc` and confirms the ignored release bundle is current.
- [x] The frozen AMXD includes the exact compiled runtime and every required device dependency.
- [x] The active frozen Max patcher documents match the staged graph after documented Max normalization.
- [x] Every bounded embedded ZIP archive passes local-header, central-directory, footer, CRC, decompression, entry-count, and expanded-size validation.
- [x] Max's native dependency directory has the exact JSON/folder records, ordering, flags, sizes, and offsets for the frozen documents and ZIP archives.
- [x] The device runs after its external staging folder is removed, with no repository or global npm dependencies.
- [x] The external candidate passes `npm run verify:max-release-candidate -- <candidate> <staging-project>` before it replaces the tracked device.
- [x] `npm run finalize:max-release -- <candidate> <staging-project>` acquires its sibling lock, promotes the verified snapshot with file-level atomic replacement and durability syncs, rechecks installed bytes, records the checksum, and is followed immediately by `npm run verify` (the two files are not crash-atomic as a pair).
- [ ] Recovery is rehearsed: after confirming no finalizer is running, remove only a stale sibling finalizer lock and rerun the exact same candidate-plus-project command; never use checksum-only mode to recover a promotion.

## Security and privacy

- [x] The release contains the approved publishable Pollinations App Key and no secret keys or user tokens.
- [ ] Pollinations recognizes the configured publishable App Key, and a release login is verified as attributed to MIDIjourney for app earnings.
- [x] A definitively unregistered App Key falls back to the SDK device client without changing the configured key or blocking login.
- [x] `js/config.release.js` was generated only after scoped credential approval and remains ignored/uncommitted.
- [ ] Authorization tokens never appear in Max dictionaries, Live Sets, history, logs, crash output, or the AMXD.
- [ ] Connect, reconnect, cancellation, authorization expiry, and Disconnect are verified.
- [ ] Disconnect removes the operating-system credential entry.
- [x] Temporary network failures do not delete valid authorization.
- [x] Automated tests cover coalesced Connect requests, cancellation, stale completions, offline credential preservation, bounded transient retries, and retry cancellation.
- [x] Prompt and response bodies are absent from release logging.

## MIDI and history

- [x] New clips and variations are valid at MIDI pitch 0 and 127 and velocity 1 and 127.
- [x] Invalid or partial provider output never reaches Live.
- [x] Clip duration covers every note.
- [x] History remains visible and clearable.
- [x] History is only sent as model context when enabled.
- [ ] Saving and reopening the Live Set restores history without starting a request or creating a clip.
- [ ] Clearing history removes both display and context entries; saving and reopening afterward remains empty.
- [ ] Clearing history during generation cannot repopulate history or create a stale clip.
- [x] Only the newest 100 history messages persist.
- [x] Large input clips and long histories remain responsive and bounded.

## Ableton acceptance

- [x] The source device remains a transparent Max Audio Effect for the Main track and its connection control is not automatable.
- [ ] The compact device exposes **Create**, **Connect**, balance, and **↗**; account actions work without a modal or feedback loop.
- [x] Live 12.4.5 with Max 9.0.3 passes the current macOS release-candidate smoke and production create path.
- [x] Automated tests verify the removed dropdown cannot override the model or decorate request dictionaries.
- [x] Live visually confirms the restored full-width MIDI Prompt row and account controls in the embedded device panel only (source preview, 2026-09-13).
- [x] Automated tests verify device-control bounds and History toggle z-order so transparent bpatcher margins cannot swallow clicks.
- [ ] Funded balance, zero balance, and the dashboard-opening arrow are verified in Live with Max editing closed.
- [x] The source preview restores existing authorization and displays a funded balance in Live with Max editing closed (2026-09-13); first-time consent, zero balance, and the browser link still need live acceptance.
- [x] Automated tests verify the embedded login uses **connect**, not a disconnect toggle, and that rendering/restoring state never triggers authorization.
- [ ] Verify first-time/reconnection access through the embedded **Connect** button in Live before release.
- [ ] Live 12.4.x with its bundled Max 9.0.x or later passes on Windows 11.
- [ ] Empty slots, existing clips, Arrangement clips, and Session clips are covered.
- [ ] Undo/redo and Live Set reopen behavior are correct.
- [ ] Multiple MIDIjourney instances authorize and generate independently without cross-talk.
- [ ] Light/dark themes and common Live zoom settings remain readable.
- [ ] Offline, rate-limit, low-balance, invalid-response, and cancellation errors are understandable.

## Release

- [x] The external candidate is loaded on Main with all other MIDIjourney development devices removed from the Set.
- [x] The candidate is opened through Live's device context menu using **Edit in Max**, not directly in standalone Max.
- [x] **Freeze Device** and then **File → Save** complete in that Live-linked Max editor.
- [x] The exact candidate path and its unchanged external staging project remain available until strict verification, promotion, and post-promotion verification all pass.
- [x] Preparation is not rerun into the staging project after its candidate is frozen; any later build uses a fresh release root.
- [x] The AMXD is resaved and frozen with Live 12.4.5 / Max 9.0.3.
- [x] Version, minimum Live/Max metadata, description, and tags are correct.
- [ ] README, changelog, screenshots, and release notes match the shipped device.
- [x] The release artifact checksum is recorded.
- [x] Model selector and request override removed from scope; model swapping is no longer a release gate.
- [ ] A clean-machine smoke test passes before tagging `v3.0.0`.
