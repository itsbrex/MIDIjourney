# Changelog

## Unreleased — V3

- Replaced the all-Max editor with a compact, resizable persistent web conversation using the shared Pollinations UI and SDK.
- Added shared light/dark mode and account menu, system-browser login handoff, balance and dashboard access.
- Added chat context, New chat, automatic single-clip input badges and velocity-shaded piano-roll previews.
- Kept original MIDI sanitization and request semantics; added regression fixtures for parity.
- Creates clips in empty Session slots or replaces the selected existing clip in place; validates MIDI and checks native note read-back.
- Uses the managed MIDI Journey agent through the SDK, accepting native YAML/CSV and valid JSON without structured-output options or model fallbacks.
- Simplified the header and response cards, with a round Send icon inside the full-width composer. Copy/Paste uses the native right-click menu.
- Simplified the Main-track device to title, Open, status and Retry on error; retained stereo pass-through.
- Consolidated production source into app/core/device with one root lockfile/build.
- Embedded web assets and fonts in the Node runtime; added isolated native-freeze staging and exact-byte verification.
- Preserved old UI and Ableton Extensions experiments on codex/archive-ui-experiments. The experimental dev-mj2 branch is unchanged.
- Removed old History drawer, model selector and redundant Max UI from the active product.
- Removed retired artwork, unused clipboard transport and obsolete Max-era helpers from the V3 source tree.

The V3 tag and downloadable frozen device remain gated on native acceptance.
