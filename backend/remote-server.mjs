import { createServer } from 'node:http';
import { FileStore } from './store.mjs';
import { SupabaseRunsStore } from './persistence.mjs';
import { createRemoteHandler } from './remote-handler.mjs';
import { reportRemoteFeedPreparation } from './prepare-remote-feed.mjs';

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startRemoteServer();
  console.log(`Treasure Radar remote API listening on ${server.address().port}`);
  // Opt-in for the controlled rollout; no timer, retries or request-triggered scans.
  // Bind first so a bounded (up to 105s) scan cannot fail the liveness healthcheck.
  if (process.env.TSR_BOOTSTRAP_FEED === 'true') {
    await reportRemoteFeedPreparation();
  }
}
