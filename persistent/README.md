# MIDIjourney Persistent — separate local prototype

This experiment keeps the Pollinations web interface open while you work in Live.
It does **not** replace the beta Extensions version or the original Max device.
Nothing in this experiment is a published release.

## Versions kept side by side

| Location | Purpose | Status |
| --- | --- | --- |
| Root `.amxd`, `js/`, `patchers/` | Original Max for Live version | Preserved |
| `web/`, `extension/` | Pollinations UI in the Ableton beta Extensions modal | Preserved |
| `persistent/` | Pollinations UI in a persistent, modeless Max `jweb` window | New prototype |

The React UI source is copied into this folder so experiments here do not rewrite
the beta editor. It still imports the shared `@pollinations/ui` and
`@pollinations/sdk` packages, including account controls and dark/light modes.
The pinned dependencies in `web/node_modules`, the shared MIDI core in `js/`, and
the existing browser-login relay in `extension/src/` are read-only dependencies.
No new app key or authorization flow was introduced.

## Build and open

From the repository root, with the existing `web/` dependencies installed:

```sh
node persistent/scripts/build.mjs
node --test persistent/test/*.test.mjs
```

Load `persistent/MIDIjourney Persistent.amxd` onto **Main** in Live. Use only one
instance. The device passes audio through unchanged; it is a connector, not an
instrument. Its **Open MIDIjourney** button opens the same modeless editor. The
prototype also opens it on device load.

Close the old beta extension's editor or localhost preview first: both prototypes
currently use port **5178** to retain the already registered BYOP callback. They
can remain installed side by side, but their local servers cannot run together.
If the port is occupied, close the other editor and use **Retry connection**.
Retry reloads the page; it is not needed when simply changing the selected clip.

The build currently uses absolute dependency paths. Keep the generated device
beside this checkout; it is not a portable/frozen release artifact yet. Rebuild
after moving the repo, then reload the device. Native Max JavaScript is not
hot-reloaded, so rebuilding alone does not update an already loaded instance.

## Workflow and safeguards

- Leave the device on Main and select a MIDI clip or empty slot in Session View.
  The editor polls Live's current selection; it does not keep the beta extension's
  original context-menu target.
- An empty selected slot is the destination. If that slot contains a clip,
  output goes into the first empty slot on the same track.
  There is no destination banner above the conversation. Destination validation
  remains on Create clip, and successful creation receipts identify the output.
  Existing clips are not overwritten.
- Send a message to generate MIDI through the Pollinations SDK. Follow-up messages
  keep the conversation's context. Only the current Live MIDI input is attached;
  no selection means text-only input, never a fallback attachment from an earlier reply.
- Cards use right/left alignment without speaker labels. Your messages have a
  muted accent tint; replies use the neutral shared surface in both themes.
  The centered app layout (header, notices, and chat) stops growing at 44.8rem
  (about 717px at the default font size). Reply cards stay left-aligned and stop
  growing at 31.5rem (504px). Both limits are 30% narrower than their previous
  widths, while still shrinking naturally in smaller windows.
  Each MIDI reply has a compact, read-only piano roll showing pitch, timing, note lengths, and velocity
  through opacity. It has no playback, edit controls, or numeric length display.
  Reply titles use the existing Pollinations body font at medium weight; the app
  header reads **MIDI Journey** in the shared Fraunces section-heading style used
  by Enter's Wallet and Top-up titles. The shared `ScrollArea` provides a transparent track
  and auto-hiding, muted handle. The composer is transparent with a subtle dotted
  border and a stronger dotted keyboard-focus outline. It has no placeholder or resize grip;
  long text still scrolls with the shared subtle scrollbar styling.
