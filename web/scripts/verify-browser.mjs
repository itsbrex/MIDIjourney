import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const browser = process.argv[2];
if (!browser) throw new Error("Pass the agent-browser executable path. Start the local UI first.");
const { CONFIG } = createRequire(import.meta.url)("../../js/config.js");
const session = "midijourney-sdk-preview";
const base = process.env.MIDIJOURNEY_TEST_ORIGIN || "http://localhost:5178";
function run(...args) {
  try { return execFileSync(browser, ["--session", session, ...args], { encoding: "utf8", timeout: 20000 }); }
  catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).replaceAll(CONFIG.appKey, "[app identifier]");
    throw new Error(`Browser ${args[0]} failed: ${detail}`);
  }
}
function ref(label) {
  const line = run("snapshot", "-i").split("\n").find((line) => line.includes(label));
  assert.ok(line, `Missing UI: ${label}`);
  return `@${line.match(/ref=(e\d+)/)[1]}`;
}
const response = {
  model: "fixture-serving-model", choices: [{ message: { content: JSON.stringify({
    title: "Test melody", explanation: "A small phrase for verification.", key: "C major", duration: 8,
    notes: [{ pitch: 60, start_time: 0, duration: 1, velocity: 90 }],
  }) } }],
};
run("open", `${base}/`);
run("eval", `sessionStorage.removeItem(${JSON.stringify(`polli:${CONFIG.appKey}:token`)}); localStorage.removeItem(${JSON.stringify(`polli:${CONFIG.appKey}:token`)}); localStorage.removeItem("midijourney:workspace:v1"); "Isolated fixtures reset"`);
run("reload");
assert.doesNotMatch(run("snapshot", "-i"), /spinbutton|Length in beats|link "Pollinations"/);
assert.doesNotMatch(run("get", "text", "body"), /Browser preview/);
run("click", ref('switch "Toggle dark mode"'));
const mode = run("eval", "document.documentElement.classList.contains('dark')").trim();
const background = run("eval", "getComputedStyle(document.body).backgroundColor");
run("reload");
assert.equal(run("eval", "document.documentElement.classList.contains('dark')").trim(), mode);
run("click", ref('switch "Toggle dark mode"'));
assert.notEqual(run("eval", "getComputedStyle(document.body).backgroundColor"), background);
console.log("PASS: no length control, preview badge or brand header; package light/dark mode persists and changes colors.");

// Network fixtures live only in this isolated browser. They never create a
// provider account, mint a key, spend Pollen or touch the real Live Set.
run("network", "route", "https://enter.pollinations.ai/api/**", "--abort");
run("network", "route", "https://gen.pollinations.ai/**", "--body", JSON.stringify(response));
run("network", "route", "https://enter.pollinations.ai/authorize*", "--body", JSON.stringify({ fixture: "authorization-navigation-only" }));

