// #67 explicit bounded one-shot. Never imported by runtime or scheduler.
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import catalog from '../backend/csdeals-catalog.json' with { type: 'json' };
import { createCsDealsClient, csdealsName, normalizeCsDealsListing, normalizeCsDealsAverages,
  normalizeCsDealsSales, csdealsPatientResale } from '../backend/csdeals.mjs';

export function surveyNames(averages, listings) {
  const anchors = catalog.items.map(row => {
    const a = averages.filter(x => x.base_name === row.base_name).sort((a,b) => b.sales-a.sales)[0];
    const l = listings.find(x => x.base_name === row.base_name);
    const f = (row.float_min + row.float_max) / 2;
    const wear = f < .07 ? 'Factory New' : f < .15 ? 'Minimal Wear' : f < .38 ? 'Field-Tested' : f < .45 ? 'Well-Worn' : 'Battle-Scarred';
    return a?.market_hash_name ?? l?.market_hash_name ?? `${row.base_name} (${wear})`;
  });
  // All 70 anchors first in the set, then other returned average series; prioritize
  // averages for current ask/history comparisons before the 180s observation cap.
  const names = [...new Set([...anchors, ...averages.map(x => x.market_hash_name)])].slice(0,140);
  return names.sort((a,b) => Number(averages.some(x=>x.market_hash_name===b))-Number(averages.some(x=>x.market_hash_name===a)));
}

