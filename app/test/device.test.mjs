import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { makeDevice } from "../../scripts/device.mjs";

test("new device has stereo pass-through and an independent modeless web window", () => {
	const { patcher } = makeDevice(resolve("dist"));
	const boxes = new Map(patcher.boxes.map(({ box }) => [box.id, box]));
	assert.equal(boxes.get("audioin").text, "plugin~");
	assert.equal(boxes.get("audioout").text, "plugout~");
	for (const channel of [0, 1]) {
		assert.ok(
			patcher.lines.some(
				({ patchline: line }) =>
					line.source[0] === "audioin" &&
					line.source[1] === channel &&
					line.destination[0] === "audioout" &&
					line.destination[1] === channel,
			),
		);
	}
	const window = boxes.get("window").patcher;
	assert.equal(window.title, "MIDI Journey");
	const web = window.boxes.find(({ box }) => box.id === "web").box;
	assert.equal(web.maxclass, "jweb");
	assert.equal(web.presentation, 1);
	const flags = window.boxes.find(({ box }) => box.id === "config").box.text;
	assert.match(flags, /window flags grow/);
	assert.match(flags, /window flags float/);
	assert.doesNotMatch(
		JSON.stringify(patcher),
		/close_and_send|mj_bp_|mj_nodeJS/,
	);
});

test("workspace omits destination and success messages but keeps creation validation and errors", async () => {
	const workspace = await readFile(
		new URL("../src/Workspace.tsx", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		workspace,
		/New clip will be created in|Clip creation destination|\{live\.destination\}/,
	);
	assert.match(workspace, /clipCreationUnavailable\(live\)/);
	assert.match(workspace, /unavailableReason=\{creationUnavailable\}/);
	const footer = await readFile(
		new URL("../src/ReplyFooter.tsx", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(footer, /turn\.notice/);
	assert.match(footer, /\{turn\.writeError\}/);
	assert.match(footer, /\{unavailableReason\}/);
	const metadata = footer.slice(
		footer.indexOf('className="mj-reply-meta'),
		footer.indexOf('<div className="ml-auto'),
	);
	assert.match(metadata, /aria-label="Model used"/);
	assert.match(metadata, /<CopyDetails/);
	assert.doesNotMatch(metadata, /unavailableReason/);
});

test("conversation uses the shared scrollbar, quiet response titles, and a non-resizable blank composer", async () => {
	const workspace = await readFile(
		new URL("../src/Workspace.tsx", import.meta.url),
		"utf8",
	);
	const styles = await readFile(
		new URL("../src/style.css", import.meta.url),
		"utf8",
	);
	assert.match(workspace, /<ScrollArea\s/);
	assert.match(workspace, /ref=\{scroll\}/);
	assert.match(workspace, /onScroll=/);
	assert.doesNotMatch(
		workspace,
		/placeholder=|What would you like to change\?/,
	);
	assert.match(styles, /\.mj-prompt\s*\{[^}]*resize: none;/);
	assert.match(
		styles,
		/\.mj-composer\s*\{[^}]*border: 1px dotted var\(--color-theme-text-muted\);/,
	);
	assert.match(styles, /\.mj-composer\s*\{[^}]*background: transparent;/);
	assert.match(
		styles,
		/\.mj-composer:focus-within\s*\{[^}]*outline: 2px dotted var\(--color-theme-text-base\);/,
	);
	assert.match(
		styles,
		/\.mj-reply-title\s*\{[^}]*font-family: var\(--font-body\);/,
	);
});

test("chat cards use distinct shared colors and a clearly labeled response copy control", async () => {
	const [workspace, styles, copy] = await Promise.all(
		["Workspace.tsx", "style.css", "CopyDetails.tsx"].map((filename) =>
			readFile(new URL(`../src/${filename}`, import.meta.url), "utf8"),
		),
	);
	assert.match(workspace, /className="mj-user-message /);
	assert.match(workspace, /className="mj-assistant-reply /);
	assert.match(
		styles,
		/\.mj-user-message\s*\{[^}]*color-mix\([^}]*var\(--polli-color-bg-active\)/,
	);
	assert.match(
		styles,
		/\.mj-assistant-reply\s*\{\s*background: var\(--polli-color-surface-opaque\);/,
	);
	assert.match(copy, /aria-label="Copy response"/);
	assert.match(copy, /copied \? "Copied" : "Response"/);
	assert.match(copy, /<ClipboardIcon aria-hidden="true"/);
	assert.match(
		copy,
		/value=\{\(\) => copyDetails\(\{ calls, result, basedOn \}\)\}/,
	);
	assert.doesNotMatch(copy, /"Copy Details"/);
});

test("MIDI response cards have a comfortable maximum width without fixing their narrow-window width", async () => {
	const styles = await readFile(
		new URL("../src/style.css", import.meta.url),
		"utf8",
	);
	const reply = styles.match(/\.mj-assistant-reply\s*\{([^}]*)\}/)?.[1];
	assert.ok(reply);
	assert.match(reply, /max-width: 31\.5rem;/);
	assert.doesNotMatch(reply, /(?:^|[;\s])(?:width|min-width):/);
});

test("header, notices, and chat share the 30-percent narrower app limit", async () => {
	const [app, workspace, styles] = await Promise.all(
		["App.tsx", "Workspace.tsx", "style.css"].map((filename) =>
			readFile(new URL(`../src/${filename}`, import.meta.url), "utf8"),
		),
	);
	assert.equal((app.match(/className="mj-app-width /g) || []).length, 2);
	assert.match(workspace, /<main className="mj-app-width /);
	assert.doesNotMatch(app + workspace, /max-w-5xl/);
	assert.match(styles, /\.mj-app-width\s*\{\s*max-width: 44\.8rem;/);
});

test("app title uses MIDI Journey title case and Enter's shared section-heading style", async () => {
	const [app, html] = await Promise.all([
		readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
		readFile(new URL("../index.html", import.meta.url), "utf8"),
	]);
	assert.match(
		app,
		/<Heading\s+as="h1"\s+size="section"\s+className="polli:shrink-0 polli:font-medium"\s*>\s*MIDI Journey\s*<\/Heading>/,
	);
	assert.match(html, /<title>MIDI Journey \| pollinations\.ai<\/title>/);
});

test("production device is independent of the checkout and exposes only minimal controls", () => {
	const { patcher } = makeDevice();
	assert.doesNotMatch(JSON.stringify(patcher), /\/Users\/|persistent\/|extension\/|node_modules/);
	assert.ok(patcher.boxes.some(({box}) => box.text === "node.script midijourney-server.js @autostart 1 @watch 0"));
	const retry = patcher.boxes.find(({box}) => box.id === "retry").box;
	assert.equal(retry.hidden, 1);
	assert.equal(patcher.boxes.find(({box}) => box.id === "open").box.text, "Open");
});
