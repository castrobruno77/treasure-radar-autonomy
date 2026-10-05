const finite = (v, name) => {
  if (typeof v !== 'number' && !(typeof v === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v))) throw new Error(`INVALID_${name}`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`INVALID_${name}`);
  return n;
};
const requiredString = (v, name) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`INVALID_${name}`);
  return v;
};
const iso = (v, name) => {
  const s = requiredString(v, name);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s.replace(/(?<!\.\d{3})Z$/, '.000Z')) throw new Error(`INVALID_${name}`);
  return new Date(Date.parse(s)).toISOString();
};
const listingId = v => {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === 'string' && v.trim() && v === v.trim()) return v;
  throw new Error('INVALID_ID');
};
const itemRecord = item => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('INVALID_ITEM');
};
function unique(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.listing_id)) throw new Error('DUPLICATE_LISTING_ID');
    ids.add(row.listing_id);
  }
  return rows;
}
export function normalizeCsDeals(payload) {
  if (!payload || !Array.isArray(payload.items)) throw new Error('INVALID_ITEMS');
  return unique(payload.items.map(item => {
    itemRecord(item);
    const cents = finite(item.price, 'PRICE');
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('INVALID_PRICE');
    const f = finite(item.cs_paint_wear, 'FLOAT');
    if (f < 0 || f > 1) throw new Error('INVALID_FLOAT');
    return {
      source: 'CS.Deals',
      listing_id: listingId(item.id),
      market_hash_name: requiredString(item.market_hash_name, 'NAME'),
      price_usd: cents / 100,
      float: f,
      captured_at: iso(item.captured_at, 'CAPTURED_AT')
    };
  }));
}
export function normalizeWaxpeer(payload) {
  if (!payload || !Array.isArray(payload.items)) throw new Error('INVALID_ITEMS');
  const ts = finite(payload.timestamp, 'TIMESTAMP');
  if (!Number.isSafeInteger(ts) || ts <= 0 || ts > 253402300799) throw new Error('INVALID_TIMESTAMP');
  const captured_at = new Date(ts * 1000).toISOString();
  return unique(payload.items.map(item => {
    itemRecord(item);
    const mills = finite(item.price, 'PRICE');
    if (!Number.isSafeInteger(mills) || mills < 0) throw new Error('INVALID_PRICE');
    const f = finite(item.float, 'FLOAT');
    if (f < 0 || f > 1) throw new Error('INVALID_FLOAT');
    return {
      source: 'Waxpeer',
      listing_id: listingId(item.item_id),
      market_hash_name: requiredString(item.name, 'NAME'),
      price_usd: mills / 1000,
      float: f,
      captured_at
    };
  }));
}
