const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createAccountPanel, installAccountUi } = require("../../scripts/sync-account-ui");
const root = path.resolve(__dirname, "../..");
const box = (p, id) => p.boxes.find(({ box }) => box.id === id)?.box;
const destinations = (p, id, output) => p.lines.filter(({ patchline: l }) => l.source[0] === id && (output === undefined || l.source[1] === output)).map(({ patchline: l }) => l.destination);
function device() {
  const bytes = fs.readFileSync(path.join(root, "MIDIjourney.source.amxd"));
  return JSON.parse(bytes.subarray(32, 32 + bytes.readUInt32LE(28)).toString().replace(/\0$/, ""));
}

test("account panel generation is deterministic and source installation is idempotent", () => {
  const generated = createAccountPanel();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "patchers/mj_bp_account.maxpat"))), generated);
  const first = installAccountUi(device());
  const snapshot = structuredClone(first);
  assert.deepEqual(installAccountUi(first), snapshot);
});

test("account lives in the embedded device and Create regains its original full-width MIDI Prompt", () => {
  const p = device().patcher;
  const j = box(p, "obj-45").patcher;
  assert.equal(box(p, "obj-33").presentation, 1);
  assert.equal(box(p, "obj-8").presentation, 0);
  assert.equal(box(p, "obj-pollinations-connect").presentation, 1);
  assert.equal(box(p, "obj-pollinations-connect").hidden, 0);
  assert.deepEqual(box(p, "obj-pollinations-connect").presentation_rect, [10, 85, 150, 28]);
  assert.deepEqual(box(p, "obj-account-panel").presentation_rect, [10, 118, 150, 42]);
  assert.deepEqual(box(j, "obj-6").presentation_rect, [5, 5, 460, 55]);
  assert.deepEqual(box(j, "obj-4").presentation_rect, [5, 45, 460, 230]);
  assert.equal(box(j, "obj-account-panel"), undefined);
  const prompt = JSON.parse(fs.readFileSync(path.join(root, "patchers/mj_bp_textPrompt.maxpat"))).patcher;
  assert.deepEqual(box(prompt, "obj-13").presentation_rect, [5, 25, 450, 200]);
  assert.deepEqual(box(prompt, "obj-3").presentation_rect, [25, 40, 410, 170]);
  const selected = JSON.parse(fs.readFileSync(path.join(root, "patchers/mj_bp_selectedClip.maxpat"))).patcher;
  for (const { box: b } of selected.boxes.filter(({ box }) => box.presentation)) {
    assert.ok(b.presentation_rect[0] + b.presentation_rect[2] <= 460, `${b.id} stays inside the MIDI row`);
  }
  assert.deepEqual(box(selected, "obj-16").presentation_rect, [10, 10, 440, 21]);
  assert.deepEqual(box(selected, "obj-32").presentation_rect, [5, 5, 450, 30]);
  assert.deepEqual(box(selected, "obj-13").presentation_rect, [375, 35, 80, 21]);
  assert.deepEqual(box(j, "obj-11").presentation_rect, [140, 275, 190, 35]);
  assert.deepEqual(box(j, "obj-13").presentation_rect, [5, 315, 460, 235]);
  assert.deepEqual(box(j, "obj-276").presentation_rect, [5, 530, 460, 60]);
  assert.equal(p.parameters["obj-45::obj-account-panel::model"], undefined);
  assert.ok(p.parameters["obj-45::obj-history-context"]);
  assert.equal(p.parameters["obj-8::obj-26"], undefined);
  // A bang toggles live.text; restoration must output its saved value instead.
  assert.equal(box(j, "obj-history-context-output").text, "outputvalue");
  assert.deepEqual(destinations(j, "obj-history-context-defer", 0), [["obj-history-context-output", 0]]);
  assert.deepEqual(destinations(j, "obj-history-context-output", 0), [["obj-history-context", 0]]);
});

test("account panel cannot decorate requests or intercept prompt notifications", () => {
  const p = createAccountPanel().patcher;
  for (const id of ["request", "request-route", "request-order", "request-dict", "model", "model-choice", "model-field", "result"]) assert.equal(box(p, id), undefined);
  const root = device().patcher;
  const j = box(root, "obj-45").patcher;
  assert.deepEqual(destinations(j, "obj-4", 0), [["obj-1", 0]]);
  assert.deepEqual(destinations(j, "obj-account-route", 0), [["obj-account-prepend", 0]]);
  assert.equal(box(j, "obj-account-prepend").text, "prepend account");
  assert.deepEqual(destinations(j, "obj-account-prepend", 0), [["obj-1", 0]]);
  assert.deepEqual(destinations(root, "obj-account-route", 0), [["obj-account-panel", 0]]);
  assert.deepEqual(destinations(root, "obj-account-route", 1), [["obj-8", 0]]);
  assert.deepEqual(destinations(root, "obj-account-panel"), [["obj-account-command-defer", 0]]);
  assert.deepEqual(destinations(root, "obj-account-command-defer"), [["obj-45", 1]]);
  assert.equal(box(root, "obj-account-panel").numinlets, 1);
  assert.equal(box(root, "obj-account-panel").numoutlets, 1);
});

