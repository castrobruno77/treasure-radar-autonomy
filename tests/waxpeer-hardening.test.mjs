import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogNames,floatJoin,runProbe,observedInteger} from '../scripts/check-waxpeer-hardening.mjs';
test('observed integer strings remain exact; missing, fractional and unsafe fields stay unknown',()=>{
  assert.equal(observedInteger('0014077'),14077);
  for(const v of [null,undefined,'',true,'1.5','-1','9007199254740992'])assert.equal(observedInteger(v),null);
});
test('diagnostic keeps exact names, allowed variants and float boundaries',()=>{
  const row={base_name:'Test | Finish',float_min:.07,float_max:.15,normal_allowed:true,souvenir_allowed:false};
  const names=catalogNames([row]);
  assert.equal(names.has('Test | Finish (Factory New)'),false);
  assert.equal(names.has('Souvenir Test | Finish (Minimal Wear)'),false);
  const identity=names.get('Test | Finish (Minimal Wear)');
  const ask={item_id:'1',market_hash_name:'Test | Finish (Minimal Wear)',raw_price:100,observed_at:'2026-10-10T00:00:00Z'};
  const actual={item_id:'1',name:ask.market_hash_name,price:100,float:.1};
  assert.equal(floatJoin(ask,actual,identity,'2026-10-10T00:03:00Z'),true);
  for(const change of [{item_id:'2'},{name:'Other'},{price:101},{float:.15},{float:'0.1'}])assert.equal(floatJoin(ask,{...actual,...change},identity,'2026-10-10T00:01:00Z'),false);
  assert.equal(floatJoin(ask,actual,identity,'2026-10-10T00:03:00.001Z'),false);
});
test('diagnostic stops on 429 without retries and never logs rejected source body or key',async()=>{
  const output=[], log=console.log;let requests=0;
  console.log=x=>output.push(x);
  try {
    const r=await runProbe({env:{WAXPEER_API_KEY:'TEST_SECRET_NOT_REAL'},pause:async()=>{},fetcher:async url=>{
      requests++;assert.equal(url.searchParams.has('api'),false);
      return new Response('TEST_SECRET_NOT_REAL',{status:429,headers:{'retry-after':'17'}});
    }});
    assert.equal(requests,1);assert.equal(r.status,'INCOMPLETE_FAIL_CLOSED');
    assert.equal(r.calls[0].retry_after_seconds,17);
    assert.equal(output.join('').includes('TEST_SECRET_NOT_REAL'),false);
  } finally {console.log=log;}
});
