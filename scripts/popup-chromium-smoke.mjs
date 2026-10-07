import assert from "node:assert/strict";
import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = fileURLToPath(new URL("../", import.meta.url));

function findChrome() {
  for (const candidate of [
    process.env.CHROME_PATH,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser"
  ].filter(Boolean)) {
    const found = spawnSync("which", [candidate], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error("CHROMIUM_NOT_FOUND");
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": contentTypes[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const { port } = server.address();
const chrome = findChrome();

async function dump(mode) {
  const url = `http://127.0.0.1:${port}/tests/popup-browser-harness.html?mode=${mode}`;
  const { stdout } = await execFile(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--virtual-time-budget=3000",
    "--dump-dom",
    url
  ], { maxBuffer: 2 * 1024 * 1024 });
  assert.match(stdout, /data-smoke-complete="true"/, `${mode} smoke did not complete`);
  return stdout;
}

try {
  const login = await dump("login");
  assert.match(login, /data-state="LOGIN_REQUIRED"/);
  assert.match(login, /id="steam-login"[^>]*>Entrar com Steam<\/button>/);
  assert.doesNotMatch(login, /id="auth-required"[^>]* hidden/);

  const ready = await dump("ready");
  assert.match(ready, /data-state="READY"/);
  assert.match(ready, /id="auth-required"[^>]* hidden/);

  const stale = await dump("stale");
  assert.match(stale, /data-state="STALE"/);
  assert.match(stale, /dados antigos/i);

  const error = await dump("error");
  assert.match(error, /data-state="ERROR"/);
  assert.match(error, /Não foi possível atualizar as oportunidades agora/i);

  const expired = await dump("expired");
  assert.match(expired, /data-state="LOGIN_REQUIRED"/);
  assert.match(expired, /sessão expirou/i);

  const cycle = await dump("cycle");
  assert.match(cycle, /data-smoke-sequence="LOGIN_REQUIRED,READY,LOGIN_REQUIRED"/);

  console.log("Chromium popup smoke: PASS");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