test("account balance row contains only balance and dashboard arrow; login is a separate device control", () => {
  const p = createAccountPanel().patcher;
  assert.deepEqual(p.boxes.filter(({box}) => box.presentation).map(({box}) => box.id), ["balance", "dashboard", "frame"]);
  assert.equal(box(p, "balance").active, 0);
  assert.equal(box(p, "balance").text, "—");
  assert.equal(box(p, "balance").mode, 0);
  assert.equal(box(p, "state-route").text, "route balance");
  assert.deepEqual(destinations(p, "balance"), []);
  assert.equal(box(p, "dashboard").text, "↗");
  assert.equal(box(p, "dashboard").texton, "↗");
  assert.equal(box(p, "dashboard").hint, "Open Pollinations dashboard");
  assert.equal(box(p, "dashboard").fontname, "Arial");
  assert.equal(box(p, "dashboard").fontsize, 28);
  assert.equal(box(p, "dashboard").active, 1);
  assert.equal(box(p, "dashboard").mode, 0);
  assert.equal(box(p, "dashboard-command").text, "accountDashboard");
  assert.deepEqual(destinations(p, "dashboard", 0), [["dashboard-command", 0]]);
  assert.deepEqual(destinations(p, "dashboard-command", 0), [["commands", 0]]);
  for (const id of ["avatar", "picture", "connect", "connection", "connection-command", "menu", "model", "top-up", "top-up-command"]) assert.equal(box(p, id), undefined);
  assert.ok(p.boxes.every(({box}) => box.text !== "toggleConnection" && box.text !== "disconnect"));
});

test("all account controls fit the embedded device without overlapping active hit areas", () => {
  const p = createAccountPanel().patcher;
  assert.equal(p.boxes.at(-1).box.id, "frame", "background is behind the interactive controls in Max's z-order");
  for (const { box: b } of p.boxes.filter(({ box }) => box.presentation)) {
    const [x, y, width, height] = b.presentation_rect;
    assert.ok(x >= 0 && y >= 0 && x + width <= 150 && y + height <= 42, `${b.id} stays inside the balance row`);
  }
  const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  for (const ids of [["balance", "dashboard"]]) {
    for (let i = 0; i < ids.length; i += 1) for (let k = i + 1; k < ids.length; k += 1) {
      assert.equal(overlaps(box(p, ids[i]).presentation_rect, box(p, ids[k]).presentation_rect), false, `${ids[i]} and ${ids[k]} do not overlap`);
    }
  }
  const root = device().patcher;
  const ids = ["obj-33", "obj-pollinations-connect", "obj-account-panel"];
  for (const id of ids) {
    const [x, y, w, h] = box(root, id).presentation_rect;
    assert.ok(x >= 0 && y >= 0 && x + w <= root.devicewidth && y + h <= 170);
  }
  for (let i = 0; i < ids.length; i++) for (let k = i + 1; k < ids.length; k++) {
    assert.equal(overlaps(box(root, ids[i]).presentation_rect, box(root, ids[k]).presentation_rect), false);
  }
});

test("embedded login starts authorization without exposing disconnect or feeding state back into clicks", () => {
  const p = device().patcher;
  const login = box(p, "obj-pollinations-connect");
  assert.equal(login.parameter_enable, 0);
  assert.equal(box(p, "obj-pollinations-toggle-message").text, "connect");
  assert.deepEqual(destinations(p, login.id), [["obj-pollinations-toggle-message", 0]]);
  assert.deepEqual(destinations(p, "obj-pollinations-toggle-message"), [["obj-pollinations-command-defer", 0]]);
  assert.deepEqual(destinations(p, "obj-pollinations-command-defer"), [["obj-45", 1]]);
  assert.equal(box(p, "obj-pollinations-status-connected").text, "text Connected, texton Connected, set 0, active 0");
  assert.equal(box(p, "obj-pollinations-status-disconnected").text, "text Connect, texton Connect, set 0, active 1");
  assert.equal(box(p, "obj-pollinations-status-pending").text, "text Connecting..., texton Connecting..., set 0, active 0");
  for (const { box: b } of p.boxes.filter(({ box }) => box.presentation)) {
    assert.notEqual(b.text, "Disconnect");
    assert.notEqual(b.text, "toggleConnection");
  }
});

test("reloading the account patcher requests state once through a deferred command", () => {
  const p = createAccountPanel().patcher;
  assert.equal(box(p, "ready").text, "loadbang");
  assert.equal(box(p, "ready-defer").text, "deferlow");
  assert.equal(box(p, "ready-status").text, "authStatus");
  assert.deepEqual(destinations(p, "ready"), [["ready-defer", 0]]);
  assert.deepEqual(destinations(p, "ready-defer"), [["ready-status", 0]]);
  assert.deepEqual(destinations(p, "ready-status"), [["commands", 0]]);
  // State changes never enter the connect/disconnect message or click outlets.
  assert.deepEqual(destinations(p, "state-route", 1), []);
});

test("parent-level z-order keeps transparent prompt/history margins from swallowing clicks", () => {
  const j = box(device().patcher, "obj-45").patcher;
  const order = (id) => j.boxes.findIndex(({box}) => box.id === id);
  assert.equal(box(j, "obj-account-panel"), undefined, "account cannot intercept Create-window clicks");
  assert.ok(order("obj-history-context") < order("obj-276"), "History toggle is in front of the history bpatcher");
  assert.ok(order("obj-history-context") < order("obj-13"), "History toggle is in front of the explanation bpatcher");
});
