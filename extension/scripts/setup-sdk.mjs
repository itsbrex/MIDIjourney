import { access, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = process.argv[2];
if (!source) throw new Error("Pass the extracted Ableton Extensions SDK folder.");
const archives = ["ableton-extensions-sdk-1.0.0-beta.1.tgz", "ableton-extensions-cli-1.0.0-beta.1.tgz"];
const destination = fileURLToPath(new URL("../.sdk/", import.meta.url));
await Promise.all(archives.map((name) => access(resolve(source, name))));
await mkdir(destination, { recursive: true });
await Promise.all(archives.map((name) => copyFile(resolve(source, name), resolve(destination, name))));
console.log("Local SDK archives staged. They are git-ignored; no SDK redistribution is configured.");