- Each reply reads title → musical explanation → piano roll → compact footer.
  Below the preview, the footer groups the model and borderless **Response** copy
  control with the shared clipboard icon together on the left. A larger **Create
  clip** action and its availability hint are a separate group last on the right
  (wrapping on narrow windows).
  Without a destination, the action is dimmed with **Please select a clip** beside
  it. Successful creation receipts are kept internally but not displayed; creation
  errors remain visible. **Send** is also a larger button.
  Model attribution is moved out of the explanation visually; original stored
  responses and copied details are unchanged. Details never expand on screen. Copying
  includes the actual model, token usage, request attempts, original model-message
  text, and the complete normalized MIDI output (not just a note preview).
  Any reply can be sent to the currently selected destination. Creating waits
  for note read-back and leaves the editor and conversation open.
  While generating, the card shows three small animated dots and no response copy
  or other footer controls. Reduced-motion preferences disable the animation.
- Composing does not require a valid Live destination; creating a clip does.
- MIDI note extraction follows the original `mj_clipImport` technique:
  read the source with `get_all_notes_extended` and use its title,
  length, and notes. Every Send performs a fresh read, including edits to the same
  clip. Input does not require a writable Session slot. An input read failure
  fails that message rather than silently substituting the previous reply.
  The original shared `js/history.js` / `sanitizeInputNotes` path still handles
  request construction, input limits, sorting, mute filtering, and velocities;
  there is no additional 1024-beat read window or prefilter in this connector.
  Compact, two-line MIDI badges sit **inside the message box**, with the shared
  music icon, clip title, and usable note count. There is no input heading,
  full-width input banner, or amber separator above the composer.
  Session input follows the highlighted slot on the selected MIDI track. Empty
  slots, audio tracks, and no slot clear it, even if `detail_clip` is still stale.
  Arrangement input still uses `detail_clip`. The focused document view, not
  merely visibility, distinguishes Session from Arrangement in two-window layouts.
  There are no badge buttons, pinned clips, or saved attachment exclusions.
  Read errors disable Send rather than silently substituting other MIDI. Badges
  in sent messages retain the exact titles and counts used by that request.
  **Limitation:** the current Max LiveAPI exposes a single highlighted/detail clip,
  not a complete selected-clips collection. Automatic multi-selection is not
  implemented. The downloaded Extensions SDK 1.0.0-beta.1 supplies
  `ClipSlotSelection.selected_clip_slots` only as a context-menu command argument;
  it has no continuous selection subscription. A different connector must be
  evaluated before promising full selection/deselection mirroring. Shared request
  formatting still supports multiple references, but this bridge does not supply them.
  Editable reply titles are not implemented yet.
- The destination is revalidated before mutation. A stale target, audio track,
  occupied slot, or malformed note is rejected. Writes are never automatically
  retried after a timeout or a failed read-back.
- There is one active chat, with no History drawer or chat archive. **New chat**
  clears the conversation, draft, and model context, and cancels a pending reply.
  It does not change clips in Live. It waits if a clip write is already underway.
- The current draft, replies, validated MIDI results, and request details are
  saved locally under `midijourney:persistent-chat:v1`. The UI retains the latest
  30 exchanges; storage is limited to 3 MB and trims older exchanges if needed.
  Model context remains bounded by the shared MIDI client's context limits.
  This is local conversation storage, not a hosted Pollinations chat archive.
- Original model-message text is captured for new replies only (at most 512,000
  characters per attempt). Older replies or oversized messages are explicitly
  marked unavailable instead of reconstructed or silently truncated. Credential-like
  text is redacted. No request headers, account keys, or arbitrary response fields
  are captured, and details are not emitted into application console logs.
- On first load, this version discards the legacy persistent prototype's
  `midijourney:persistent-workspace:v1` data. It does not migrate the old history.
  Pollinations account/theme storage and the other versions' history are untouched.
- Login still uses the existing external-browser handoff for passkey support.
  No account credentials, prompts, or history are sent through the Max MIDI bridge.

## Implementation map

- `src/`: Pollinations React chat UI, piano-roll preview, copy-only details, account integration, and
  `jweb.mjs` request/acknowledgement transport. `chat-session.mjs` owns the active
  conversation and cancellation; `session.mjs` validates its local storage.
