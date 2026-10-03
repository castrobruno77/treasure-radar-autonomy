import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const schema = JSON.parse(await readFile(new URL("../contracts/opportunity.schema.json", import.meta.url), "utf8"));

if (manifest.manifest_version !== 3) throw new Error("Extension must use Manifest V3");
if (!manifest.name || !manifest.version) throw new Error("Manifest name/version missing");
if (!manifest.action?.default_popup) throw new Error("Popup missing");
if (!Array.isArray(schema.required) || !schema.required.includes("status")) {
  throw new Error("Opportunity schema invalid");
}
console.log("Treasure Skins Radar validation: PASS");
