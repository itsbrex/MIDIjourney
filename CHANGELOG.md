# Changelog

## Unreleased — V3

- Replaced the all-Max editor with a compact, resizable persistent web conversation using the shared Pollinations UI and SDK.
- Added shared light/dark mode and account menu, system-browser login handoff, balance and dashboard access.
- Added chat context, New chat, automatic single-clip input feedback, piano-roll previews, provider-reported model and Response copy with token/MIDI details.
- Kept original MIDI sanitization and request semantics; added regression fixtures for parity.
- Creates new clips without overwriting existing clips; validates MIDI and checks native note read-back.
- Added explicit macOS clipboard controls for embedded-host limitations.
- Simplified the Main-track device to title, Open, status and Retry on error; retained stereo pass-through.
- Consolidated production source into app/core/device with one root lockfile/build.
- Embedded web assets and fonts in the Node runtime; added isolated native-freeze staging and exact-byte verification.
- Preserved old UI and Ableton Extensions experiments on codex/archive-ui-experiments. The experimental dev-mj2 branch is unchanged.
- Removed old History drawer, model selector and redundant Max UI from the active product.

The V3 tag and downloadable frozen device remain gated on native acceptance.
