import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
if (manifest.manifest_version !== 3) {
  throw new Error("Extension must use Manifest V3");
}
if (!manifest.name || !manifest.version) {
  throw new Error("Manifest name/version missing");
}
console.log("Treasure Skins Radar bootstrap validation: PASS");
