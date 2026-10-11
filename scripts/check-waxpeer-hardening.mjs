// #69 explicit read-only diagnostic. Never imported by scheduler/feed.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { createWaxpeerCatalog, normalizeWaxpeerListings, normalizeWaxpeerBids, waxpeerTiming } from '../backend/waxpeer.mjs';

export function catalogNames(items) {
  const names = new Map();
  for (const row of items) for (const [wear, lo, hi] of [
    ['Factory New',0,.07],['Minimal Wear',.07,.15],['Field-Tested',.15,.38],['Well-Worn',.38,.45],['Battle-Scarred',.45,1.000001]]) {
    if (row.float_max < lo || row.float_min >= hi) continue;
    for (const variant of ['NORMAL','SOUVENIR']) {
      if (!row[variant === 'NORMAL' ? 'normal_allowed' : 'souvenir_allowed']) continue;
      const name = `${variant === 'SOUVENIR' ? 'Souvenir ' : ''}${row.base_name} (${wear})`;
      if (names.has(name)) throw Error('AMBIGUOUS_CATALOG');
      names.set(name, {...row, variant, lo, hi});
    }
  }
  return names;
}

export function observedInteger(value) {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))) return null;
  const n=Number(value); return Number.isSafeInteger(n)&&n>=0?n:null;
}
export function floatJoin(ask, row, identity, observedAt) {
  const f = row?.float;
  return !!identity && typeof f === 'number' && Number.isFinite(f) &&
    f >= identity.float_min && f <= identity.float_max && f >= identity.lo && f < identity.hi &&
    row.item_id === ask.item_id && row.name === ask.market_hash_name && observedInteger(row.price) === ask.raw_price &&
    Date.parse(observedAt) >= Date.parse(ask.observed_at) && Date.parse(observedAt)-Date.parse(ask.observed_at) <= 180000;
}

