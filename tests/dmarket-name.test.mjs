import test from 'node:test';
import assert from 'node:assert/strict';
import { exactNameSignals, runDmarketNameDiagnostic as run } from '../scripts/check-dmarket-name.mjs';
import { P0_CELLS, observeP0Identity } from '../backend/dmarket-p0.mjs';
const env = { DMARKET_PUBLIC_KEY: 'a'.repeat(64), DMARKET_SECRET_KEY: 'b'.repeat(64) };
const opts = { env, pause: async () => {} };
const cell = P0_CELLS[0], item = cell.items[0], base = item.base_name;
const row = (name = base, title = `${base} (Minimal Wear)`) => ({ offerId: 'PRIVATE-ID', priceCents: '123',
  attributes: { name, title, cs2: { collection: cell.source_collection, category: 'CATEGORY_NORMAL', quality: 'PRIVATE_QUALITY', float: '0.075' } } });
test('safe signals distinguish NAME, TITLE, BOTH and NONE without echoing values', () => {
  for (const [name, title, component] of [[base, `${base} (Minimal Wear)`, 'NONE'],
    ['PRIVATE_NAME', `${base} (Minimal Wear)`, 'NAME'], [base, 'PRIVATE_TITLE', 'TITLE'], ['PRIVATE_NAME', 'PRIVATE_TITLE', 'BOTH']]) {
    const s = exactNameSignals(row(name, title), base);
    assert.equal(s.exact_name_component, component);
    assert.equal(s.name_equals_base, name === base);
    assert.equal(s.name_length, name.length); assert.equal(s.title_length, title.length);
    assert.deepEqual(Object.keys(s).sort(), ['exact_name_component','name_equals_base','name_length','title_length','title_matches_known_wear','title_starts_with_base'].sort());
    assert.ok(!JSON.stringify(s).includes('PRIVATE_'));
  }
});
test('exact title signal mirrors unchanged validator for every wear and rejects deceptive prefixes', () => {
  const pairs = [['Factory New', '.06'], ['Minimal Wear', '.075'], ['Field-Tested', '.2'], ['Well-Worn', '.4'], ['Battle-Scarred', '.5']];
  for (const [wear, value] of pairs) {
    const r = row(base, `${base} (${wear})`); r.attributes.cs2.float = `0${value}`;
    assert.equal(exactNameSignals(r, base).exact_name_component, 'NONE');
    assert.doesNotThrow(() => observeP0Identity(r, cell, item, 'NORMAL'));
  }
  for (const title of [`${base} extra (Minimal Wear)`, `${base} (Unknown)`, `${base} (Minimal Wear) `,
    `StatTrak™ ${base} (Minimal Wear)`, `Souvenir ${base} (Minimal Wear)`, base.toLowerCase()]) {
    const r = row(base, title);
    assert.equal(exactNameSignals(r, base).exact_name_component, 'TITLE');
    assert.throws(() => observeP0Identity(r, cell, item, 'NORMAL'), /EXACT_NAME/);
  }
  assert.equal(exactNameSignals(row(base, base + ' extra'), base).title_starts_with_base, true);
});
test('missing/non-string fields yield booleans and null lengths, never coerced values', () => {
  for (const r of [null, {}, { attributes: { name: 123, title: ['PRIVATE'] } }]) {
    const s = exactNameSignals(r, base);
    assert.equal(s.exact_name_component, 'BOTH');
    assert.equal(s.name_length, null); assert.equal(s.title_length, null);
    assert.equal(s.title_starts_with_base, false);
  }
});
test('only two signed narrow GETs; no raw values even on strict identity success', async () => {
  const titles = [];
  const report = await run({ ...opts, fetcher: async (url, options) => {
    titles.push(url.searchParams.get('title'));
    assert.equal(url.origin, 'https://api.dmarket.com'); assert.equal(url.pathname, '/marketplace-api/v2/offers');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.match(options.headers['X-Request-Sign'], /^dmar ed25519 [a-f0-9]{128}$/);
    assert.deepEqual([...url.searchParams.keys()], ['gameId','title','limit']);
    assert.equal(url.searchParams.get('limit'), '5');
    const title = url.searchParams.get('title');
    return Response.json({ items: [row(title, `${title} (Minimal Wear)`), row('PRIVATE_NAME', 'PRIVATE_TITLE')], private: 'PRIVATE_RAW' });
  } });
  assert.deepEqual(titles, ['MAC-10 | Sienna Damask','P90 | Verdant Growth']);
  assert.equal(report.calls, 2); assert.equal(report.status, 'READ_COMPLETE');
  assert.equal(report.limits.requests, 2); assert.equal(report.production_activated, false);
  assert.equal(report.cells[0].requests[0].strict_identity_pass_count, 1);
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  assert.ok(report.cells.every(c => c.requests.length === 1 && c.requests[0].name_signals.length === 2));
});
test('empty samples never trigger alternate controls or filter comparisons', async () => {
  const report = await run({ ...opts, fetcher: async () => Response.json({ items: [] }) });
  assert.equal(report.calls, 2);
  assert.ok(report.cells.every(c => c.finding === 'EMPTY_SAMPLE_INCONCLUSIVE'));
});
test('other provenance guards still reject after exact-name success', async () => {
  for (const mutate of [r => r.attributes.cs2.collection = 'wrong', r => r.attributes.cs2.category = 'CATEGORY_STATTRAK',
    r => r.attributes.cs2.float = null, r => r.attributes.cs2.quality = null]) {
    const report = await run({ ...opts, fetcher: async () => { const r = row(); mutate(r); return Response.json({ items: [r] }); } });
    const req = report.cells[0].requests[0];
    assert.equal(req.name_signals[0].exact_name_component, 'NONE');
    assert.equal(req.strict_identity_pass_count, 0);
    assert.equal(Object.values(req.rejections).reduce((a,b) => a+b, 0), 1);
  }
});
test('HTTP/transport/schema/caps/credentials fail closed without retries or private errors', async () => {
  for (const status of [401,403,429,503]) {
    const r = await run({ ...opts, fetcher: async () => new Response('', {status}) });
    assert.equal(r.calls, 1); assert.equal(r.error, `HTTP_${status}`);
  }
  for (const [body,error] of [['x'.repeat(1048577),'RESPONSE_CAP'], ['oops','INVALID_JSON'], ['{}','RESPONSE_SCHEMA'], [JSON.stringify({items:Array(6).fill(null)}),'RESPONSE_SCHEMA']]) {
    const r = await run({ ...opts, fetcher: async () => new Response(body) });
    assert.equal(r.calls, 1); assert.equal(r.error, error);
  }
  const r = await run({ ...opts, fetcher: async () => { throw Error(env.DMARKET_SECRET_KEY); } });
  assert.equal(r.error, 'TRANSPORT_OR_SIGNING_UNAVAILABLE'); assert.ok(!JSON.stringify(r).includes(env.DMARKET_SECRET_KEY));
  const missing = await run({env:{},fetcher:()=>assert.fail('network')});
  assert.equal(missing.calls,0);
  let tick=0;
  const budget = await run({...opts,now:()=>tick++ ? 20000 : 0,fetcher:()=>assert.fail('network')});
  assert.equal(budget.error,'PROBE_BUDGET'); assert.equal(budget.calls,0);
});