- `max/bridge.js`: Small ES5 LiveAPI adapter for selection, note reads, validation,
  clip creation, and read-back. MIDI data enters only through an explicit create
  request. Browser navigation notifications cannot call arbitrary bridge methods.
- `max/server.mjs`: Loopback static UI server and the existing browser auth relay.
  No HTTP MIDI-write endpoint. `/api/context` exposes only connection/destination
  health information, not credentials or prompt content.
- `max/window.js`: Resizes the `jweb` content with its floating Max window.
- `scripts/device.mjs`: Generates the new, minimal device from scratch.

## Verification checkpoint — 2026-09-14

- Removed the top destination banner at the user's request. Clipboard shortcut
  handling remains unresolved in the native host: Cycling '74 forum reports
  describe Live on macOS intercepting Cmd+A/C/V/X before jweb, including modeless
  windows. No speculative clipboard listener or OS-wide key interception was
  added. App control could only capture a blank native editor and lost the window
  handle on focus, so native shortcut behavior could not be independently verified.
  Reference: https://cycling74.com/forums/any-way-to-prevent-max-jweb-object-from-passing-all-keyboard-input-through-to-live

- Lightweight clipboard workaround: small **Copy** and **Paste** buttons below
  the composer. The user confirmed that browser clipboard reads are blocked in
  Live. In jweb these explicit actions now use the existing Node connector and
  macOS `pbcopy`/`pbpaste`, with bounded input and timeouts, no shell, no HTTP
  clipboard endpoint, no polling, and no clipboard-content logging. Copy uses
  the selection (or whole prompt); Paste replaces the selection at the cursor.
  A changed draft or oversized paste is left untouched. Browser preview still
  uses the browser Clipboard API. The rebuilt device must be reloaded for the
  new response routing; native Live verification is pending. This does not fix
  host-intercepted keyboard shortcuts or add another app.

- Selection-only composer supersedes the manual attachment experiment below.
  Eight request/session tests cover selection replacement, clearing after a reply,
  dropping saved pins without losing chat, fresh Send-time reads, read errors,
  reset/dispose races, cancellation, and immutable sent receipts. Two new native
  bridge unit tests cover stale detail clips, empty slots, audio tracks, and
  switching clips. Build/typecheck and 93 combined regression tests pass.
  Native device reload is required for the changed Max bridge; browser fixtures
  do not prove actual multi-selection or native end-to-end behavior.
  Browser verification confirms three animated dots and zero footer buttons in
  the pending reply (visible in a narrow window), Copy Details after completion,
  no composer badge after clearing selection, and an actual test request with
  `sourceClip: null`. These checks use fake SDK/Live responses, with no paid calls
  or Live writes. A React dependency-array warning during development hot reload
  did not recur after a full page reload.

### Earlier checkpoints (historical behavior)

- Multi-clip composer update (2026-09-14): attachment tests exercise the actual
  shared generator and SDK request builder against a fake client, including
  separate references, note sanitation, removal/reattachment, deduplication,
  persistence, selection races, cancellation, and eight-clip limits. Dense
  multi-clip history stays bounded valid JSON with every reference's title.
  Browser checks at 760 px and 420 px verify two badges inside the composer,
  light/dark modes, removal, and a sent request containing 4-note and 7-note
  references matching the message badges. No paid requests or real Live writes
  were made for these checks; the native MIDI reader/writer is unchanged.

- Build and TypeScript checks pass.
- 11 bridge tests pass: changing tracks/slots, invalid/stale destinations,
  occupied-source preservation, dictionary calling convention, verified writes,
  replay/concurrency protection, and precise read-back mismatch errors.
- 2 device/source-isolation tests check stereo pass-through, the independent
  modeless window, and preservation of shared account code.
- 14 chat tests cover follow-up context, cancellation/reset races, reusing older
  replies at a new destination, failed calls, safe storage, write guards,
  duplicate generation, and component cleanup/reactivation.
