// Explicit, one-shot read-only probe. Never imported by scheduler/feed/runtime.
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { createCsDealsClient, normalizeCsDealsListings, normalizeCsDealsAverages,
  normalizeCsDealsSales, csdealsPatientResale } from '../backend/csdeals.mjs';
import catalog from '../backend/csdeals-catalog.json' with { type: 'json' };

const report = { event: 'CSDEALS_READ_ONLY_PROBE_V1', started_at: new Date().toISOString(),
  source_status: 'SOURCE_VALIDATING', activation: false, production_grade: false,
  credential: 'CSDEALS_API_KEY: existing Railway secret referenced by scale-scheduler',
  listing_pages: 0, listing_rows: 0, compatible_rows: 0, rejected: {}, mapping_observations: [],
  listing_examples: [], historical_samples: [], responses: [], limitations: [
    'BOUNDED_PREFIX_NOT_FULL_MARKET', 'HISTORY_NOT_FLOAT_AWARE', 'FEES_PARTIAL',
    'SALES_SETTLEMENT_UNVERIFIED_IN_RECENT_ROWS', 'NO_RANKING_ACTIVATION'] };
const client = createCsDealsClient({ env: { CSDEALS_API_KEY: process.env.CSDEALS_API_KEY,
  CSDEALS_READ_ONLY_AUTHORIZED: 'true' } });
const errorCode = e => /^CSDEALS_[A-Z0-9_]+$/.test(e?.message ?? '') ? e.message : 'CSDEALS_PROBE_UNAVAILABLE';
const digest = (endpoint, response) => report.responses.push({ endpoint, observed_at: response.observedAt,
  sha256: createHash('sha256').update(JSON.stringify(response.body)).digest('hex') });
try {
  const listings = [], seen = new Set(), rawMappings = new Map(); let cursor;
  for (let page = 0; page < 10; page++) {
    if(page) await wait(1100);
    const response = await client.listings({ cursor }); digest('listings', response);
    const normalized = normalizeCsDealsListings(response.body, { observedAt: response.observedAt });
    report.listing_pages++; report.listing_rows += normalized.raw_count;
    for(const [k,v] of Object.entries(normalized.rejected)) report.rejected[k]=(report.rejected[k]??0)+v;
    listings.push(...normalized.listings);
    // Only catalog-matched titles are included; no arbitrary body/account fields.
    for(const r of response.body.listings) {
      const base = typeof r.market_hash_name === 'string' ? r.market_hash_name.replace(/^(Souvenir |StatTrak™ )/,'').replace(/ \([^()]+\)$/,'') : null;
      const c = catalog.items.find(x=>x.base_name===base);
      if(c) {
        const value={ base_name:c.base_name, expected_collection:c.collection_id, expected_rarity:c.rarity,
          cs_collection:typeof r.cs_collection==='string'?r.cs_collection.slice(0,100):null,
          cs_rarity:typeof r.cs_rarity==='string'?r.cs_rarity.slice(0,80):null,
          cs_is_souvenir:r.cs_is_souvenir===true, cs_is_stattrak:r.cs_is_stattrak===true };
        rawMappings.set(JSON.stringify(value),value);
      }
    }
    if(normalized.next_cursor===null) break;
    if(seen.has(normalized.next_cursor)) throw Error('CSDEALS_CURSOR_REPEAT');
    cursor=normalized.next_cursor; seen.add(cursor);
  }
  report.compatible_rows=listings.length;
  report.mapping_observations=[...rawMappings.values()];
  report.listing_examples=listings.slice(0,6).map(r=>({source_listing_id:r.source_listing_id,market_hash_name:r.market_hash_name,
    collection_id:r.collection_id,generation:r.generation,rarity:r.rarity,variant:r.variant,exact_float:r.exact_float,
    inspect_present:!!r.inspect,price_usd:r.price_usd,raw_price_cents:r.raw_price,paint_index:r.paint_index,
    observed_at:r.observed_at,source_timestamp:r.source_timestamp,trade_locked_until:r.trade_locked_until}));
  const a=await client.averages();digest('sales/averages',a);
  const averages=normalizeCsDealsAverages(a.body,{observedAt:a.observedAt});
  report.averages_total=a.body.averages.length;report.catalog_averages=averages.length;
  report.average_generated_at=a.body.generated_at;report.window_days=a.body.window_days;
  const matching=[...new Set(listings.map(r=>r.market_hash_name))].filter(n=>averages.some(r=>r.market_hash_name===n));
  // Prefer observed listings, then factual catalog averages when prefix has none.
  const names=[...new Set([...matching,...averages.map(r=>r.market_hash_name)])].slice(0,6);
  for(let i=0;i<names.length;i++) {
    if(i) await wait(5100);
    const name=names[i];
    try {
      const s=await client.sales(name);digest('sales',s);
      const sample=normalizeCsDealsSales(s.body,{observedAt:s.observedAt,marketHashName:name});
      const average=averages.find(r=>r.market_hash_name===name), ask=listings.find(r=>r.market_hash_name===name);
      const ref=csdealsPatientResale(ask,average,sample);
      report.historical_samples.push({market_hash_name:name,sample_count:sample.sales.length,distinct_sample:sample.distinct_sample,
        total_items:sample.total_items,latest_sold_at:sample.sales[0]?.sold_at??null,
        examples:sample.sales.slice(0,3).map(r=>({raw_price_cents:r.raw_price,price_usd:r.price_usd,amount:r.amount,sold_at:r.sold_at})),
        average_price_usd:average.price_usd,sales_30d:average.sales,volume_30d:average.volume,
        sales_executed:sample.sales.some(r=>r.confidence_flags.includes('SALES_EXECUTED')),reference:ref});
    } catch(e) { report.historical_samples.push({market_hash_name:name,error:errorCode(e)}); }
  }
  report.status='READ_COMPLETE';
} catch(e) { report.status='BLOCKED';report.error=errorCode(e); }
report.finished_at=new Date().toISOString();
// Single structured safe record; never dump process.env, HTTP bodies or exceptions.
console.log(JSON.stringify(report));
if(report.status==='BLOCKED') process.exitCode=1;
