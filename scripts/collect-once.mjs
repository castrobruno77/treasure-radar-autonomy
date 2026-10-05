import { FileStore } from '../backend/store.mjs';
import { collectScan } from '../backend/radar.mjs';
import { ResilientRunStore, createSupabaseRunsStoreFromEnv } from '../backend/persistence.mjs';

const local = new FileStore(process.env.TSR_DATA_DIR || '.data');
const remote = createSupabaseRunsStoreFromEnv();
const store = new ResilientRunStore({ local, remote });
let release;
const startedAt = new Date().toISOString();
try {
  release = await store.lock();
  const previous = await store.read();
  if (previous && Date.now() - Date.parse(previous.generated_at) < 60000) throw new Error('COLLECTION_COOLDOWN');
  const snapshot = await collectScan();
  const finishedAt = new Date().toISOString();
  const persistence = await store.write(snapshot, { startedAt, finishedAt });
  console.log(JSON.stringify({ status: 'COMPLETE', generated_at: snapshot.generated_at,
    items: snapshot.items.length, certified: snapshot.items.filter(x => x.status === 'CERTIFIED').length,
    persistence: { local: persistence.local, remote: persistence.remote } }));
} catch (e) {
  console.error(JSON.stringify({ status: 'ERROR', error: e.code === 'EEXIST' ? 'COLLECTION_LOCKED' : e.message }));
  process.exitCode = 1;
} finally { if (release) await release(); }
