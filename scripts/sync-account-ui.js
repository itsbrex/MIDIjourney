#!/usr/bin/env node
// Native Max controls only. The account panel never changes request dictionaries;
// account messages have their own route and never enter the MIDI clip pipeline.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const dark = [0.008976, 0, 0.086957, 1];
const white = [1, 1, 1, 1];
const cyan = [0.252174, 0.811837, 1, 1];
const pink = [0.975652, 0.46087, 1, 1];
const transparent = [0, 0, 0, 0];

function box(p, id, attributes) {
  let item = p.boxes.find((item) => item.box.id === id);
  if (!item) { item = { box: { id } }; p.boxes.push(item); }
  Object.assign(item.box, attributes);
  return item.box;
}
function cord(p, from, output, to, input = 0) {
  if (!p.lines.some(({ patchline: l }) => l.source[0] === from && l.source[1] === output && l.destination[0] === to && l.destination[1] === input)) {
    p.lines.push({ patchline: { source: [from, output], destination: [to, input] } });
  }
}
function uncord(p, from, to) {
  p.lines = p.lines.filter(({ patchline: l }) => !(l.source[0] === from && l.destination[0] === to));
}
function removeBox(p, id) {
  p.boxes = p.boxes.filter(({ box }) => box.id !== id);
  p.lines = p.lines.filter(({ patchline: l }) => l.source[0] !== id && l.destination[0] !== id);
}
function object(p, id, text, inputs = 1, outputs = 1) {
  const rect = p.boxes.find(({ box }) => box.id === id)?.box.patching_rect;
  return box(p, id, { maxclass: "newobj", text, numinlets: inputs, numoutlets: outputs, outlettype: Array(outputs).fill(""), patching_rect: rect || [20, 260 + p.boxes.length * 27, 280, 22] });
}
function message(p, id, text) {
  const rect = p.boxes.find(({ box }) => box.id === id)?.box.patching_rect;
  return box(p, id, { maxclass: "message", text, numinlets: 2, numoutlets: 1, outlettype: [""], patching_rect: rect || [340, 260 + p.boxes.length * 27, 250, 22] });
}
function textControl(p, id, text, rect, extra = {}) {
  return box(p, id, {
    maxclass: "live.text", text, texton: text, numinlets: 1, numoutlets: 2,
    outlettype: ["", ""], parameter_enable: 0, mode: 1, fontname: "Ableton Sans Bold",
    fontsize: 12, presentation: 1, presentation_rect: rect, patching_rect: rect,
    bgcolor: transparent, bgoncolor: transparent, activebgcolor: transparent,
    activebgoncolor: transparent, textcolor: white, textoffcolor: white,
    activetextcolor: white, activetextoncolor: white, bordercolor: transparent,
    focusbordercolor: transparent, rounded: 6, ...extra,
  });
}

function createAccountPanel() {
  const p = { fileversion: 1, appversion: { major: 9, minor: 0, revision: 3, architecture: "x64", modernui: 1 }, classnamespace: "box", rect: [100, 100, 680, 1000], openinpresentation: 1, default_fontname: "Arial", default_fontsize: 12, boxes: [], lines: [] };
  box(p, "frame", { maxclass: "panel", numinlets: 1, numoutlets: 0, presentation: 1, presentation_rect: [0, 0, 150, 42], patching_rect: [0, 0, 150, 42], bgcolor: dark, bordercolor: cyan, border: 2, rounded: 8 });
  textControl(p, "balance", "—", [6, 3, 100, 36], { fontsize: 26, mode: 0, active: 0, varname: "accountBalance", hint: "Available balance" });
  textControl(p, "dashboard", "↗", [112, 3, 32, 36], { fontname: "Arial", fontsize: 28, mode: 0, active: 1, varname: "accountDashboard", hint: "Open Pollinations dashboard" });
  for (const [id, index, cls, x] of [["state", 1, "inlet", 20], ["commands", 1, "outlet", 20]]) {
    box(p, id, { maxclass: cls, index, numinlets: cls === "inlet" ? 0 : 1, numoutlets: cls === "inlet" ? 1 : 0, patching_rect: [x, cls === "inlet" ? 210 : 230, 30, 30] });
  }
  object(p, "state-route", "route balance", 2, 2);
  cord(p, "state", 0, "state-route");
  cord(p, "state-route", 0, "balance");
  message(p, "dashboard-command", "accountDashboard");
  cord(p, "dashboard", 0, "dashboard-command");
  cord(p, "dashboard-command", 0, "commands");
  // External patchers can reload while Node is already connected. Ask for the
  // current state once the panel exists, without starting authorization.
  object(p, "ready", "loadbang");
  object(p, "ready-defer", "deferlow");
  message(p, "ready-status", "authStatus");
  cord(p, "ready", 0, "ready-defer");
  cord(p, "ready-defer", 0, "ready-status");
  cord(p, "ready-status", 0, "commands");
  // Max serializes frontmost boxes first. Keep the frame behind the controls.
  p.boxes.push(p.boxes.shift());
  return { patcher: p };
}

