const test = require("node:test");
const assert = require("node:assert/strict");
const { getColorCodeForScale } = require("../scaleColors.js");

test("maps enharmonic minor keys to the same Camelot color", () => {
  assert.equal(getColorCodeForScale("Ab minor"), getColorCodeForScale("G# minor"));
  assert.equal(getColorCodeForScale("C# minor"), getColorCodeForScale("Db minor"));
});

test("maps enharmonic major keys to the same Camelot color", () => {
  assert.equal(getColorCodeForScale("F# major"), getColorCodeForScale("Gb major"));
  assert.equal(getColorCodeForScale("C# major"), getColorCodeForScale("Db major"));
});

test("normalizes unicode accidentals and whitespace", () => {
  assert.equal(getColorCodeForScale("  G♯ minor "), getColorCodeForScale("Ab minor"));
});
