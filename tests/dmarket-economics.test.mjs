import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDmarketClient,
  conservativeFee,
  enrichDmarketEconomics,
  normalizeSales,
  normalizeTargets,
  observeDmarketEconomics,
  signDmarketRequest
} from '../backend/dmarket-economics.mjs';
import { applyScoring } from '../backend/scoring.mjs';

const PUBLIC = '11'.repeat(32);
const SECRET = '22'.repeat(32);

function item(overrides={}) {
  return applyScoring({
    id:'dmarket:test', source:'DMarket', collection:'The 2021 Mirage Collection', rarity:'Consumer Grade',
    market_hash_name:'AK-47 | Redline (Field-Tested)', normalized_float:0.03, robust_gap_pct:50,
    peer_count:4, listing_url:'https://dmarket.com/test', captured_at:'2026-10-08T00:00:00.000Z',
    status:'CERTIFIED', price_usd:10, ...overrides
  });
}

test('DMarket signer emits a 64-byte Ed25519 signature and signs decoded route values', () => {
  const signature = signDmarketRequest({
    method:'GET',
    signRoute:'/marketplace-api/v1/targets-by-title/a8db/AK-47 | Redline (Field-Tested)',
    timestamp:'1791427200',
    secretKey:SECRET
  });
  assert.match(signature,/^[0-9a-f]{128}$/);
});

test('DMarket client transmits encoded path but authenticates with existing keys', async () => {
  const calls=[];
  const client=createDmarketClient({
    env:{DMARKET_PUBLIC_KEY:PUBLIC,DMARKET_SECRET_KEY:SECRET},
    now:()=>Date.parse('2026-10-08T00:00:00Z'),
    fetcher:async (url,options)=>{
      calls.push({url:String(url),headers:options.headers});
      return Response.json({orders:[]});
    }
  });
  await client.targetsByTitle('AK-47 | Redline (Field-Tested)');
  assert.match(calls[0].url,/AK-47%20%7C%20Redline%20\(Field-Tested\)$/);
  assert.equal(calls[0].headers['X-Api-Key'],PUBLIC);
  assert.match(calls[0].headers['X-Request-Sign'],/^dmar ed25519 [0-9a-f]{128}$/);
});

test('target normalization uses only exact-title generic executable targets', () => {
  const normalized=normalizeTargets({orders:[
    {title:'AK-47 | Redline (Field-Tested)',price:'1500',amount:'2',attributes:{floatPartValue:'any',paintSeed:'any',phase:'any'}},
    {title:'AK-47 | Redline (Field-Tested)',price:'1500',amount:'1',attributes:{}},
    {title:'AK-47 | Redline (Field-Tested)',price:'1490',amount:'5',attributes:{floatPartValue:'FT-0'}},
    {title:'other',price:'2000',amount:'99',attributes:{}}
  ]},'AK-47 | Redline (Field-Tested)');
  assert.deepEqual(normalized,{best_bid_usd:15,best_bid_quantity:3,depth_5pct_quantity:3,observed_levels:2});
});

test('fee basis never assumes zero and does not guess undocumented minAmount units', () => {
  assert.deepEqual(conservativeFee({defaultFee:{fraction:'0.02',minAmount:1}}),{
    api_default_fraction:0.02,
    api_min_amount_raw:1,
    api_min_amount_interpretation:'UNSPECIFIED_NOT_USED',
    seller_fee_fraction:0.10,
    buyer_fee_fraction:0,
    basis:'DMARKET_API_DEFAULT_PLUS_PUBLIC_CS2_MAX_10_PERCENT_2026_03',
    reduced_fee_ignored_conservatively:true
  });
  assert.equal(conservativeFee({defaultFee:{fraction:'bad',minAmount:1}}),null);
  assert.equal(conservativeFee({defaultFee:{fraction:'0.02',minAmount:-1}}),null);
});