run("fill", ref('textbox "Text prompt"'), "A simple testing melody");
run("click", ref('button "Connect"'));
run("wait", "--url", "**/authorize**");
assert.match(run("eval", "location.origin + location.pathname"), /https:\/\/enter.pollinations.ai\/authorize/);
// Use a test-only entry because this CLI's network mocks don't emulate CORS
// preflight. Production build excludes the fixture; application code is shared.
run("open", `${base}/test/browser.html`);
run("wait", '[data-polli="balance"]');
assert.match(run("get", "value", ref('textbox "Text prompt"')), /A simple testing melody/);
run("click", ref('button "Generate MIDI"'));
run("wait", "h2");
assert.match(run("get", "text", "h2"), /Test melody/);
assert.match(run("get", "text", "body"), /Model: fixture-serving-model/);
assert.doesNotMatch(run("get", "text", "body"), /Model used:/);
run("click", ref('button "Technical log'));
assert.match(run("get", "text", "body"), /Model used: fixture-serving-model/);
assert.match(run("get", "text", "body"), /Input: 123 · Output: 45 · Total: 168/);
run("click", ref('button "Technical details'));
assert.match(run("get", "text", "body"), /"finishReason": "stop"/);
assert.match(run("get", "text", "body"), /"pitch": 60/);
run("click", ref('button "Generate MIDI"'));
run("wait", "--fn", "document.body.innerText.includes('Call 2 · Received')");
assert.match(run("get", "text", "body"), /Call 1 · Received/);
run("click", ref('button "Technical log'));
console.log("PASS: optional per-call technical log shows model, provider token counts and validated output.");
run("click", ref('button "History'));
assert.match(run("get", "text", "body"), /# Prompt/);
run("screenshot", "/private/tmp/midijourney-sdk-generated.png");
console.log("PASS: shared SDK Connect navigation, mocked generation, actual-model attribution and History.");

// Exercise the package's own account menu, not a hand-built replacement.
const menu = run("snapshot", "-i").split("\n").find((line) => /button.*(?:App user menu|app user menu)/.test(line));
assert.ok(menu, "Shared account menu is present");
run("click", `@${menu.match(/ref=(e\d+)/)[1]}`);
assert.match(run("get", "text", "body"), /Top up account/);
run("press", "Escape");
run("set", "viewport", "390", "844");
assert.match(run("eval", "document.documentElement.scrollWidth <= innerWidth"), /true/);
run("screenshot", "/private/tmp/midijourney-sdk-mobile.png");
console.log("PASS: account menu and narrow-screen layout.");

run("reload");
run("click", ref('button "History'));
assert.match(run("get", "text", "body"), /# Prompt/);
assert.equal(run("errors").trim(), "");
console.log("PASS: persisted prompt/history and no page errors. No live provider or MIDI-write E2E was performed.");

run("open", `${base}/test/auth.html?role=live`);
run("click", ref('button "Connect"'));
run("wait", "--fn", "document.body.innerText.includes('Finish connecting in your browser.')");
assert.equal(run("eval", "location.origin").trim(), JSON.stringify(base));
run("click", ref('button "Cancel"'));
run("wait", "--fn", "document.body.innerText.includes('Connect') && !document.body.innerText.includes('Finish connecting')");
run("click", ref('button "Connect"'));
run("eval", "window.fixtureReady = true; 'Fixture ready'");
run("wait", '[data-polli="balance"]');
const events = run("eval", "window.fixtureEvents");
assert.match(events, /sdk-stored-session/);
assert.match(events, /finish/);
assert.match(events, /cancel/);
assert.equal(run("eval", "location.origin").trim(), JSON.stringify(base));
console.log("PASS: Live Connect stays in its window; cancellation, retry and SDK session delivery work with fake transport.");

run("open", `${base}/test/auth.html?role=browser`);
run("wait", '[data-polli="balance"]');
assert.doesNotMatch(run("eval", "window.fixtureEvents"), /complete/);
run("click", ref('button "Connect to Ableton Live"'));
run("wait", "--fn", "document.body.innerText.includes('Connected to Ableton Live.')");
assert.match(run("eval", "window.fixtureEvents"), /complete/);
assert.equal(run("errors").trim(), "");
run("screenshot", "/private/tmp/midijourney-browser-handoff.png");
console.log("PASS: browser requires account confirmation and waits for Live's acknowledgement before showing success.");

run("open", `${base}/test/browser.html?layout=live`);
run("wait", '[data-polli="balance"]');
assert.match(run("eval", "Boolean(document.querySelector('header h1')) && document.querySelectorAll('h1').length === 1"), /true/);
const beforeResize = run("get", "value", ref('textbox "Text prompt"'));
for (const [width, height] of [[760, 620], [540, 480], [1024, 760], [390, 660]]) {
  run("set", "viewport", String(width), String(height));
  assert.match(run("eval", "document.documentElement.scrollWidth <= innerWidth"), /true/);
  assert.match(run("eval", "parseFloat(getComputedStyle(document.querySelector('header h1')).fontSize) <= 24"), /true/);
  assert.match(run("eval", "parseFloat(getComputedStyle(document.querySelector('textarea')).fontSize) <= 14"), /true/);
  assert.match(run("eval", "document.querySelector('textarea').getBoundingClientRect().height <= innerHeight * 0.4"), /true/);
  assert.match(run("eval", "getComputedStyle(document.querySelector('textarea')).resize === 'vertical'"), /true/);
  assert.equal(run("get", "value", ref('textbox "Text prompt"')), beforeResize);
}
run("set", "viewport", "760", "620");
assert.match(run("eval", "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Technical log')).getBoundingClientRect().bottom < innerHeight"), /true/);
run("screenshot", "/private/tmp/midijourney-compact-dark.png");
run("click", ref('switch "Toggle dark mode"'));
run("screenshot", "/private/tmp/midijourney-compact-light.png");
run("click", ref('button "History'));
run("scroll", "down", "500", "--selector", "main");
assert.match(run("eval", "document.querySelector('header').getBoundingClientRect().top >= 0"), /true/);
assert.match(run("eval", "document.querySelector('main').scrollTop > 0 && document.querySelector('header').getBoundingClientRect().bottom <= document.querySelector('main').getBoundingClientRect().top"), /true/);
assert.equal(run("errors").trim(), "");
console.log("PASS: compact header and controls, responsive 390–1024px layout, viewport-aware prompt height and retained prompt during resizing.");
