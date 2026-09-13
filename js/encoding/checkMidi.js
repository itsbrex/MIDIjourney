const { validateNotes } = require("./midiClip.js");

function checkMidi(abletonMidi) {
  const errors = validateNotes(abletonMidi);
  return errors.length > 0 ? errors.join(", ") : null;
}

exports.checkMidi = checkMidi;
