// #77 explicit diagnostic; never imported by production collection.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { signDmarketRequest } from '../backend/dmarket-economics.mjs';
import { P0_CELLS, observeP0Identity } from '../backend/dmarket-p0.mjs';

// Observational comparisons only; never used for admission or returned as raw text.
const alnum = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = value => value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const nameTokens = value => tokens(value).filter(t => t !== 'the' && t !== 'collection').sort();
export function collectionSignals(value, expected) {
  const valid = typeof value === 'string';
  const exact = valid && value === expected;
  const casefold = valid && value.toLowerCase() === expected.toLowerCase();
  const trim = valid && value.trim() === expected.trim();
  const normalized = valid && alnum(value) === alnum(expected);
  const expectedTokens = nameTokens(expected);
  const equivalent = valid && expectedTokens.length > 0 &&
    JSON.stringify(nameTokens(value)) === JSON.stringify(expectedTokens);
  return { collection_exact_match: exact, collection_casefold_match: casefold,
    collection_trim_match: trim, collection_alnum_normalized_match: normalized,
    collection_name_tokens_equivalent: equivalent,
    collection_length: valid ? value.length : null,
    collection_component: exact ? 'EXACT' : casefold ? 'CASE' : trim ? 'TRIM' :
      normalized ? 'NORMALIZED' : equivalent ? 'TOKEN_EQUIVALENT' : 'DIFFERENT' };
}
const counts = () => Object.fromEntries(['EXACT','CASE','TRIM','NORMALIZED','TOKEN_EQUIVALENT','DIFFERENT'].map(k => [k, 0]));
const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
export async function runDmarketCollectionDiagnostic({ env = process.env, fetcher = fetch, now = Date.now, pause = wait } = {}) {
  const start = now();
  const report = { event: 'DMARKET_COLLECTION_DIAGNOSTIC_77', started_at: new Date(start).toISOString(),
    production_activated: false, planner_exercised: false, economic_authority: 'DMARKET_ONLY',
    limits: { requests: 2, rows_per_request: 5, response_bytes: 1048576, wall_seconds: 30 },
    calls: 0, cells: [], status: 'READ_COMPLETE' };
  async function request(cell, item, result) {
    if (report.calls) await pause(1100);
    if (report.calls >= 2 || now() - start >= 20000) throw Error('PROBE_BUDGET');
    const query = new URLSearchParams({ gameId: 'a8db', title: item.base_name, limit: '5' });
    const route = `/marketplace-api/v2/offers?${query}`, timestamp = String(Math.floor(now() / 1000));
    const signature = signDmarketRequest({ signRoute: route, timestamp, secretKey: env.DMARKET_SECRET_KEY });
    const record = { variant: 'NORMAL', mode: 'TITLE_ONLY',
      coverage: 'BOUNDED_SAMPLE_NOT_FULL_CELL', strict_identity_pass_count: 0, rejections: {}, collection_signals: [], component_counts: counts(), all_five_rows_same_safe_pattern: false };
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
    let payload; try { payload = JSON.parse(body); } catch { throw Error('INVALID_JSON'); }
    record.envelope = { root: type(payload), items: type(payload?.items), cursor: type(payload?.cursor), total: type(payload?.total) };
    if (!Array.isArray(payload?.items) || payload.items.length > 5) throw Error('RESPONSE_SCHEMA');
    record.rows = payload.items.length;
    for (const offer of payload.items) {
      const signals = collectionSignals(offer?.attributes?.cs2?.collection, cell.source_collection);
      record.collection_signals.push(signals);
      record.component_counts[signals.collection_component]++;
      // Only a count can leave this diagnostic, even if the full validator passes.
      try { observeP0Identity(offer, cell, item, 'NORMAL'); record.strict_identity_pass_count++; }
      catch (error) {
        const code = /^DMARKET_P0_[A-Z_]+$/.test(error.message) ? error.message : 'IDENTITY_REJECTED';
        record.rejections[code] = (record.rejections[code] ?? 0) + 1;
      }
    }
    record.all_five_rows_same_safe_pattern = record.rows === 5 &&
      record.collection_signals.every(s => JSON.stringify(s) === JSON.stringify(record.collection_signals[0]));
    return record;
  }
  try {
    if (!/^[a-f0-9]{64}$/i.test(env.DMARKET_PUBLIC_KEY ?? '') || !env.DMARKET_SECRET_KEY) throw Error('CREDENTIAL_UNAVAILABLE');
    for (const [rarity, baseName] of [['Consumer Grade', 'MAC-10 | Sienna Damask'], ['Industrial Grade', 'P90 | Verdant Growth']]) {
      const cell = P0_CELLS.find(c => c.collection_id === 'mirage-2021' && c.rarity === rarity);
      const item = cell?.items.find(i => i.base_name === baseName);
      if (!item) throw Error('RESPONSE_SCHEMA');
      const result = { collection_id: cell.collection_id, generation: cell.generation, rarity: cell.rarity, requests: [], finding: 'INCONCLUSIVE' };
      report.cells.push(result);
      const sample = await request(cell, item, result);
      result.finding = sample.rows ? 'COLLECTION_COMPONENT_SIGNALS_RECORDED' : 'EMPTY_SAMPLE_INCONCLUSIVE';
    }
  } catch (error) {
    report.status = 'BLOCKED';
    report.error = /^(?:HTTP_\d{3}|CREDENTIAL_UNAVAILABLE|PROBE_BUDGET|RESPONSE_CAP|INVALID_JSON|RESPONSE_SCHEMA)$/.test(error?.message ?? '') ? error.message : 'TRANSPORT_OR_SIGNING_UNAVAILABLE';
  }
  report.finished_at = new Date(now()).toISOString();
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runDmarketCollectionDiagnostic();
  console.log(JSON.stringify(report));
  if (report.status === 'BLOCKED') process.exitCode = 1;
}