test('sales history remains observed evidence with recency', () => {
  const observed=Date.parse('2026-10-08T00:00:00Z');
  const history=normalizeSales({sales:[
    {price:'12.00',date:String(Math.floor((observed-86400000)/1000)),txOperationType:'Offer'},
    {price:'14.00',date:String(Math.floor((observed-172800000)/1000)),txOperationType:'Target'}
  ]},observed);
  assert.equal(history.sample_count,2);
  assert.equal(history.median_price_usd,13);
  assert.equal(history.target_sale_count,1);
  assert.equal(history.offer_sale_count,1);
  assert.equal(history.latest_sale_age_days,1);
});

test('QUICK EXIT produces transparent same-market economics and both scores', async () => {
  let clock=Date.parse('2026-10-08T00:00:05Z');
  const sales=Array.from({length:10},(_,i)=>({
    price:String(13+i/10),
    date:String(Math.floor((clock-(i+1)*3600000)/1000)),
    txOperationType:i%2?'Offer':'Target'
  }));
  const client={
    targetsByTitle:async()=>({orders:[
      {title:'AK-47 | Redline (Field-Tested)',price:'1500',amount:'2',attributes:{}},
      {title:'AK-47 | Redline (Field-Tested)',price:'1400',amount:'4',attributes:{}}
    ]}),
    feeSchedule:async()=>({defaultFee:{fraction:'0.02',minAmount:0},reducedFees:[]}),
    lastSales:async()=>({sales})
  };
  const observed=await observeDmarketEconomics(item(),{
    client,now:()=>clock,feePromise:client.feeSchedule()
  });
  assert.equal(observed.status,'COMPLETE');
  assert.equal(observed.ask_usd,10);
  assert.equal(observed.conservative_exit_usd,15);
  assert.equal(observed.seller_fee_usd,1.5);
  assert.equal(observed.estimated_net_exit_usd,13.5);
  assert.equal(observed.estimated_net_profit_usd,3.5);
  assert.equal(observed.estimated_margin_pct,35);
  assert.equal(observed.depth_5pct_quantity,2);
  assert.equal(observed.skew_seconds,5);
  assert.equal(observed.withdrawal_fee_status,'N_D_NOT_INCLUDED');

  const snapshot={items:[item()]};
  await enrichDmarketEconomics(snapshot,{
    env:{DMARKET_PUBLIC_KEY:PUBLIC,DMARKET_SECRET_KEY:SECRET},
    now:()=>clock,
    fetcher:async url=>{
      const path=new URL(url).pathname;
      if(path.includes('targets-by-title')) return Response.json(await client.targetsByTitle());
      if(path.includes('customized-fees')) return Response.json(await client.feeSchedule());
      if(path.includes('last-sales')) return Response.json(await client.lastSales());
      return new Response(null,{status:404});
    }
  });
  const scored=snapshot.items[0];
  assert.equal(scored.economic_action_score,85);
  assert.equal(scored.quality_score,78.7);
  assert.equal(scored.action_tier,'TREASURE');
  assert.equal(scored.economic_evidence.components.net_margin.points,45);
  assert.equal(scored.economic_evidence.components.executable_buy_side_depth.points,15);
  assert.equal(scored.economic_evidence.components.liquidity.points,15);
  assert.equal(scored.economic_evidence.components.spread_exit_friction.points,10);
});

test('hard pairing skew blocks economics without calling DMarket', async () => {
  let calls=0;
  const evidence=await observeDmarketEconomics(item(),{
    client:{targetsByTitle:async()=>{calls++;},feeSchedule:async()=>{},lastSales:async()=>{}},
    now:()=>Date.parse('2026-10-08T00:03:01Z')
  });
  assert.equal(evidence.status,'BLOCKED');
  assert.equal(evidence.blocker,'ECONOMIC_PAIRING_SKEW_EXCEEDED');
  assert.equal(calls,0);
});

test('missing credentials stays safe and economic score remains N-D', async () => {
  const snapshot={items:[item()]};
  await enrichDmarketEconomics(snapshot,{env:{},now:()=>Date.parse('2026-10-08T00:00:05Z')});
  assert.equal(snapshot.items[0].economic_action_score,null);
  assert.equal(snapshot.items[0].action_tier,'BLOCKED');
  assert.equal(snapshot.items[0].economic_evidence.blocker,'DMARKET_ECONOMICS_CREDENTIALS_UNAVAILABLE');
});
