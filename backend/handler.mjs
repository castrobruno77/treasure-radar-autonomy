export function createHandler(store, { now = Date.now } = {}) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  return async function handle(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (url.pathname === '/health') return json({ ok: true, service: 'treasure-radar', mode: 'LOCAL_PILOT', auth: 'NOT_IMPLEMENTED' });
    if (url.pathname.startsWith('/v1/auth/')) return json({ error: 'STEAM_AUTH_NOT_CONFIGURED' }, 503);
    if (url.pathname !== '/v1/opportunities') return json({ error: 'NOT_FOUND' }, 404);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const status = url.searchParams.get('status') ?? 'CERTIFIED';
    const since = url.searchParams.get('since');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || status !== 'CERTIFIED' ||
        (since !== null && !Number.isFinite(Date.parse(since)))) return json({ error: 'INVALID_QUERY' }, 400);
    try {
      const snapshot = await store.read();
      if (!snapshot) return json({ error: 'NO_SUCCESSFUL_SCAN' }, 503);
      const capturedTimes = snapshot.items.map(x => Date.parse(x.captured_at));
      const oldest = Math.min(Date.parse(snapshot.generated_at), ...capturedTimes);
      if (!Number.isFinite(oldest) || oldest > now() + 5000) throw new Error('INVALID_SNAPSHOT_TIME');
      const age = Math.max(0, Math.floor((now() - oldest) / 1000));
      const items = snapshot.items.filter(x => x.status === 'CERTIFIED' && (!since || Date.parse(x.captured_at) > Date.parse(since))).slice(0, limit);
      return json({ ...snapshot, status: age > 300 ? 'STALE' : 'OK', freshness_seconds: age, items });
    } catch { return json({ error: 'SNAPSHOT_UNAVAILABLE' }, 503); }
  };
}
