# Compatibility

MIDIjourney V3 targets current Ableton Live 12 installations.

| Environment | Status | Notes |
| --- | --- | --- |
| Live 12.4.5 / Max 9.0.3 / macOS Apple silicon | Release-candidate smoke passes | Browser authorization and a real Pollinations request producing a nonempty Session MIDI clip pass in Live. Candidate H was frozen in the Live-linked Max editor, survived a cold-start Set reopen without a stack overflow, and the promoted AMXD loads independently after external staging is removed. Node for Max 20.6.1. |
| Node 20.17.0 and 22.21.1 / macOS Apple silicon | Full automated layer passes | Syntax, 88 application tests, release portability, frozen-AMXD checks, and static patcher checks pass. Full release tooling requires Node 20.12 or newer because the pinned compiler uses `crypto.hash`. |
| Node 18.18.0 / macOS Apple silicon | Application tests pass | Syntax, all 88 application tests, and portability checks pass. The pinned release compiler cannot load because Node 18 does not provide `crypto.hash`, so Node 18 is not supported for release builds or full artifact verification. |
| Live 12 / Windows 11 | Pending | BYOP, DPAPI, clip creation, reopening, and multi-instance tests required. |
| Live 11 and earlier | Unsupported by V3 | Keep an older device build if legacy Live support is required. |
| Push 3 Standalone | Unsupported | Browser authorization and the current desktop credential stores are not designed for Push Standalone. |

Declared minimum versions in the AMXD:

- Ableton Live 12.0.0
- Max 9.0.0

V3 remains a transparent Max Audio Effect intended for Live's Main track. It creates and edits clips on MIDI tracks through the Live Object Model; it is not packaged as an instrument or MIDI Effect.

The clip paths and functions used by V3 were checked against Cycling '74's Live Object Model for Live 12.3.5. This includes Session `ClipSlot.create_clip`, Arrangement and Session `Clip` objects, `get_all_notes_extended`, `add_new_notes`, `remove_notes_extended`, and the `detail_clip` / `highlighted_clip_slot` view paths. The note-range messages use a span of 128 so pitches 0 through 127 are both covered.

Before an operating system is claimed as supported, the device must pass the full checklist in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) on that target operating system.