- 5 preview/copy tests cover piano-roll geometry and bounds, original model-message
  capture and persistence, full MIDI copying, retention limits, and cancellation.
- 3 reply-presentation tests check footer model attribution, unknown metadata,
  legacy attribution, and preservation of original response text.
- Input parity update (2026-09-14): 40 tests total pass (15 bridge, 15 chat,
  2 device/isolation, 5 preview/copy, 3 reply-presentation). The new bridge tests
  compare the request against the original shared formatter and cover detail-clip
  selection independent of output, a full track, in-place edits, clearing input,
  audio selection, muted notes, fractional velocities, notes beyond beat 1024,
  the shared input limit, read failures, and non-mutation of source MIDI.
  The browser fixture and original device/patchers remain unchanged.
  Reload only the persistent device for this native bridge update; a page refresh
  alone cannot load the new Max JavaScript. Native input parity still needs checking
  in the reloaded device; these tests are not a claim of native end-to-end success.
- Input feedback update: 45 persistent tests pass, including five tests for the
  shared display/request source rule, exact usable note counts, error states,
  Send-time input receipts, and bounded local persistence. `test/input.html` adds
  source-selection controls around the unchanged browser fixture, using only fake
  Live/SDK responses. Browser checks cover selection changes, edits, full tracks,
  read errors, previous-reply input, persistence, and compact light/dark layouts.
  The indicator was also observed in the running Live editor with a real selected
  clip and 31 usable notes. This UI observation is not a paid generation/write test.
- A test-only browser fixture (`test/chat.html`, served with `test/vite.config.mjs`)
  exercises the real App, SDK provider, generation client, and Max transport with
  fake network/Live responses. No real credentials, paid requests, or Live writes.
  Browser checks confirmed follow-ups, copy-only details, persistence, new-chat
  cancellation, switched destinations, failures, account menu, light/dark modes,
  and a narrow 420 px layout without horizontal overflow.
- UI cleanup checks confirmed left/right cards without visible speaker labels,
  a read-only piano roll in light/dark modes, no on-screen technical panel, and a
  successful clipboard copy containing the original fixture reply and all notes.
- 13 existing auth/server/call-log regression tests pass. Their temporary local
  HTTP servers require loopback-network permission in the development sandbox.
- Previously observed the Pollinations editor rendered inside Live 12.4.15b2 /
  Max 9.1.5, with the signed-in account present. Use **Retry connection** after
  rebuilding to refresh the chat UI; no native bridge change is needed for chat.
- Confirmed live destination changes from `1-Buffer Bass · empty slot 4` to
  `2-MIDI · empty slot 2` without reopening the editor.
- Native testing exposed incorrect `add_new_notes` dictionary arguments and
  unsupported Song undo-group calls. Those have been corrected in this source.
- **Still pending:** resolve the remaining native note read-back warning. The
  newest build retains the dictionary until verification ends and reports the
  exact mismatched count/field. Reload that build before the next native test.
- **Still pending:** repeatable resize/close/reopen checks, a confirmed native
  multi-clip round trip, and a fresh external-browser login test in this host.

Do not treat passing mock tests or a visible clip title as proof of correct MIDI
notes. Until the native read-back check passes, this remains an experiment.
Do not remove the other versions or publish a release yet.

## Relevant vendor references

- [Max web browser integration](https://docs.cycling74.com/userguide/web_browser/)
- [LiveAPI JavaScript reference](https://docs.cycling74.com/apiref/js/liveapi/)
- [Clip note API](https://docs.cycling74.com/apiref/lom/clip/)
- [JavaScript dictionary calling example](https://cycling74.com/forums/javascript-dictionary-and-live-api-issues)

The installed Ableton Extensions SDK beta currently supplies modal context-menu
UI. The Max window is the separate host experiment; the Pollinations UI is not
being rebuilt as Max controls.
