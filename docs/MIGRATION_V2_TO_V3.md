# Migrating from V2 to V3

V3 keeps the original single-device MIDIjourney workflow, but changes the service connection and minimum host versions.

## Before upgrading

- Keep the V2 AMXD if you still use Live 11 or earlier. V3 targets Live 12 and Max 9.
- Save a copy of important Live Sets before replacing a device in an existing Set.
- V2 API keys are not imported. Remove any old key from saved presets or Sets if one was stored there.

## Connecting in V3

There is no personal API-key field or connection modal. Click **Connect** directly in the compact device panel and approve MIDIjourney in the browser. While MIDIjourney checks the connection, opens the browser, or waits for authorization, the button shows **Connecting...** and is temporarily disabled. It returns to **Connect** after a disconnection or authorization error and changes to **Connected** only after authorization succeeds. Clicking **Connected** cancels any active generation, disconnects, and removes the saved authorization. Authorization is stored by the operating system, not in the Live Set.

## Device placement

Place V3 on Live's **Main** track. It remains a transparent Max Audio Effect and uses the Live Object Model to create or edit clips on MIDI tracks; it is not an instrument that belongs in a MIDI track's device chain.

## History

History remains part of MIDIjourney and is saved per device with the Live Set. It is restored when the Set reopens without starting a generation. Turning History off stops recent entries from being sent as model context without removing the visible archive. **Clear** removes the saved archive and its reusable context. History is capped at the 100 most recent messages.

## Project compatibility

V2 and V3 are separate devices. Existing V2 instances are not silently converted. Add V3 as a new device, confirm its output in the Set, and only then remove the old instance if desired.