function installAccountUi(device) {
  const p = device.patcher;
  const j = p.boxes.find(({ box: b }) => b.id === "obj-45").box.patcher;
  for (const id of ["obj-8", "obj-19", "obj-25"]) {
    const b = p.boxes.find(({ box }) => box.id === id)?.box;
    if (b) { b.presentation = 0; b.hidden = 1; }
  }
  // Restore the original Create layout; account controls belong to Live's
  // embedded device panel, never to the floating prompt editor.
  box(j, "obj-6", { presentation_rect: [5, 5, 460, 55] });
  box(j, "obj-4", { presentation_rect: [5, 45, 460, 230] });
  removeBox(j, "obj-account-panel");
  box(p, "obj-pollinations-connect", { presentation: 1, hidden: 0, presentation_rect: [10, 85, 150, 28], hint: "Connect MIDIjourney to Pollinations" });
  // This is login, not a disconnect toggle. Rendering Connected is passive.
  message(p, "obj-pollinations-toggle-message", "connect");
  message(p, "obj-pollinations-status-connected", "text Connected, texton Connected, set 0, active 0");
  box(p, "obj-account-panel", { maxclass: "bpatcher", name: "mj_bp_account.maxpat", numinlets: 1, numoutlets: 1, outlettype: [""], patching_rect: [730, 650, 150, 42], presentation: 1, presentation_rect: [10, 118, 150, 42], offset: [0, 0], embed: 0, border: 0, clickthrough: 0, viewvisibility: 1, varname: "accountPanel" });
  object(j, "obj-account-route", "route account", 2, 2);
  uncord(j, "obj-pollinations-auth-route", "obj-22");
  cord(j, "obj-pollinations-auth-route", 2, "obj-account-route");
  object(j, "obj-account-prepend", "prepend account");
  cord(j, "obj-account-route", 0, "obj-account-prepend");
  cord(j, "obj-account-prepend", 0, "obj-1");
  cord(j, "obj-account-route", 1, "obj-22");
  object(p, "obj-account-route", "route account", 2, 2);
  uncord(p, "obj-pollinations-shared-output-route", "obj-8");
  cord(p, "obj-pollinations-shared-output-route", 1, "obj-account-route");
  cord(p, "obj-account-route", 0, "obj-account-panel");
  cord(p, "obj-account-route", 1, "obj-8");
  object(p, "obj-account-command-defer", "deferlow");
  cord(p, "obj-account-panel", 0, "obj-account-command-defer");
  cord(p, "obj-account-command-defer", 0, "obj-45", 1);
  object(j, "obj-account-command-defer", "deferlow");
  cord(j, "obj-account-command-defer", 0, "obj-41");
  uncord(j, "obj-4", "obj-account-panel");
  uncord(j, "obj-account-panel", "obj-1");
  cord(j, "obj-4", 0, "obj-1");
  textControl(j, "obj-history-context", "History", [373, 534, 86, 21], {
    mode: 1, parameter_enable: 1, varname: "historyContext", bgcolor: dark, bgoncolor: pink,
    activebgoncolor: pink, activetextoncolor: dark, bordercolor: pink,
    hint: "Include recent history as context for the next generation",
    saved_attribute_attributes: { valueof: { parameter_longname: "History context", parameter_shortname: "History", parameter_type: 2, parameter_enum: ["Off", "On"], parameter_initial_enable: 1, parameter_initial: [1], parameter_invisible: 1, parameter_modmode: 0 } },
  });
  object(j, "obj-history-context-message", "prepend historyStatus");
  cord(j, "obj-history-context", 0, "obj-history-context-message");
  cord(j, "obj-history-context-message", 0, "obj-1");
  object(j, "obj-history-context-ready", "live.thisdevice", 1, 3);
  object(j, "obj-history-context-defer", "deferlow");
  message(j, "obj-history-context-output", "outputvalue");
  cord(j, "obj-history-context-ready", 0, "obj-history-context-defer");
  uncord(j, "obj-history-context-defer", "obj-history-context");
  cord(j, "obj-history-context-defer", 0, "obj-history-context-output");
  cord(j, "obj-history-context-output", 0, "obj-history-context");
  object(j, "obj-account-active", "active");
  object(j, "obj-account-active-select", "sel 1", 2, 2);
  message(j, "obj-account-refresh", "authStatus");
  cord(j, "obj-account-active", 0, "obj-account-active-select");
  cord(j, "obj-account-active-select", 0, "obj-account-refresh");
  cord(j, "obj-account-refresh", 0, "obj-account-command-defer");
  // Transparent bpatchers still intercept clicks. These controls overlap the
  // prompt/history bpatcher margins, so they must be in front at the parent level.
  const frontIds = ["obj-history-context"];
  j.boxes = [...frontIds.map((id) => j.boxes.find(({ box }) => box.id === id)), ...j.boxes.filter(({ box }) => !frontIds.includes(box.id))];
  const deviceFrontIds = ["obj-pollinations-connect", "obj-account-panel"];
  p.boxes = [...deviceFrontIds.map((id) => p.boxes.find(({ box }) => box.id === id)), ...p.boxes.filter(({ box }) => !deviceFrontIds.includes(box.id))];
  p.parameters ||= {};
  delete p.parameters["obj-45::obj-account-panel::model"];
  delete p.parameters.parameter_overrides?.["obj-45::obj-account-panel::model"];
  p.parameters["obj-45::obj-history-context"] = ["History context", "History", 0];
  delete p.parameters["obj-8::obj-26"];
  delete p.parameters.parameter_overrides?.["obj-8::obj-26"];
  p.dependency_cache ||= [];
  if (!p.dependency_cache.some((d) => d.name === "mj_bp_account.maxpat")) {
    p.dependency_cache.push({ name: "mj_bp_account.maxpat", bootpath: "./patchers", patcherrelativepath: "./patchers", type: "JSON", implicit: 1 });
  }
  return device;
}

