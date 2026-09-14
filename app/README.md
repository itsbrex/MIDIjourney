# MIDI Journey UI

The production web UI lives here. Run commands from the repository root; this is not a separately installed package.

- `src/`: conversation, MIDI preview, shared Pollinations account UI, Live transport.
- `test/`: unit tests and isolated browser fixtures.
- `test/fixtures/original-*.maxpat`: unchanged reference patchers from commit `6f326a1`, used only to verify the original MIDI-input semantics.
- `.generated/`: ignored browser-compatible MIDI core.
- `index.html`: production entry.

The Extensions SDK and older UI are archived, not build inputs. See the [root README](../README.md).
