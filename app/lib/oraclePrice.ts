/** Pyth-style quantized price in oracle account data (see realtime-price-tracker). */
export const ORACLE_PRICE_OFFSET = 73;
export const ORACLE_PRICE_BYTE_LEN = 8;
export const ORACLE_PRICE_SCALE = 100_000_000;

export function decodeOraclePriceFromAccountData(
  data: Uint8Array | Buffer,
): number | null {
  const end = ORACLE_PRICE_OFFSET + ORACLE_PRICE_BYTE_LEN;
  if (data.length < end) return null;
  const view = new DataView(
    data.buffer,
    data.byteOffset + ORACLE_PRICE_OFFSET,
    ORACLE_PRICE_BYTE_LEN,
  );
  const q = view.getBigInt64(0, true);
  return Number(q) / ORACLE_PRICE_SCALE;
}

/**
 * Extract `publish_time` (unix seconds) from a Pyth-style PriceUpdateV2
 * account data buffer. Mirrors the on-chain `PriceUpdateLite` layout used by
 * `programs/kestrel/src/state/oracle.rs`. Returns null if the buffer is
 * too small to contain the trailing fields.
 */
export function decodeOraclePublishTimeFromAccountData(
  data: Uint8Array | Buffer,
): number | null {
  // Layout (from the tail, in reverse):
  //   posted_slot       u64 : tail-8  .. tail
  //   ema_conf          u64 : tail-16 .. tail-8
  //   ema_price         i64 : tail-24 .. tail-16
  //   prev_publish_time i64 : tail-32 .. tail-24
  //   publish_time      i64 : tail-40 .. tail-32
  const tail = data.length;
  if (tail < 40) return null;
  const view = new DataView(data.buffer, data.byteOffset + (tail - 40), 8);
  const t = view.getBigInt64(0, true);
  return Number(t);
}
