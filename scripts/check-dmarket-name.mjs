// #77 explicit diagnostic; never imported by production collection.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { signDmarketRequest } from '../backend/dmarket-economics.mjs';
import { P0_CELLS, observeP0Identity } from '../backend/dmarket-p0.mjs';

// Diagnostic only: prefix information NEVER participates in identity acceptance.
const knownWears = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];
export function exactNameSignals(offer, baseName) {
  const name = offer?.attributes?.name, title = offer?.attributes?.title;
  const nameEquals = name === baseName;
  const titleMatches = knownWears.some(w => title === baseName + ' (' + w + ')');
  return { name_equals_base: nameEquals,
    title_starts_with_base: typeof title === 'string' && title.startsWith(baseName),
    title_matches_known_wear: titleMatches,
    name_length: typeof name === 'string' ? name.length : null,
    title_length: typeof title === 'string' ? title.length : null,
    exact_name_component: nameEquals ? (titleMatches ? 'NONE' : 'TITLE') : (titleMatches ? 'NAME' : 'BOTH') };
}
const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
export async function runDmarketNameDiagnostic({ env = process.env, fetcher = fetch, now = Date.now, pause = wait } = {}) {
  const start = now();
  const report = { event: 'DMARKET_NAME_DIAGNOSTIC_77', started_at: new Date(start).toISOString(),
    production_activated: false, planner_exercised: false, economic_authority: 'DMARKET_ONLY',
    limits: { requests: 2, rows_per_request: 5, response_bytes: 1048576, wall_seconds: 30 },
    calls: 0, cells: [], status: 'READ_COMPLETE' };
  async function request(cell, item, result) {
    if (report.calls) await pause(1100);
    if (report.calls >= 2 || now() - start >= 20000) throw Error('PROBE_BUDGET');
    const query = new URLSearchParams({ gameId: 'a8db', title: item.base_name, limit: '5' });
    const route = `/marketplace-api/v2/offers?${query}`, timestamp = String(Math.floor(now() / 1000));
    const signature = signDmarketRequest({ signRoute: route, timestamp, secretKey: env.DMARKET_SECRET_KEY });
    const record = { base_name: item.base_name, variant: 'NORMAL', mode: 'TITLE_ONLY',
      coverage: 'BOUNDED_SAMPLE_NOT_FULL_CELL', strict_identity_pass_count: 0, rejections: {}, name_signals: [] };
    result.requests.push(record);
    report.calls++;
    const response = await fetcher(new URL(route, 'https://api.dmarket.com'), { method: 'GET', redirect: 'error',
      signal: AbortSignal.timeout(Math.min(10000, Math.max(1, 30000 - (now() - start)))),
      headers: { Accept: 'application/json', 'X-Api-Key': env.DMARKET_PUBLIC_KEY.toLowerCase(),
        'X-Sign-Date': timestamp, 'X-Request-Sign': `dmar ed25519 ${signature}` } });
    record.http_status = response.status;
    record.observed_at = new Date(now()).toISOString();
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      record.retry_after_seconds = retry && /^\d{1,9}$/.test(retry) ? Number(retry) : null;
      await response.body?.cancel();
      throw Error(`HTTP_${response.status}`);
    }
    if (!response.body) throw Error('RESPONSE_SCHEMA');
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.length;
        if (bytes > 1048576) { await reader.cancel(); throw Error('RESPONSE_CAP'); }
        if (now() - start >= 30000) { await reader.cancel(); throw Error('PROBE_BUDGET'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const body = Buffer.concat(chunks);
    record.bytes = bytes;
    record.sha256 = createHash('sha256').update(body).digest('hex');
    let payload; try { payload = JSON.parse(body); } catch { throw Error('INVALID_JSON'); }
    record.envelope = { root: type(payload), items: type(payload?.items), cursor: type(payload?.cursor), total: type(payload?.total) };
    if (!Array.isArray(payload?.items) || payload.items.length > 5) throw Error('RESPONSE_SCHEMA');
    record.rows = payload.items.length;
    for (const offer of payload.items) {
      record.name_signals.push(exactNameSignals(offer, item.base_name));
      // Only a count can leave this diagnostic, even if the full validator passes.
      try { observeP0Identity(offer, cell, item, 'NORMAL'); record.strict_identity_pass_count++; }
      catch (error) {
        const code = /^DMARKET_P0_[A-Z_]+$/.test(error.message) ? error.message : 'IDENTITY_REJECTED';
        record.rejections[code] = (record.rejections[code] ?? 0) + 1;
      }
    }
    return record;
  }
  try {
    if (!/^[a-f0-9]{64}$/i.test(env.DMARKET_PUBLIC_KEY ?? '') || !env.DMARKET_SECRET_KEY) throw Error('CREDENTIAL_UNAVAILABLE');
    for (const cell of P0_CELLS.filter(c => c.collection_id === 'mirage-2021')) {
      const result = { collection_id: cell.collection_id, generation: cell.generation, rarity: cell.rarity, requests: [], finding: 'INCONCLUSIVE' };
      report.cells.push(result);
      const sample = await request(cell, cell.items[0], result);
      result.finding = sample.rows ? 'NAME_COMPONENT_SIGNALS_RECORDED' : 'EMPTY_SAMPLE_INCONCLUSIVE';
    }
  } catch (error) {
    report.status = 'BLOCKED';
    report.error = /^(?:HTTP_\d{3}|CREDENTIAL_UNAVAILABLE|PROBE_BUDGET|RESPONSE_CAP|INVALID_JSON|RESPONSE_SCHEMA)$/.test(error?.message ?? '') ? error.message : 'TRANSPORT_OR_SIGNING_UNAVAILABLE';
  }
  report.finished_at = new Date(now()).toISOString();
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runDmarketNameDiagnostic();
  console.log(JSON.stringify(report));
  if (report.status === 'BLOCKED') process.exitCode = 1;
}