function writePatcher(name, document) {
  const filename = path.join(root, "patchers", `${name}.maxpat`);
  if (fs.existsSync(filename) && JSON.stringify(JSON.parse(fs.readFileSync(filename, "utf8"))) === JSON.stringify(document)) return;
  fs.writeFileSync(filename, `${JSON.stringify(document, null, "\t")}\n`);
}
function readPatcher(name) {
  return JSON.parse(fs.readFileSync(path.join(root, "patchers", `${name}.maxpat`), "utf8"));
}
function main() {
  writePatcher("mj_bp_account", createAccountPanel());
  const prompt = readPatcher("mj_bp_textPrompt");
  box(prompt.patcher, "obj-13", { presentation_rect: [5, 25, 450, 200] });
  box(prompt.patcher, "obj-3", { presentation_rect: [25, 40, 410, 170] });
  writePatcher("mj_bp_textPrompt", prompt);
  const selected = readPatcher("mj_bp_selectedClip");
  box(selected.patcher, "obj-16", { presentation_rect: [10, 10, 440, 21] });
  box(selected.patcher, "obj-32", { presentation_rect: [5, 5, 450, 30] });
  box(selected.patcher, "obj-13", { presentation_rect: [375, 35, 80, 21] });
  box(selected.patcher, "obj-12", { presentation_rect: [375, 36, 80, 18] });
  box(selected.patcher, "obj-33", { presentation_rect: [375, 25, 80, 20] });
  writePatcher("mj_bp_selectedClip", selected);
  const history = readPatcher("mj_bp_historyControl");
  for (const id of ["obj-2", "obj-3", "obj-1"]) box(history.patcher, id, { presentation: 0, hidden: 1 });
  writePatcher("mj_bp_historyControl", history);
  const preferences = readPatcher("mj_bp_preferences");
  box(preferences.patcher, "obj-26", { parameter_enable: 0 });
  writePatcher("mj_bp_preferences", preferences);
  const node = readPatcher("mj_nodeJS");
  object(node.patcher, "obj-account-commands", "routepass accountRefresh accountDashboard", 3, 3);
  uncord(node.patcher, "obj-pollinations-command-route", "obj-8");
  cord(node.patcher, "obj-pollinations-command-route", 4, "obj-account-commands");
  cord(node.patcher, "obj-account-commands", 0, "obj-pollinations-command-defer");
  cord(node.patcher, "obj-account-commands", 1, "obj-pollinations-command-defer");
  cord(node.patcher, "obj-account-commands", 2, "obj-8");
  object(node.patcher, "obj-account-output", "routepass account", 2, 2);
  cord(node.patcher, "obj-268", 5, "obj-account-output");
  cord(node.patcher, "obj-account-output", 0, "obj-2");
  writePatcher("mj_nodeJS", node);
}

if (require.main === module) main();
module.exports = { createAccountPanel, installAccountUi };