export async function runProbe({env=process.env, fetcher=fetch, pause=wait, now=Date.now}={}) {
  const start=now(), report={event:'WAXPEER_HARDENING_69',started_at:new Date(start).toISOString(),
    caps:{requests:30,listing_rows:20000,response_bytes:33554432,wall_seconds:480,names:8},
    source_status:'SOURCE_VALIDATING',production_grade:false,bid_executable:false,
    calls:[],samples:[],matrix:[],errors:[]};
  let calls=0, blocked=false;
  const read=async(path,params={},auth=false,csv=false)=>{
    if(blocked || calls>=30 || now()-start>450000) throw Error('BUDGET_OR_BACKOFF');
    if(auth && !env.WAXPEER_API_KEY) throw Error('KEY_NOT_CONFIGURED');
    if(calls) await pause(3100);
    calls++;
    const url=new URL(path,'https://api.waxpeer.com');
    for(const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
    if(auth) url.searchParams.set('api',env.WAXPEER_API_KEY);
    const entry={path,authenticated:auth}; report.calls.push(entry);
    let response;
    try { response=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000)}); }
    catch { entry.error='TRANSPORT'; throw Error('TRANSPORT'); }
    entry.status=response.status;
    entry.http_date=response.headers.get('date');
    const retry=response.headers.get('retry-after');
    entry.retry_after_seconds=retry && /^\d+$/.test(retry)?Number(retry):null;
    if(!response.ok){blocked=true;await response.body?.cancel();throw Error('HTTP_REJECTED');}
    const reader=response.body.getReader(), chunks=[]; let bytes=0,lines=0,quoted=false,partial=false;
    try {
      outer: while(true){const {value,done}=await reader.read();if(done)break;
        let end=value.length;
        if(csv) for(let i=0;i<value.length;i++){
          if(value[i]===34)quoted=!quoted;
          if(value[i]===10&&!quoted&&++lines>=20001){end=i+1;partial=true;chunks.push(Buffer.from(value.subarray(0,end)));bytes+=end;await reader.cancel();break outer;}
        }
        bytes+=end;if(bytes>33554432){await reader.cancel();throw Error('BYTE_CAP');}chunks.push(Buffer.from(value));
      }
    } finally {reader.releaseLock();}
    if(bytes>33554432)throw Error('BYTE_CAP');
    const text=Buffer.concat(chunks).toString('utf8'), observedAt=new Date(now()).toISOString();
    entry.bytes=bytes;entry.observed_at=observedAt;entry.partial=partial;
    const body=csv?text:JSON.parse(text);
    if(!csv&&body?.success!==true){entry.source_success=false;blocked=true;throw Error('SOURCE_REJECTED');}
    return {body,observedAt,partial};
  };
  try {
    const data=JSON.parse(await readFile(new URL('../backend/csdeals-catalog.json',import.meta.url)));
    const names=catalogNames(data.items);
    const catalog=createWaxpeerCatalog([...names].map(([market_hash_name,r])=>({market_hash_name,
      variant:r.variant,collection:r.collection_id,rarity:r.rarity,evidence:{reference:'GitHub #63/#64',observed_at:'2026-10-09T00:00:00Z'}})));
    const raw=await read('/v1/prices/snapshot',{game:'csgo',format:'csv',include_hold:'1',include_manual:'1'},false,true);
    const listings=normalizeWaxpeerListings(raw.body,{observedAt:raw.observedAt,catalog});
    const br=await read('/v1/buy-orders/snapshot',{game:'csgo'});
    const bids=normalizeWaxpeerBids(br.body,{observedAt:br.observedAt,catalog});
    const p0=listings.filter(x=>names.has(x.market_hash_name)), byName=new Map(bids.map(x=>[x.market_hash_name,x]));
    report.public={listings:listings.length,bids:bids.length,coverage:raw.partial?'BOUNDED_PREFIX_NOT_FULL_SNAPSHOT':'RECEIVED_RESPONSE',
      p0_rows:p0.length,p0_bid_names:bids.filter(x=>names.has(x.market_hash_name)).length,
      p0_with_bid:p0.filter(x=>byName.has(x.market_hash_name)).length,
      p0_without_bid:p0.filter(x=>!byName.has(x.market_hash_name)).length,
      source_native_provenance_complete:0,listing_source_timestamp:null,listing_observed_at:raw.observedAt,
      bid_source_timestamp:bids[0]?.source_timestamp,bid_observed_at:br.observedAt,
      timing:p0.length?waxpeerTiming(p0[0],bids[0],now()):null};
    report.matrix=data.items.map(r=>{const ls=p0.filter(x=>names.get(x.market_hash_name).base_name===r.base_name);
      return {base_name:r.base_name,collection:r.collection_id,rarity:r.rarity,listings:ls.length,
        normal:ls.filter(x=>x.variant==='NORMAL').length,souvenir:ls.filter(x=>x.variant==='SOUVENIR').length,
        bid_names:bids.filter(x=>names.get(x.market_hash_name)?.base_name===r.base_name).length};});
    // Diverse collection sample first, then other exact titles. No fuzzy selection.
    const selected=[], collections=new Set(), selectedNames=new Set();
    const sorted=[...p0].sort((a,b)=>Number(byName.has(b.market_hash_name))-Number(byName.has(a.market_hash_name)));
    for(const ask of sorted) if(!collections.has(ask.collection_id)&&selected.length<8){selected.push(ask);collections.add(ask.collection_id);selectedNames.add(ask.market_hash_name);}
    for(const ask of sorted) if(!selectedNames.has(ask.market_hash_name)&&selected.length<8){selected.push(ask);selectedNames.add(ask.market_hash_name);}
    // Public prefix may have no P0. Still validate authorized access on canonical exact names.
    if(!selected.length) for(const bid of bids.filter(x=>names.has(x.market_hash_name)).slice(0,8))selected.push({...bid,item_id:null});
    report.credential_present=!!env.WAXPEER_API_KEY;
    if(!env.WAXPEER_API_KEY){report.status='PUBLIC_ONLY';return report;}
    for(const ask of selected){
      const sample={name:ask.market_hash_name,collection:ask.collection_id,rarity:ask.rarity,variant:ask.variant};report.samples.push(sample);
      const fr=await read('/v2/get-items-list',{game:'csgo',search:ask.market_hash_name,limit:'100',include_hold:'1'},true);
      if(!Array.isArray(fr.body.items)||fr.body.items.length>100)throw Error('FLOAT_SCHEMA');
      const exact=fr.body.items.filter(x=>x.name===ask.market_hash_name), identity=names.get(ask.market_hash_name);
      const publicById=new Map(p0.filter(x=>x.market_hash_name===ask.market_hash_name).map(x=>[x.item_id,x]));
      const joined=exact.filter(x=>publicById.has(x.item_id)&&floatJoin(publicById.get(x.item_id),x,identity,fr.observedAt));
      sample.float_rows=exact.length;sample.float_page_has_more=fr.body.has_more===true;sample.float_source_timestamp=null;
      sample.float_observed_at=fr.observedAt;sample.public_join_count=joined.length;
      sample.joined=joined.map(x=>{const p=publicById.get(x.item_id);return {item_id:x.item_id,price:observedInteger(x.price),float:x.float,public_observed_at:p.observed_at,
        inspect_present:!!p.inspect,delivery:p.delivery,unlock_at:p.unlock_at,send_until:p.send_until};});
      sample.float_examples=exact.filter(x=>typeof x.float==='number'&&Number.isFinite(x.float)).slice(0,2).map(x=>({
        item_id:/^\d{1,30}$/.test(x.item_id)?x.item_id:null,name:ask.market_hash_name,price:observedInteger(x.price),float:x.float,
        in_catalog_bounds:x.float>=identity.float_min&&x.float<=identity.float_max&&x.float>=identity.lo&&x.float<identity.hi}));
      const or=await read('/v1/buy-orders',{game:'csgo',name:ask.market_hash_name,skip:'0'},true);
      if(!Array.isArray(or.body.offers)||or.body.offers.length>100)throw Error('ORDER_SCHEMA');
      const orders=or.body.offers.filter(x=>x.name===ask.market_hash_name);
      sample.order_rows=orders.length;sample.order_observed_at=or.observedAt;sample.order_source_timestamp=null;
      sample.orders=orders.slice(0,5).map(x=>({price:observedInteger(x.price),price_type:typeof x.price,
        amount:observedInteger(x.amount),filled:observedInteger(x.filled)}));
      sample.public_bid_raw=byName.get(ask.market_hash_name)?.raw_price??null;
      sample.timing=waxpeerTiming(ask,byName.get(ask.market_hash_name),now());
      sample.remaining_executable_quantity=null;
      console.log(JSON.stringify({event:'WAXPEER_69_PROGRESS',completed:report.samples.length}));
    }
    report.status='READ_COMPLETE';
  } catch {report.status='INCOMPLETE_FAIL_CLOSED';report.errors.push('SANITIZED_PROBE_FAILURE');}
  finally {report.finished_at=new Date(now()).toISOString();report.elapsed_seconds=(now()-start)/1000;
    console.log(JSON.stringify(report));}
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await runProbe();
