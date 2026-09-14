import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { makeDevice } from "../../scripts/device.mjs";

test("composer contains its action and reserves text space; explanations use compact leading", async () => {
	const workspace = await readFile(
		new URL("../src/Workspace.tsx", import.meta.url),
		"utf8",
	);
	const styles = await readFile(
		new URL("../src/style.css", import.meta.url),
		"utf8",
	);
	assert.match(
		workspace,
		/<Field.Root[^>]*mj-composer[\s\S]*mj-composer-action[\s\S]*Send[\s\S]*<\/Field.Root>/,
	);
	assert.doesNotMatch(workspace, /PromptClipboard/);
	assert.doesNotMatch(styles, /\.mj-prompt\s*\{[^}]*padding-right:/);
	assert.match(styles, /\.mj-composer\s*\{[^}]*padding-bottom: 3rem;/);
	assert.match(styles, /\.mj-send\s*\{[^}]*border-radius: 50%;/);
	assert.match(workspace, /aria-label="Send"/);
	assert.match(workspace, /<ArrowRightIcon aria-hidden="true"/);
	assert.match(styles, /\.mj-composer-action\s*\{[^}]*position: absolute;/);
	assert.match(styles, /\.mj-reply-explanation\s*\{[^}]*line-height: 1\.4;/);
});

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
	assert.match(footer, /unavailableReason \|\|/);
	assert.match(footer, /disabledReason \? \(\s*<Tooltip/);
	assert.match(footer, /content=\{disabledReason\}/);
	assert.match(footer, /triggerAs="span"\s+tapEnabled/);
	assert.match(footer, /disabled=\{Boolean\(disabledReason\)\}/);
	assert.doesNotMatch(
		footer,
		/Model used|Model:|replyPresentation|CopyDetails|mj-reply-meta|<Text/,
	);
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

test("chat cards remain distinct and compact without response copy controls", async () => {
	const [workspace, styles, footer] = await Promise.all(
		["Workspace.tsx", "style.css", "ReplyFooter.tsx"].map((filename) =>
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
	assert.doesNotMatch(
		workspace + footer + styles,
		/CopyDetails|Copy response|mj-copy-details/,
	);
	assert.match(styles, /\.mj-piano-roll\s*\{[^}]*height: 112px;/);
	assert.match(
		styles,
		/\.mj-roll-note\s*\{[^}]*var\(--polli-color-text-soft\) 80%/,
	);
	assert.match(workspace, /mj-user-message [^"]*px-3 py-2/);
});

test("smaller typography uses shared tokens without scaling the layout or shrinking MIDI", async () => {
	const styles = await readFile(
		new URL("../src/style.css", import.meta.url),
		"utf8",
	);
	assert.match(styles, /--text-sm: 0\.8125rem;/);
	assert.match(styles, /--polli-text-sm: var\(--text-sm\);/);
	assert.match(styles, /--polli-text-base: 0\.9375rem;/);
	assert.match(styles, /--polli-text-2xl: 1\.375rem;/);
	assert.match(
		styles,
		/\.mj-reply-title\s*\{[^}]*font-size: var\(--polli-text-base\);/,
	);
	assert.match(styles, /\.mj-piano-roll\s*\{[^}]*height: 112px;/);
	assert.doesNotMatch(styles, /\bzoom:|transform: scale\(/);
});

test("MIDI badges are single-line and only disabled creation has a hover tooltip", async () => {
	const components = await Promise.all(
		[
			"Workspace.tsx",
			"ReplyFooter.tsx",
			"PianoRoll.tsx",
			"MidiInputFeedback.tsx",
		].map((filename) =>
			readFile(new URL(`../src/${filename}`, import.meta.url), "utf8"),
		),
	);
	for (const component of components) {
		assert.doesNotMatch(component, /\stitle=|<title[\s>]/);
	}
	const badge = components[3].slice(
		components[3].indexOf("function MidiBadge"),
	);
	assert.match(badge, /className="min-w-0 truncate"/);
	assert.doesNotMatch(badge, /summary\.noteCount|title=/);
	assert.match(components[2], /aria-label=/);
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

test("compact header contains only new chat, account and shared color mode controls", async () => {
	const [app, workspace, styles] = await Promise.all(
		["App.tsx", "Workspace.tsx", "style.css"].map((filename) =>
			readFile(new URL(`../src/${filename}`, import.meta.url), "utf8"),
		),
	);
	assert.match(
		workspace,
		/<main[\s\S]*<Surface\s+role="region"\s+variant="panel"\s+className="mj-chat-panel [^"]*"[\s\S]*<ScrollArea[\s\S]*<\/ScrollArea>\s*<form[\s\S]*<\/form>[\s\S]*<\/Surface>/,
	);
	const header = workspace.match(/<header\b[\s\S]*?<\/header>/)?.[0];
	assert.ok(header);
	assert.match(
		header,
		/onClick=\{fresh\}[\s\S]*disabled=\{Boolean\(chat.sendingId\)\}[\s\S]*New chat[\s\S]*\{account\}[\s\S]*<ColorModeToggle \/>/,
	);
	assert.equal((workspace.match(/New chat/g) || []).length, 1);
	assert.doesNotMatch(header, /<Heading|<img|MIDI Journey/);
	assert.match(app, /account=\{\s*<LiveAccount/);
	assert.match(
		workspace,
		/function fresh\(\) \{\s*follow.current = true;\s*onNewChat\(\);\s*composer.current\?\.focus\(\);/,
	);
	assert.doesNotMatch(
		app + workspace + styles,
		/HeaderScene|ChatBottomScene|mj-header-scene|mj-chat-bottom-scene|mj-chat-top-scene/,
	);
	assert.match(styles, /\.mj-chat-panel\s*\{[^}]*overflow-y: auto;/);
	assert.match(
		styles,
		/\.mj-new-chat\s*\{[^}]*min-height: 2rem;[^}]*font-size: 0\.75rem;/,
	);
	assert.match(
		styles,
		/@media \(max-width: 319px\)[\s\S]*?\.mj-header\s*\{\s*flex-direction: column-reverse;/,
	);
});

test("archived website-v2 assets remain unchanged and are no longer used by the UI", async () => {
	for (const [mode, digest] of [
		["day", "af92ecefc9056151615464df49e1cde91fd22faab86ab0da7e782779c1d54a94"],
		[
			"night",
			"cd536868a37d86a9637669767a9c9743a13b3faa04ee859e0612500cfdc094e2",
		],
	]) {
		const asset = await readFile(
			new URL(`../src/assets/play-controls-${mode}.webp`, import.meta.url),
		);
		assert.equal(asset.subarray(8, 12).toString(), "WEBP");
		assert.equal(createHash("sha256").update(asset).digest("hex"), digest);
		assert.ok(
			asset.length < 20_000,
			"Original optimized Play asset stays small",
		);
	}
	const info = await readFile(
		new URL("../public/artwork-info.txt", import.meta.url),
		"utf8",
	);
	assert.match(info, /feat\/website-v2/);
	assert.match(info, /PlaygroundSky/);
	assert.match(info, /Copied unchanged/);
});

test("fresh chats introduce MIDI Journey in an assistant bubble without an API call or response controls", async () => {
	const workspace = await readFile(
		new URL("../src/Workspace.tsx", import.meta.url),
		"utf8",
	);
	const welcome = workspace
		.slice(
			workspace.indexOf("{!chat.turns.length ? ("),
			workspace.indexOf("chat.turns.map("),
		)
		.replace(/\s+/g, " ");
	assert.match(welcome, /className="mj-assistant-reply /);
	assert.match(welcome, /aria-label="Welcome from MIDI Journey"/);
	assert.match(welcome, /🎹 Hi, I’m MIDI Journey\./);
	assert.match(welcome, /<ul className="list-disc space-y-1 pl-4">/);
	assert.equal((welcome.match(/<li>/g) || []).length, 3);
	assert.match(
		welcome,
		/<strong>Select a Live clip<\/strong> to use its MIDI as input/,
	);
	assert.match(
		welcome,
		/<strong>Create clip<\/strong> fills an empty slot or replaces the selected clip\./,
	);
	assert.doesNotMatch(welcome, /clips stay intact/);
	assert.doesNotMatch(
		welcome,
		/<Heading|ReplyFooter|CopyDetails|onGenerate|fetch\(/,
	);
	assert.doesNotMatch(
		workspace,
		/What shall we make\?|Describe a musical idea\. Then/,
	);
});

test("header, notices, and chat share the 30-percent narrower app limit", async () => {
	const [app, workspace, styles] = await Promise.all(
		["App.tsx", "Workspace.tsx", "style.css"].map((filename) =>
			readFile(new URL(`../src/${filename}`, import.meta.url), "utf8"),
		),
	);
	assert.equal((workspace.match(/className="mj-app-width /g) || []).length, 3);
	assert.match(workspace, /<main className="mj-app-width /);
	assert.doesNotMatch(app + workspace, /max-w-5xl/);
	assert.match(styles, /\.mj-app-width\s*\{\s*max-width: 44\.8rem;/);
});

test("document title keeps the app name without a visible header title", async () => {
	const [app, html] = await Promise.all([
		readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
		readFile(new URL("../index.html", import.meta.url), "utf8"),
	]);
	assert.doesNotMatch(app, /<Heading|<HeaderScene/);
	assert.match(html, /<title>MIDI Journey \| pollinations\.ai<\/title>/);
});

test("production device is independent of the checkout and exposes only minimal controls", () => {
	const { patcher } = makeDevice();
	assert.doesNotMatch(
		JSON.stringify(patcher),
		/\/Users\/|persistent\/|extension\/|node_modules/,
	);
	assert.ok(
		patcher.boxes.some(
			({ box }) =>
				box.text === "node.script midijourney-server.js @autostart 1 @watch 0",
		),
	);
	const retry = patcher.boxes.find(({ box }) => box.id === "retry").box;
	assert.equal(retry.hidden, 1);
	assert.equal(
		patcher.boxes.find(({ box }) => box.id === "open").box.text,
		"Open",
	);
});
