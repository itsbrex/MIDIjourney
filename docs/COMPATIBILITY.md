# Compatibility

## V3 target

macOS, Ableton Live 12 with Max for Live, Max 9.1.5 or newer. Use one MIDI Journey instance on Main. The connector passes stereo audio through unchanged.

The shared UI uses a modern embedded browser. Older bundled Max versions may not render it correctly. A tested minimum Live/Max combination will be recorded after the consolidated frozen artifact passes native acceptance.

## Evidence, not assumptions

| Environment | Observation | Release proof? |
| --- | --- | --- |
| Live 12.4.15b2 / bundled Max 9.1.5 | Consolidated source UI renders; browser login returns a visible account and balance | No: final frozen build still needs acceptance |
| Live 12.4.15b2 / standalone Max 9.0.3 | Consolidated editor was blank | Unsupported by this candidate |
| Live 12.4.5 / Max 9.0.3 | Earlier all-Max UI was tested | No: different UI/runtime |
| Node 22.21.1, macOS | Clean install/build and 127 tests pass without local configuration or SDK downloads | Source checks only |
| Windows | Some inherited launch paths exist | Not validated; unsupported for initial V3 |

## Deliberate limits

- Session View output, MIDI tracks only.
- Current single MIDI clip is input; not the whole multi-selection.
- Create clip replaces the selected Session clip's notes, title and length, or fills the selected empty slot. Other clips are not changed. Recording clips cannot be replaced.
- One local server on 127.0.0.1:5178, accessed as localhost.
- The browser preview has no Live mutation bridge.
- No Extensions SDK installation or beta-only Extensions feature is required by the architecture.
- Chat persists locally in the embedded browser, not inside the Live Set.
- Native keyboard shortcuts can be intercepted by Live/Max; use the prompt's existing right-click Copy/Paste menu.

Generation supports at most 2,048 notes and 4,096 beats per output. Input sanitization retains the original rules; invalid provider output is rejected, not silently truncated into a successful clip.
