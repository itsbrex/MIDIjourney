# MIDI Journey

A persistent musical conversation for Ableton Live. Describe an idea, refine it with a selected MIDI clip, preview the notes, then create or replace a clip without closing the editor.

**V3 is being prepared for release.** Source builds are not frozen release devices. The [release checklist](docs/RELEASE_CHECKLIST.md) records the remaining native acceptance gates. Download only an explicitly published V3 asset when it becomes available; the older V2 release is a different product.

## The workflow

1. Put **one MIDI Journey device on Main**. It is a transparent Max Audio Effect, not an instrument: Max connects to MIDI tracks through Live's Object Model.
2. Press **Open**. The resizable web window stays open while you change the selection in Live.
3. Connect through the Pollinations account menu. Sign-in opens your system browser; confirm the intended account and return to Live.
4. Type your message. A selected MIDI clip appears as a small input badge. Its notes are read again when you send.
5. Review the response and piano-roll preview. Select a Session MIDI clip to replace, or an empty slot to fill, and press **Create clip**.

Selecting an existing clip uses it as input. **Create clip replaces the selected Session clip's notes, title and length**, or creates a new clip in the selected empty slot. It never redirects to another slot. Other clips stay unchanged; recording clips cannot be replaced. Switching selection does not erase your prompt or conversation.

The response footer shows the provider-reported model and **Response** copy action, including MIDI data and token counts. No model selector or extra technical panel. **New chat** clears this app's local conversation and creative context, not clips already created in Live.

## Requirements and scope

- macOS, Ableton Live 12 with Max for Live, and Max **9.1.5 or newer**.
- Internet access and a Pollinations account with available Pollen.
- One device instance; local port **5178** must be free.

Native acceptance of the consolidated frozen device is still pending. Do not interpret the minimum-version metadata as a tested compatibility matrix. See [Compatibility](docs/COMPATIBILITY.md).

The first V3 scope is single-clip input and creating or replacing MIDI clips in Session View. Automatic multi-selection, Windows acceptance, and the Ableton Extensions edition are deferred. The old Max UI and SDK prototypes are preserved on [codex/archive-ui-experiments](https://github.com/pollinations/MIDIjourney/tree/codex/archive-ui-experiments), not required by this app.

## Development

Use Node **22.12+** and npm from the repository root:

```sh
npm ci
npm test
npm run verify
npm run dev
```

The normal browser preview cannot modify Live. Stop it before loading the device because both use port 5178. Test-only fixtures use `npm run test:ui` on port 5186 and never ship in the device.

```text
app/      React conversation UI; shared Pollinations SDK and UI
core/     MIDI validation, request construction, and bounded context
device/   Max LiveAPI bridge, embedded UI server, browser handoff
scripts/  Build, isolated Max staging, frozen-byte verification
vendor/   Pinned shared UI package and provenance
docs/     Compatibility, privacy, migration, and release acceptance
```

`npm run build` produces `dist/MIDI Journey.source.amxd`, its patcher and four JavaScript dependencies. The web assets and fonts are embedded in the Node runtime. No dependency installation occurs inside Live.

The existing ignored `js/config.release.js` remains the local publishable-app-key input; `MIDIJOURNEY_POLLINATIONS_APP_KEY` is also supported. The old `js/` application is not a runtime dependency. No build creates or rotates keys. A key-free checkout builds a configuration-required screen for tests; release preparation rejects it. Never commit personal tokens or local configuration.

The shared UI is an unmodified, checksum-pinned package archive. See [vendor provenance](vendor/README.md). No neighboring Pollinations checkout or Ableton SDK download is needed to build.

## Freeze and release

```sh
npm run verify
npm run release:prepare
# In Live: load the printed candidate on Main, Edit in Max, Freeze Device, Save.
npm run release:verify -- "/path/printed/by/prepare/MIDI Journey.amxd"
```

Preparation creates a fresh temporary project each time and leaves earlier candidates intact. Freeze is performed by Max, never simulated by rewriting a binary header. Verification checks the native container, every runtime file's exact bytes, patch connections, and UI state against the current build.

Passing that check does **not** prove MIDI behavior. Complete the [native acceptance checklist](docs/RELEASE_CHECKLIST.md), including fresh-process loading with source/staging folders unavailable, before publishing. See [Troubleshooting](docs/TROUBLESHOOTING.md), [Privacy](docs/PRIVACY.md), and [migration notes](docs/MIGRATION_V2_TO_V3.md).

## Credits and license

Created by Elliot Fouchy and Thomas Haferlach at Pixelynx's KORUS Labs, with artistic direction from Richie Hawtin and deadmau5. Powered by [Pollinations](https://pollinations.ai/).

[MIT License](LICENSE).
