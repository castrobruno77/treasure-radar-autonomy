import { FileStore } from '../backend/store.mjs';
import { collectScan } from '../backend/radar.mjs';
const store = new FileStore(process.env.TSR_DATA_DIR || '.data');
let release;
try {
  release = await store.lock();
  const previous = await store.read();
  if (previous && Date.now() - Date.parse(previous.generated_at) < 60000) throw new Error('COLLECTION_COOLDOWN');
  const snapshot = await collectScan();
  await store.write(snapshot);
  console.log(JSON.stringify({ status: 'COMPLETE', generated_at: snapshot.generated_at,
    items: snapshot.items.length, certified: snapshot.items.filter(x => x.status === 'CERTIFIED').length }));
} catch (e) {
  console.error(JSON.stringify({ status: 'ERROR', error: e.code === 'EEXIST' ? 'COLLECTION_LOCKED' : e.message }));
  process.exitCode = 1;
} finally { if (release) await release(); }
