import { createServer } from 'node:http';
import { FileStore } from './store.mjs';
import { SupabaseRunsStore } from './persistence.mjs';
import { createRemoteHandler } from './remote-handler.mjs';
import { reportRemoteFeedPreparation } from './prepare-remote-feed.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { RefreshCoordinator, createRefreshWorker } from './refresh.mjs';

export function createRemoteStore(env = process.env) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseRunsStore({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  }
  return new FileStore(env.TSR_DATA_DIR || '.data');
}

export async function startRemoteServer({ env = process.env, port = Number(env.PORT || 8787) } = {}) {
  const store = createRemoteStore(env);
  const handle = createRemoteHandler({ store, env });
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || 'localhost';
      const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const request = new Request(`${protocol}://${host}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : req,
        duplex: 'half'
      });
      const response = await handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500, { 'Cache-Control': 'no-store' });
      res.end();
    }
  });
  return new Promise(resolve => server.listen(port, '0.0.0.0', () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await startRemoteServer();
  console.log(`Treasure Radar remote API listening on ${server.address().port}`);
  // Refresh takes precedence so bootstrap and recurring collection never race.
  if (process.env.TSR_REFRESH_ENABLED === 'true') {
    const worker = createRefreshWorker({ coordinator: new RefreshCoordinator() });
    worker.start();
    const shutdown = () => { worker.stop(); server.close(); };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } else if (process.env.TSR_BOOTSTRAP_FEED === 'true') {
    await reportRemoteFeedPreparation();
  }
}
