// #67: narrow URI grammar, never execute/decode arbitrary URI escapes.
// Modern payload: XOR byte + CEconItemPreviewDataBlock + four trailer bytes.
// Trailer semantics for native masked links are not authenticated by this parser.
const invalid = () => { throw new Error('CSDEALS_INSPECT'); };
export function validateCsDealsInspect(uri, { assetId, exactFloat, paintIndex, paintSeed } = {}) {
  if (typeof uri !== 'string' || uri.length > 500 || /[\s\x00-\x1f\x7f]/.test(uri)) invalid();
  const legacy = /^steam:\/\/rungame\/730\/76561202255233023\/\+csgo_econ_action_preview%20([SM])([1-9][0-9]{0,19})A([1-9][0-9]{0,19})D([1-9][0-9]{0,19})$/.exec(uri);
  if (legacy) {
    if (legacy[3] !== assetId || legacy.slice(2).some(n => BigInt(n) > 18446744073709551615n)) invalid();
    return 'LEGACY_ASSET_POINTER';
  }
  const match = /^steam:\/\/run\/730\/\/\+csgo_econ_action_preview%20((?:[0-9A-Fa-f]{2}){6,220})$/.exec(uri);
  if (!match) invalid();
  const bytes = Buffer.from(match[1], 'hex'), mask = bytes[0];
  // Accept only the native masked family observed live, not synthetic zero-mask links.
  if (mask === 0) invalid();
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= mask;
  const end = bytes.length - 4, values = new Map(); let offset = 1;
  const varint = () => {
    let v = 0n;
    for (let i = 0; i < 10; i++) {
      if (offset >= end) invalid();
      const b = bytes[offset++];
      if (i === 9 && b > 1) invalid();
      v |= BigInt(b & 127) << BigInt(i * 7);
      if (!(b & 128)) return v;
    }
    invalid();
  };
  while (offset < end) {
    const tag = varint(), field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (field < 1 || field > 23) invalid();
    if ([11, 12, 20, 22].includes(field)) {
      if (wire !== 2 || (field === 11 && values.has(field))) invalid();
      const size = Number(varint());
      if (!Number.isSafeInteger(size) || size > end - offset) invalid();
      offset += size; values.set(field, true);
    } else {
      if (wire !== 0 || values.has(field)) invalid();
      const value = varint();
      if (field !== 2 && value > 4294967295n) invalid();
      values.set(field, value);
    }
  }
  if (![2, 3, 4, 7, 8].every(k => values.has(k)) || values.get(2).toString() !== assetId ||
      values.get(3) === 0n || !Number.isInteger(paintIndex) || !Number.isInteger(paintSeed) ||
      values.get(4) !== BigInt(paintIndex) || values.get(8) !== BigInt(paintSeed)) invalid();
  const f = Buffer.alloc(4); f.writeUInt32LE(Number(values.get(7)));
  if (!Number.isFinite(exactFloat) || f.readFloatLE() !== exactFloat) invalid();
  return 'NATIVE_MASKED_ITEM_DATA';
}
