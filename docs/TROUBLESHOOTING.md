# Troubleshooting

## Pollinations does not open in the browser

Wait until the compact device button says **Connect**, then click it once. Check that the default browser can open HTTPS links and that a firewall is not blocking Pollinations. MIDIjourney accepts authorization only through the official `enter.pollinations.ai` host. While it checks the connection, opens the browser, or waits for authorization, the button shows **Connecting...** and is temporarily disabled. It returns to **Connect** after an authorization error and changes to **Connected** only after approval succeeds. Click **Connected** to disconnect.

## MIDIjourney asks you to reconnect

The saved authorization may have expired or been revoked. If the button has returned to **Connect**, click it and approve the device again. If it still says **Connected** and you want to start fresh, click it once to disconnect, then click **Connect**. A temporary network outage does not erase a valid saved connection.

## Insufficient Pollen or rate limit

Open your Pollinations account to review usage or balance. MIDIjourney makes at most two total attempts for transient timeout, rate-limit, and provider failures. If the bounded retry also fails, wait briefly and try again. It does not retry balance, authorization, cancellation, or invalid-response failures automatically.

## No clip is created

Keep MIDIjourney on Live's **Main** track. Open its floating editor, then select either an existing MIDI clip or an empty Session slot on a MIDI track before creating. Audio clips cannot receive MIDI notes. Make sure the target still exists when generation finishes.

## A generated response is rejected

V3 rejects incomplete or out-of-range MIDI before it reaches Live. Try the request again or make the prompt more explicit about duration and musical content. Rejected provider output does not partially overwrite the selected clip.

## Canceling or disconnecting during generation

Canceling stops the active request and any pending retry. Clicking **Connected** also cancels generation before removing the saved authorization, so a late provider response cannot create a clip after disconnect.

## History changes the result unexpectedly

Turn **History** off to keep the visible archive without sending it as context for the next request. Use **Clear** only when you want to remove the archive as well.

## Reporting a problem

Include the Ableton Live version, bundled Max version, operating system, what you selected in Live, and the safe error message shown by MIDIjourney. Do not include authorization tokens, API keys, or private prompt/history content.
