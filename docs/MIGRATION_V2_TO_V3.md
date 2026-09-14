# Moving to V3

V3 is a new persistent web-UI edition, not a skin over the old floating Max patchers.

- Keep an untouched copy of your old Set and original device.
- After the V3 release is published, remove the older MIDI Journey device from the working Set, then add the frozen V3 device to Main.
- Connect through the new Pollinations account menu. Old Keychain/device-code credentials are not imported, erased, or rotated.
- The old History drawer is replaced by one local conversation and New chat. Existing saved history stays with the older device/Set and is not migrated.
- Existing MIDI clips remain ordinary editable Live clips.
- Conversation and login live in embedded-browser storage, not per-device Set parameters.
- Do not load old and new editions simultaneously: both may use the same local port.

The old Max UI, intermediate web app and Ableton Extensions SDK edition are recoverable from `codex/archive-ui-experiments` at commit `6f326a1`. The downloaded proprietary Ableton SDK is not included in Git. `dev-mj2` is unchanged and is not the V3 base.
