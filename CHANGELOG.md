# Changelog

## Unreleased — V3

### Added

- Pollinations BYOP browser authorization using the official Pollinations SDK device-code flow, with app attribution when Pollinations recognizes MIDIjourney's configured publishable App Key and a functional SDK-device fallback when it does not.
- Native macOS Keychain and Windows DPAPI credential storage.
- Compact inline Connect/Connected control in the Ableton device panel, with browser authorization and disconnect behavior.
- Strict JSON-schema response requests and complete MIDI validation.
- Tests for authorization, history, provider requests, MIDI boundaries, and key colors.
- Explicit Live 12 / Max 9 release metadata and compatibility checks.
- Recursive credential-field stripping before requests or results enter creative history.
- Per-device history persistence inside the Live Set, bounded to the 100 most recent messages.
- A separate editable source container plus staging and validation for a self-contained frozen AMXD.

### Changed

- Preserved prompt history across Set save/reopen while separating the visible archive from optional model context.
- Replaced the legacy OpenAI request client and free-form YAML parsing.
- Pinned the runtime to one zero-dependency provider SDK.
- Made release builds deterministic instead of installing packages at runtime.
- Isolated Max release staging from repository search paths so freezes include only the compiled runtime and required device assets.
- Corrected MIDI boundary handling, duration calculation, enharmonic key colors, and error reporting.
- Corrected Live API pitch spans so note 127 is imported and cleared, and supplied the `mute` field expected by Live's extended note dictionaries.
- Kept MIDIjourney as a transparent Max Audio Effect on Live's Main track while targeting MIDI clips through the Live Object Model.
- Limited transient generation failures (HTTP 408, 429, and 5xx) to two total attempts with an abortable delay; cancellation, authorization, balance, and validation failures are not retried.
- Made connection and generation cancellation operation-safe so late provider results cannot restore stale authorization or create a clip after disconnect.
- Reworked Max command routing and deferred UI actions to prevent recursive feedback and stack overflow on load or connection clicks.

### Removed

- Personal API-key entry in the Max UI.
- The obsolete Pollinations connection modal and its feedback-prone routing.
- Full prompt and provider-response console logging.
- Obsolete CSV, code, and mini-notation engines.
- Temporary response files and runtime dependency installation.
- The legacy Max-side package installer and development files from the frozen device.
