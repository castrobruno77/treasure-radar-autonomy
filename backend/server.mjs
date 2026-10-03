import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { FileStore } from './store.mjs';
import { createHandler } from './handler.mjs';

// Deliberately loopback-only until the Steam/session and hosting gate is resolved.
export function startServer({ store, port = 8787 } = {}) {
  const handle = createHandler(store);
  const server = createServer(async (req, res) => {
    if (req.headers.host !== `127.0.0.1:${server.address().port}`) { res.writeHead(403).end(); return; }
    // No browser website CORS access. Extension requests use granted host permissions.
    if (req.headers.origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin)) { res.writeHead(403).end(); return; }
    try {
      const result = await handle(new Request(`http://127.0.0.1:${server.address().port}${req.url}`, { method: req.method }));
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(await result.text());
    } catch { res.writeHead(500).end(); }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const store = new FileStore(process.env.TSR_DATA_DIR || '.data');
  const server = await startServer({ store });
  console.log(`Treasure Radar local pilot: http://127.0.0.1:${server.address().port}`);
}