export async function runHardeningProbe() {
  const start = Date.now(), deadline = start + 1500000;
  const report = { event: 'CSDEALS_HARDENING_V1', started_at: new Date(start).toISOString(),
    source_status: 'SOURCE_VALIDATING', production_grade: false, activation: false,
    caps: { listing_pages: 20, listings: 10000, sale_requests: 140, wall_seconds: 1500 },
    listing_pages: 0, observed: 0, catalog_title_rows: 0, identity_provenance: 0,
    exact_float: 0, accepted: 0, rejected: {}, inspect_shapes: {}, examples: [],
    responses: [], historical_samples: [], coverage: [], catalog_matrix: [],
    limitations: ['LISTINGS_BOUNDED_PREFIX', 'ONE_ANCHOR_SERIES_PER_IDENTITY_PLUS_RETURNED_AVERAGES',
      'MISSING_AVERAGE_IS_NO_RETURNED_EVIDENCE_NOT_ZERO_LIQUIDITY', 'HISTORY_NOT_FLOAT_AWARE',
      'RECENT_SALE_SETTLEMENT_UNVERIFIED', 'NATIVE_INSPECT_TRAILER_NOT_AUTHENTICATED', 'FEES_PARTIAL'] };
  const client = createCsDealsClient({env:{CSDEALS_API_KEY:process.env.CSDEALS_API_KEY,CSDEALS_READ_ONLY_AUTHORIZED:'true'}});
  const code = e => /^CSDEALS_[A-Z0-9_]+$/.test(e?.message??'') ? e.message : 'CSDEALS_PROBE_INVALID';
  const digest = (endpoint,r) => report.responses.push({endpoint,observed_at:r.observedAt,
    sha256:createHash('sha256').update(JSON.stringify(r.body)).digest('hex')});
  const listings = [], ids = new Set(), cursors = new Set(); let cursor;
  try {
    for(let page=0;page<20;page++) {
      if(Date.now()>deadline) throw Error('CSDEALS_DEADLINE');
      if(page) await wait(1100);
      const r=await client.listings({cursor}); digest('listings',r);
      if(!Array.isArray(r.body.listings) || r.body.listings.length>500 ||
          !(r.body.next_cursor===null || Number.isSafeInteger(r.body.next_cursor)&&r.body.next_cursor>0)) throw Error('CSDEALS_LISTING_PAGE');
      report.listing_pages++;
      for(const raw of r.body.listings) {
        if(!Number.isSafeInteger(raw?.id)||raw.id<=0||ids.has(raw.id)) throw Error('CSDEALS_LISTING_ID');
        ids.add(raw.id); report.observed++;
        let title; try { title=csdealsName(raw.market_hash_name); } catch {}
        const row=catalog.items.find(x=>x.base_name===title?.base_name);
        if(row) report.catalog_title_rows++;
        if(row) {
          // Only fixed format labels and byte counts; no URI fragment or payload.
          const m=typeof raw.cs_inspect_link==='string' && /^steam:\/\/run\/730\/\/\+csgo_econ_action_preview%20((?:[a-fA-F0-9]{2})+)$/.exec(raw.cs_inspect_link);
          const shape=m?`RUN_730_MASKED_HEX_${m[1].length/2}_BYTES`:'OTHER_OR_MISSING';
          report.inspect_shapes[shape]=(report.inspect_shapes[shape]??0)+1;
        }
        try {
          const l=normalizeCsDealsListing(raw,{observedAt:r.observedAt}); listings.push(l);
          report.identity_provenance++; report.exact_float++; report.accepted++;
        } catch(e) {
          const c=code(e);report.rejected[c]=(report.rejected[c]??0)+1;
          // These errors occur only AFTER the native membership/variant guard;
          // inspect/time errors also occur only AFTER the float/wear guard.
          if(['CSDEALS_WEAR','CSDEALS_FLOAT','CSDEALS_INSPECT','CSDEALS_TIMESTAMP','CSDEALS_FUTURE_LISTING'].includes(c)) report.identity_provenance++;
          if(['CSDEALS_INSPECT','CSDEALS_TIMESTAMP','CSDEALS_FUTURE_LISTING'].includes(c)) report.exact_float++;
        }
      }
      if(r.body.next_cursor===null) {report.listing_end_reached=true;break;}
      if(cursors.has(r.body.next_cursor)) throw Error('CSDEALS_CURSOR_REPEAT');
      cursor=r.body.next_cursor;cursors.add(cursor);
    }
    report.examples=listings.slice(0,6).map(l=>({source_listing_id:l.source_listing_id,market_hash_name:l.market_hash_name,
      collection_id:l.collection_id,rarity:l.rarity,variant:l.variant,price_usd:l.price_usd,exact_float:l.exact_float,
      inspect_format:l.inspect_format,observed_at:l.observed_at}));
    const groups=new Map();
    for(const l of listings) {const k=JSON.stringify([l.collection_id,l.rarity,l.variant,l.base_name]);groups.set(k,(groups.get(k)??0)+1);}
    report.coverage=[...groups].map(([k,count])=>({identity:JSON.parse(k),count}));
    const a=await client.averages();digest('averages',a);
    const averages=normalizeCsDealsAverages(a.body,{observedAt:a.observedAt});
    report.averages_total=a.body.averages.length;report.catalog_average_series=averages.length;
    report.average_generated_at=a.body.generated_at;report.window_days=a.body.window_days;
    const names=surveyNames(averages,listings);
    report.sales_series_requested=names.length;
    report.average_series_not_sampled=averages.filter(x=>!names.includes(x.market_hash_name)).length;
    for(let i=0;i<names.length;i++) {
      if(Date.now()>deadline) throw Error('CSDEALS_DEADLINE');
      if(i) await wait(5100);
      const name=names[i], s=await client.sales(name);digest('sales',s);
      const sample=normalizeCsDealsSales(s.body,{observedAt:s.observedAt,marketHashName:name});
      const average=averages.find(x=>x.market_hash_name===name), ask=listings.find(x=>x.market_hash_name===name);
      const end=Date.parse(a.body.generated_at), inWindow=sample.sales.filter(x=>Date.parse(x.sold_at)>=end-30*86400000&&Date.parse(x.sold_at)<=end);
      const distinct=new Set(inWindow.map(x=>JSON.stringify([x.sold_at,x.raw_price,x.amount]))).size;
      const age=sample.sales.length?(Date.parse(s.observedAt)-Date.parse(sample.sales[0].sold_at))/86400000:null;
      const latestInWindow=inWindow.length?(Date.parse(s.observedAt)-Date.parse(inWindow[0].sold_at))/86400000:null;
      const ref=csdealsPatientResale(ask,average,sample);
      report.historical_samples.push({market_hash_name:name,base_name:csdealsName(name).base_name,
        observed_at:s.observedAt,sample_rows:sample.sales.length,total_items:sample.total_items,
        sample_truncated:sample.total_items>100,distinct_30d:distinct,latest_sale_age_days:age,
        latest_qualifying_age_days:latestInWindow,sales_30d:average?.sales??null,volume_30d:average?.volume??null,
        average_usd:average?.price_usd??null,current_density_gate:!!average&&average.sales>=5&&average.volume>=5&&distinct>=3&&latestInWindow!==null&&latestInWindow<=7,
        reference_status:ref.status,reference_blocker:ref.blocker,
        examples:sample.sales.slice(0,2).map(x=>({sold_at:x.sold_at,price_usd:x.price_usd,amount:x.amount}))});
      console.log(JSON.stringify({event:'CSDEALS_HARDENING_PROGRESS',completed:i+1,total:names.length}));
    }
    report.catalog_matrix=catalog.items.map(row=>{
      const aa=averages.filter(x=>x.base_name===row.base_name), ss=report.historical_samples.filter(x=>x.base_name===row.base_name);
      return {base_name:row.base_name,collection_id:row.collection_id,rarity:row.rarity,
        accepted_listings:listings.filter(x=>x.base_name===row.base_name).length,
        returned_average_series:aa.length,returned_sales_30d:aa.length?aa.reduce((n,x)=>n+x.sales,0):null,
        surveyed_series:ss.length,sale_rows:ss.reduce((n,x)=>n+x.sample_rows,0),
        passing_series:ss.filter(x=>x.current_density_gate).length,
        average_evidence:aa.length?'RETURNED_SERIES':'NO_RETURNED_EVIDENCE'};
    });
    report.status='READ_COMPLETE';
  } catch(e) {report.status='BLOCKED';report.error=code(e);}
  report.finished_at=new Date().toISOString();report.elapsed_seconds=(Date.now()-start)/1000;
  console.log(JSON.stringify(report));
  if(report.status!=='READ_COMPLETE') process.exitCode=1;
  return report;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await runHardeningProbe();
