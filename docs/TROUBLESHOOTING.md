# Troubleshooting

## Window does not open

Load one device on Main and press Open. If the panel says Connection unavailable, close other MIDI Journey instances and stop the browser development server, then press Retry. Port 5178 must be free. If Max reports a missing script, you may have loaded an editable source file without its dependencies rather than the frozen release.

If the editor is blank but the server is running, check Live Settings → File & Folder → Max Application. Select the bundled Max (9.1.5 or newer), then restart Live. A manually selected older standalone Max can take precedence over the newer copy included with Live.

## Cannot connect

Use the account menu inside MIDI Journey. Sign-in happens in the system browser, not inside the embedded passkey window. Confirm the intended browser account and return to Live. Keep Live open throughout. An expired handoff can be canceled and started again.

Do not rotate the app key to troubleshoot ordinary login problems. Rebuilding does not clear or replace your personal session.

## No MIDI input badge

Select a MIDI clip in Live. An empty slot supplies a destination but no notes. Audio clips are not MIDI input. Selection follows the current single clip; automatic multi-selection is not part of V3. The source is read afresh when you send.

## Create clip is disabled

Choose an empty Session slot on a MIDI track. Selecting an existing MIDI clip chooses the next available empty slot on that track; it never overwrites the clip. If the track has no available slot, add an empty scene in Live or choose another destination.

## A write warning appears

Do not click repeatedly. A timeout or read-back warning can mean Live created something but the connector could not confirm its exact contents. Inspect the destination and use Live Undo if appropriate. Writes are not automatically retried.

## Copy or paste seems unreliable

Live/Max may intercept native keyboard shortcuts. Use the explicit Copy/Paste controls beside the prompt. Response copies the full diagnostic export and MIDI. Neither operation logs clipboard content. Oversized content is rejected rather than truncated.

## Old design or stale code

Only the frozen V3 release is portable. A source candidate must be reloaded after a bridge/runtime change; refreshing a web page alone does not reload Max JavaScript. Remove the old device first so you do not run two servers. Do not edit two copies simultaneously in Max.

## Report a problem

Include Live, Max and macOS versions, the device SHA-256/release tag, what you clicked and what happened. If useful, use Response to copy one generation's details. Review the export before sharing musical material; never share login tokens or OAuth callback links.
