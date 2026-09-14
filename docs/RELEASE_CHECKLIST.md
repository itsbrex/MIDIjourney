# V3 release gate

Status: **source consolidation verified locally; native release acceptance pending. No finalized V3 release yet.**

## Product scope

macOS; one device on Main; persistent Pollinations web UI; single-selected-clip input; creation in empty Session slots and in-place replacement of selected MIDI clips. No automatic multi-selection, model selector, Windows claim or Extensions SDK.

## Automated and packaging checks

- [x] Clean-checkout `npm ci && npm run verify` succeeds without sibling repos or SDK downloads.
- [x] CI passes on the production source commit (`1844e4d`; [Verify V3](https://github.com/pollinations/MIDIjourney/actions/runs/34830676218)).
- [x] Vendored UI checksum, licenses and source provenance reviewed.
- [x] Staged repository excludes personal sessions, credentials, the local plan and downloaded SDK. Device staging excludes test UI; tests remain in the source repository.
- [x] `npm run release:prepare` creates an isolated project using the unchanged authorized app key.
- [ ] Max, launched from Live's Edit in Max, performs Freeze Device and Save.
- [ ] `npm run release:verify -- <candidate>` passes against the same current build.
- [ ] Candidate SHA-256 and test environment recorded below.

## Native acceptance — the exact frozen bytes

Use a saved/disposable Set, never the only copy of a user's work.

- [ ] Fresh process loads with checkout assets and staging folder temporarily unavailable.
- [ ] Exactly one device on Main; stereo pass-through; useful ready/error/retry states.
- [ ] Open, close, reopen and resize retain prompt/chat and stay usable.
- [ ] System-browser login, return/confirmation, account balance and dashboard work.
- [ ] Switching existing MIDI / empty slot / audio selection updates input and creation state without closing.
- [ ] Sending after editing a selected MIDI clip uses its fresh notes.
- [ ] Generate from text and generate from selected MIDI both complete.
- [ ] Create writes the expected note count, pitch, timing, duration, velocity and clip length; native read-back passes.
- [ ] Occupied selection is replaced in place (all old notes, including notes outside the loop); title and length update. Other clips and clip identity stay unchanged.
- [ ] Stale selection, recording, audio and Arrangement destinations are rejected before mutation. A full Session track can still replace its selected clip.
- [ ] Undo behavior observed and documented; no unsupported grouping API.
- [ ] Cancel, New chat and close/reopen cannot create a late clip or resurrect canceled results.
- [ ] Prompt Copy/Paste and Response copy work inside Live.
- [ ] Light/dark modes, compact/narrow layouts and account menu remain usable.

## Publish

Only after all applicable checks pass: preserve the archive branch, commit/push production main, tag `v3.0.0`, attach the exact verified frozen `MIDI Journey.amxd` plus checksum and release notes, and verify the downloaded artifact's checksum. Never silently replace an existing release asset.

Main may contain candidate source before the tag, but documentation must not claim a release or compatibility that has not been tested.

## Acceptance record

### 2026-09-14 — source candidate, not frozen acceptance

- macOS / Node 22.21.1: exact clean-install workflow passed all 127 tests. Production dependency audit reported no known vulnerabilities. React source formatting/lint checks passed.
- Native preview: Live 12.4.15b2 with bundled Max 9.1.5 rendered the consolidated UI; the user completed system-browser login and the account/balance appeared. Standalone Max 9.0.3 produced a blank editor; it is not supported by this candidate.
- Browser fixture: generation, model/token metadata and exact Response copying passed with fake provider data. This is not evidence of a native MIDI write.
- Native automation remains unreliable: clicking the floating editor through app control switches focus to the main Live window; the linked Max editor also timed out. Final freeze, isolated loading, and native write/read-back are still unverified.
- No V3 tag or release asset has been published. All native checks above remain open until tested on the exact frozen bytes.

Record the final source commit, frozen artifact hash, OS/Live/Max versions and observed checks here. Unit tests or a clip title alone are not proof that Live received the correct notes.

### 2026-09-14 — selected-clip replacement source update

- The selected Session slot is now the exact destination. Existing MIDI clips are replaced in place; empty slots still create a clip. No empty-slot search remains.
- Local build and 139 tests pass, including negative/out-of-loop note removal, marker resizing, full tracks, stale identities, recording/audio/Arrangement rejection, and failure/replay safety.
- Native replacement is not yet verified. The linked Max editor timed out during app-control inspection; Live still has the earlier writer loaded. A fresh isolated source candidate was prepared for reload. This does not satisfy the frozen-artifact acceptance checks above.
