import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, RARITY_SCOPE, resolveCollection, resolveScope, comparatorPoolKey, PILOT_CAPABILITY } from '../backend/collection-registry.mjs';
import { planScans, pilotScanPlan } from '../backend/scan-plan.mjs';

test('canonical #39 tiers and every alias are immutable, unique and deterministic', () => {
  assert.deepEqual(COLLECTIONS.filter(x => x.collection_priority_tier === 'P0').map(x => x.id),
    ['mirage-2021','vertigo-2021','ancient','norse','st-marc','canals','cobblestone','chop-shop']);
  assert.deepEqual(COLLECTIONS.filter(x => x.collection_priority_tier === 'P1').map(x => x.id),
    ['overpass-legacy','assault','aztec','train-legacy','train-2021','nuke-legacy','cache','rising-sun']);
  assert.deepEqual(COLLECTIONS.filter(x => x.collection_priority_tier === 'P2').map(x => x.id),
    ['gods-and-monsters','control','havoc','dust2-2021']);
  for (const record of COLLECTIONS) {
    for (const alias of record.aliases) {
      assert.equal(resolveCollection(alias), record);
      assert.equal(resolveCollection(`  ${alias.toUpperCase().replaceAll(' ', '  ')}  `), record);
    }
    assert.deepEqual(record.rarity_scope, ['Consumer Grade', 'Industrial Grade']);
    assert.throws(() => { record.collection_priority_tier = 'P0'; }, TypeError);
    assert.throws(() => record.aliases.push('Mirage'), TypeError);
  }
});

test('generation aliases never collapse and ambiguous/unknown generations fail closed', () => {
  assert.equal(resolveCollection('Train').id, 'train-legacy');
  assert.equal(resolveCollection('Train 2021').id, 'train-2021');
  assert.equal(resolveCollection('Nuke').id, 'nuke-legacy');
  assert.equal(resolveCollection('Mirage 2021').name, 'The 2021 Mirage Collection');
  assert.equal(resolveCollection('Vertigo 2021').name, 'The 2021 Vertigo Collection');
  for (const name of ['Mirage','Vertigo','The Mirage Collection','The Vertigo Collection',
    'The 2018 Nuke Collection','Nuke 2018','Train 2025','Overpass 2024','Dust 2', '', null, {}, '__proto__']) {
    assert.throws(() => resolveCollection(name), /UNKNOWN_COLLECTION/);
  }
});

test('rarity, capability and variant gates are explicit; pools separate every dimension', () => {
  const input = { collection:'Mirage 2021', rarity:RARITY_SCOPE[0], variant:'NORMAL' };
  const normal = resolveScope(input, PILOT_CAPABILITY);
  const souvenir = resolveScope({...input,variant:'SOUVENIR'}, PILOT_CAPABILITY);
  assert.notEqual(comparatorPoolKey(normal,'A'), comparatorPoolKey(souvenir,'A'));
  for (const rarity of ['Mil-Spec Grade','Restricted','Classified','Covert','consumer',null])
    assert.throws(() => resolveScope({...input,rarity}, PILOT_CAPABILITY), /RARITY_OUT_OF_SCOPE/);
  assert.throws(() => resolveScope({...input,rarity:RARITY_SCOPE[1]}, PILOT_CAPABILITY), /UNSUPPORTED_COLLECTOR_SCOPE/);
  assert.throws(() => resolveScope({...input,variant:'SOUVENIR',purpose:'trade-up'}, PILOT_CAPABILITY), /SOUVENIR_NOT_ELIGIBLE/);
  assert.throws(() => resolveScope({...input,variant:'SOUVENIR'}, {...PILOT_CAPABILITY,souvenir_signal_validated:false}), /SOUVENIR_NOT_ELIGIBLE/);
  assert.throws(() => resolveScope({...input,variant:'STATTRAK'}, {...PILOT_CAPABILITY,variants:['NORMAL','STATTRAK']}), /STATTRAK_NOT_SUPPORTED/);
  const stattrak = resolveScope({...input,variant:'STATTRAK'}, {...PILOT_CAPABILITY,variants:['STATTRAK'],stattrak_supported:true});
  assert.notEqual(comparatorPoolKey(normal,'A'), comparatorPoolKey(stattrak,'A'));
  const keys = ['Train','Train 2021'].flatMap(collection => RARITY_SCOPE.map(rarity => comparatorPoolKey(
    resolveScope({collection,rarity}, {...PILOT_CAPABILITY,collection,rarity}), 'A')));
  assert.equal(new Set(keys).size,4);
  assert.throws(() => resolveScope(input, null), /UNSUPPORTED_COLLECTOR_SCOPE/);
  assert.throws(() => resolveScope({...input,collection:'Norse'}, PILOT_CAPABILITY), /UNSUPPORTED_COLLECTOR_SCOPE/);
});

test('static budget uses 60/30/10, rounds deterministically and only uses supplied capabilities', () => {
  const capabilities = ['Mirage 2021','Nuke','Control'].map(collection => ({...PILOT_CAPABILITY,collection}));
  const plan = planScans({budget:100,capabilities});
  assert.deepEqual(plan.map(x => [x.collection_priority_tier,x.jobs]), [['P0',60],['P1',30],['P2',10]]);
  for (let budget=0; budget<=101; budget++) {
    const result = planScans({budget,capabilities});
    assert.equal(result.reduce((n,x) => n+x.jobs,0),budget);
    assert.deepEqual(result, planScans({budget,capabilities:[...capabilities].reverse()}));
  }
  assert.deepEqual(planScans({budget:10,capabilities:[]}),[]);
  assert.equal(pilotScanPlan().collection_id,'mirage-2021');
  assert.equal(pilotScanPlan().jobs,10);
  assert.throws(() => planScans({budget:10,capabilities:[PILOT_CAPABILITY,{...PILOT_CAPABILITY,collection:'Mirage 2021'}]}), /DUPLICATE_SCAN_SCOPE/);
  for (const budget of [-1, 0.5, NaN, '10', 10001]) assert.throws(() => planScans({budget}), /INVALID_SCAN_BUDGET/);
  const both = planScans({budget:2,capabilities:[{...PILOT_CAPABILITY,rarity:'Industrial Grade'},PILOT_CAPABILITY]});
  assert.deepEqual(both.map(x => x.rarity),RARITY_SCOPE);
});
