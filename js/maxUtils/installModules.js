const { max } = require("./max");

try {
  require.resolve("@pollinations/sdk");
  max.outlet("done");
} catch {
  max.outlet("error", "MIDIjourney dependencies are missing. Reinstall the official device.");
}
