const test = require("node:test");
const assert = require("node:assert/strict");
const { stripSensitiveFields } = require("../sanitize.js");

test("removes credential fields recursively without changing musical keys", () => {
  const input = {
    key: "C minor",
    apiKey: "removed",
    nested: {
      access_token: "removed",
      authorization: "removed",
      notes: [{ pitch: 60, token: "removed" }],
    },
  };
  assert.deepEqual(stripSensitiveFields(input), {
    key: "C minor",
    nested: { notes: [{ pitch: 60 }] },
  });
  assert.equal(input.apiKey, "removed");
});
