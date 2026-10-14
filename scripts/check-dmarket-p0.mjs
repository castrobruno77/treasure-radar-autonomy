// Explicit #75 read-only mapping probe. Never imported by refresh or the feed.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { signDmarketRequest } from '../backend/dmarket-economics.mjs';
import { P0_CELLS, observeP0Identity } from '../backend/dmarket-p0.mjs';

export async function runDmarketP0Probe({ env = process.env, fetcher = fetch, now = Date.now, pause = wait } = {}) {
  const start = now();
  const report = { event: 'DMARKET_P0_MAPPING_PROBE_75', started_at: new Date(start).toISOString(),
    production_activated: false, planner_exercised: false, economic_authority: 'DMARKET_ONLY',
    limits: { requests: 24, rows_per_request: 5, response_bytes: 1048576, wall_seconds: 90 },
    cells: [], calls: 0, status: 'READ_COMPLETE' };
  try {
    if (!/^[a-f0-9]{64}$/i.test(env.DMARKET_PUBLIC_KEY ?? '') || !env.DMARKET_SECRET_KEY) throw Error('CREDENTIAL_UNAVAILABLE');
    for (const cell of P0_CELLS) {
      const result = { collection_id: cell.collection_id, generation: cell.generation, rarity: cell.rarity,
        observations: [], rejected: {}, requests: [] };
      report.cells.push(result);
      for (const variant of cell.variants) {
        if (report.calls >= 24 || now() - start >= 80000) throw Error('PROBE_BUDGET');
        if (report.calls) await pause(1100);
        const item = cell.items[0];
        const query = new URLSearchParams({ gameId: 'a8db', title: `${variant === 'SOUVENIR' ? 'Souvenir ' : ''}${item.base_name}`, limit: '5',
          treeFilters: `collection=${cell.source_collection},category=${variant.toLowerCase()}` });
        const route = `/marketplace-api/v2/offers?${query}`;
        const timestamp = String(Math.floor(now() / 1000));
        const signature = signDmarketRequest({ signRoute: route, timestamp, secretKey: env.DMARKET_SECRET_KEY });
        report.calls++;
        const response = await fetcher(new URL(route, 'https://api.dmarket.com'), { method: 'GET',
          redirect: 'error', signal: AbortSignal.timeout(Math.min(10000, Math.max(1, 90000 - (now() - start)))),
          headers: { Accept: 'application/json', 'X-Api-Key': env.DMARKET_PUBLIC_KEY.toLowerCase(),
            'X-Sign-Date': timestamp, 'X-Request-Sign': `dmar ed25519 ${signature}` } });
        const request = { variant, base_name: item.base_name, http_status: response.status,
          observed_at: new Date(now()).toISOString() };
        result.requests.push(request);
        if (!response.ok) {
          const retry = response.headers.get('retry-after');
          request.retry_after_seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
          await response.body?.cancel();
          throw Error(`HTTP_${response.status}`);
        }
        const reader = response.body.getReader(), chunks = []; let bytes = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            bytes += value.length;
            if (bytes > 1048576) { await reader.cancel(); throw Error('RESPONSE_CAP'); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        const body = Buffer.concat(chunks);
        request.sha256 = createHash('sha256').update(body).digest('hex');
        let payload; try { payload = JSON.parse(body); } catch { throw Error('INVALID_JSON'); }
        if (!Array.isArray(payload?.items) || payload.items.length > 5) throw Error('RESPONSE_SCHEMA');
        request.rows = payload.items.length;
        request.coverage = 'BOUNDED_SAMPLE_NOT_FULL_CELL';
        for (const offer of payload.items) {
          try { result.observations.push(observeP0Identity(offer, cell, item, variant)); }
          catch (error) {
            const code = /^DMARKET_P0_[A-Z_]+$/.test(error.message) ? error.message : 'IDENTITY_REJECTED';
            result.rejected[code] = (result.rejected[code] ?? 0) + 1;
          }
        }
      }
    }
  } catch (error) {
    report.status = 'BLOCKED';
    report.error = /^[A-Z0-9_]{1,80}$/.test(error?.message ?? '') ? error.message : 'PROBE_UNAVAILABLE';
  }
  report.finished_at = new Date(now()).toISOString();
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runDmarketP0Probe();
  console.log(JSON.stringify(report));
  if (report.status === 'BLOCKED') process.exitCode = 1;
}
