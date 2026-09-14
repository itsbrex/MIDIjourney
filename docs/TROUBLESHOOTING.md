# Troubleshooting

## Pollinations does not open in the browser

In the source preview, click **Connect** in Live's bottom device panel to start authorization. **↗** beside the balance opens the Pollinations dashboard instead; it does not authorize MIDIjourney. Check that the default browser can open HTTPS links and that a firewall is not blocking Pollinations. There is no account modal or account section inside the floating Create editor.

## MIDIjourney asks you to reconnect

The saved authorization may have expired or been revoked. A temporary network outage does not erase a valid saved connection. After rejected authorization is cleared, use **Connect** in the bottom device panel to reconnect. Dashboard sign-in alone does not grant device authorization. Do not change the app key to refresh the UI.

## A model is unavailable

The model selector and its request override have been removed. MIDIjourney uses its existing configured/default model behavior and does not switch models on an error. Check the Pollinations provider configuration if that model is unavailable; invalid MIDI is still rejected before reaching Live.

## Insufficient Pollen or rate limit

Open your Pollinations account to review usage or balance. MIDIjourney makes at most two total attempts for transient timeout, rate-limit, and provider failures. If the bounded retry also fails, wait briefly and try again. It does not retry balance, authorization, cancellation, or invalid-response failures automatically.

## No clip is created

Keep MIDIjourney on Live's **Main** track. Open its floating editor, then select either an existing MIDI clip or an empty Session slot on a MIDI track before creating. Audio clips cannot receive MIDI notes. Make sure the target still exists when generation finishes.

## A generated response is rejected

V3 rejects incomplete or out-of-range MIDI before it reaches Live. Try the request again or make the prompt more explicit about duration and musical content. Rejected provider output does not partially overwrite the selected clip.

## Canceling or disconnecting during generation

Canceling stops the active request and any pending retry. Closing the device also cancels generation without erasing saved authorization. Removing the disconnect icon does not disconnect an existing session.

## The dashboard arrow is visible but cannot be clicked

Use the updated source/device. Account controls now live in the bottom device panel, outside the floating prompt editor. Create, Connect, and the balance row have separate hit areas; the layout generator and regression tests enforce their bounds. The panel requests current account state when reloaded. This issue does not require changing the API key.

## Max changes appear after closing the editor

The device instance loaded in Live and its source files are separate states. Editing an external `.maxpat` can change that file independently of saving the parent `.amxd`. Check the actual file changes before assuming a cache problem. Close Max editing before reloading the intended source device through Live's hot-swap control; do not clear authorization or delete caches to refresh the UI.

## History changes the result unexpectedly

Turn **History** off to keep the visible archive without sending it as context for the next request. Use **Clear** only when you want to remove the archive as well.

## Reporting a problem

Include the Ableton Live version, bundled Max version, operating system, what you selected in Live, and the safe error message shown by MIDIjourney. Do not include authorization tokens, API keys, or private prompt/history content.
