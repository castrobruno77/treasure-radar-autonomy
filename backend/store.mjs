import { mkdir, readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateOpportunityPayload } from '../extension/api.js';

export class FileStore {
  constructor(directory) { this.directory = directory; }
  async read() {
    try {
      const snapshot = JSON.parse(await readFile(join(this.directory, 'latest.json'), 'utf8'));
      validateOpportunityPayload(snapshot);
      if (!Number.isFinite(Date.parse(snapshot.generated_at))) throw new Error('INVALID_SNAPSHOT');
      return snapshot;
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async write(snapshot) {
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
      await rename(temporary, join(this.directory, 'latest.json'));
    } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
  async lock() {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, 'collection.lock');
    const file = await open(path, 'wx', 0o600);
    await file.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    return async () => { await file.close(); await unlink(path); };
  }
}
