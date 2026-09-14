# V3 release gate

Status: **source consolidation verified locally; native release acceptance pending. No finalized V3 release yet.**

## Product scope

macOS; one device on Main; persistent Pollinations web UI; single-selected-clip input; creation in empty Session slots and in-place replacement of selected MIDI clips. No automatic multi-selection, model selector, Windows claim or Extensions SDK.

Generation must call the managed `community/pollinations-router/midijourney` agent, not `openai`, a legacy MIDIjourney model or the agent's base model directly.

## Automated and packaging checks

- [x] Clean-checkout `npm ci && npm run verify` succeeds without sibling repos or SDK downloads.
- [x] CI passes on the production source commit (`1d796de`; Node 22 and 24, [Verify V3](https://github.com/pollinations/MIDIjourney/actions/runs/34834646104)).
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
- [ ] Generation uses the managed agent and its returned content passes MIDI validation. No model label or Response copy control appears in the footer; no model label is appended to musical explanations, including older saved replies.
- [ ] Create writes the expected note count, pitch, timing, duration, velocity and clip length; native read-back passes.
- [ ] Occupied selection is replaced in place (all old notes, including notes outside the loop); title and length update. Other clips and clip identity stay unchanged.
- [ ] Stale selection, recording, audio and Arrangement destinations are rejected before mutation. A full Session track can still replace its selected clip.
- [ ] Undo behavior observed and documented; no unsupported grouping API.
- [ ] Cancel, New chat and close/reopen cannot create a late clip or resurrect canceled results.
- [ ] Prompt Copy/Paste works through the existing right-click menu inside Live, with no extra clipboard toolbar buttons. Only disabled Create clip controls show an explanatory tooltip; piano rolls and single-line input badges have no hover popups.
- [ ] The compact header contains only New chat, profile and color-mode controls; no title or decorative image.
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

### 2026-09-14 — committed source verification

- Three focused commits on `main` cover selected-clip replacement (`7b9911d`), the conversation card and original music artwork (`8abd4a2`), and release documentation (`1d796de`). All are pushed.
- A clean archive of `1d796de` passed `npm ci && npm run verify`: 139 tests, no failures. The dependency install reported no known vulnerabilities. GitHub's Node 22 and 24 jobs also passed.
- The final browser fixture displays the short replacement-aware welcome and full-bleed illustration without console warnings/errors. This fixture does not verify Live mutations.
- The app key is unchanged. The local plan, credentials and prototype archives remain ignored. Native freezing and exact-artifact acceptance remain required before tagging V3.

### 2026-09-14 — managed-agent routing correction

- The public catalog with `agents=true` lists `community/pollinations-router/midijourney` with `agent: true`. The old `openai` route bypassed it. Generation now always targets this agent; legacy model fields cannot override that route.
- At this stage the JSON schema was included in both the system message and `response_format`. The later real-agent HTTP 400 below disproved this request contract; this candidate must not be released. The agent's base model is not pinned by this app.
- Local build and all 141 tests pass. New transport tests cover the actual chat session, compiled MIDI core and installed SDK, including request serialization, MIDI input, response attribution and retry routing. These use mocked HTTP responses, not a paid agent call.
- Earlier staged or frozen candidates are stale. Rebuild/reload and repeat native acceptance on the corrected bundle before publishing; real-agent output compatibility still needs that check. No key was changed.

### 2026-09-14 — managed-agent HTTP 400 correction

- The user's actual provider error was `Structured text output is not supported by managed agents`. The request targeted the correct agent but incorrectly supplied structured-output options.
- Removed SDK `responseFormat` entirely; the MIDI schema stays in the system message and strict local response validation stays in place. No alternate model or output-mode fallback was added; authentication and keys are unchanged.
- A real-SDK transport regression reproduces the provider's rejection when `response_format` is present. It failed before this fix and passes afterward. Separate checks reject prose and invalid MIDI even without provider-enforced structured output.
- These are mocked-provider checks, not native acceptance. The rebuilt device still needs a successful real-agent generation and Live write/read-back before freezing or publishing V3.

### 2026-09-14 — native agent output compatibility

- Direct agent probes returned YAML metadata with a CSV `notation` block, including when asked for JSON. The app now requests that native format instead of a JSON schema. Valid JSON replies remain compatible.
- YAML/CSV is converted into the existing normalized MIDI representation, then strictly validated before preview or Live writes. No missing note values are invented, no invalid notes are clamped or dropped, and no repair call or model fallback is added. Aliases, tags, nested/unknown fields, duplicate keys, multiple documents, excessive note counts and oversized responses are rejected.
- All 159 automated tests pass, including recorded real-agent responses through the compiled core, installed SDK, chat context, piano-roll geometry, persistence and exact response copying. The production build includes type checking and passes source/dependency verification.
- One additional real request through the updated compiled app core, SDK and chat session completed in a single attempt: `Afternoon Song`, 8 valid notes, YAML/CSV with explanation, 4,568 total tokens. The API reported model ID `9a0db868-29cb-4e78-9d44-ba2be6551337`; this does not prove the underlying model used. No keys or Live clips were changed.
- A fresh source candidate is required; earlier candidates do not include this parser. Native reload, clip write/read-back and actual Max freeze remain required before publishing V3.
