import { execFile } from "node:child_process";

// Explicit UI actions only: no HTTP endpoint, polling, content logging or shell.
export function createClipboardHandler({
	run = execFile,
	platform = process.platform,
	reply,
}) {
	let busy = false;
	return async function handle(action, id, raw) {
		if (typeof id !== "string" || !/^[a-z0-9-]{1,80}$/.test(id)) return;
		if (busy) {
			reply(id, { ok: false, error: "Clipboard is busy." });
			return;
		}
		busy = true;
		try {
			if (platform !== "darwin" || (action !== "read" && action !== "write"))
				throw new Error();
			let text = "";
			if (action === "write") {
				if (typeof raw !== "string" || raw.length > 100000) throw new Error();
				text = JSON.parse(raw).text;
				if (typeof text !== "string" || text.length > 12000) throw new Error();
			}
			const output = await new Promise((resolve, reject) => {
				const child = run(
					action === "read" ? "/usr/bin/pbpaste" : "/usr/bin/pbcopy",
					action === "read" ? ["-Prefer", "txt"] : [],
					{ encoding: "utf8", timeout: 5000, maxBuffer: 128000, shell: false },
					(error, stdout) =>
						error
							? reject(new Error("Clipboard unavailable"))
							: resolve(stdout),
				);
				child.stdin?.on("error", () =>
					reject(new Error("Clipboard unavailable")),
				);
				child.stdin?.end(action === "write" ? text : undefined);
			});
			if (
				action === "read" &&
				(typeof output !== "string" || output.length > 12000)
			)
				throw new Error();
			reply(id, action === "read" ? { ok: true, text: output } : { ok: true });
		} catch {
			reply(id, {
				ok: false,
				error: "Clipboard unavailable or text exceeds 12,000 characters.",
			});
		} finally {
			busy = false;
		}
	};
}
