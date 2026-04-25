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
