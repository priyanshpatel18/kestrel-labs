import { Connection, PublicKey } from "@solana/web3.js";

import type { Logger } from "./logger";

const PRICE_UPDATE_V2_DISCRIM = Buffer.from([
  34, 241, 35, 99, 157, 126, 244, 205,
]);

export interface OracleSnapshot {
  publishTimeUnix: number;
  price: bigint;
  exponent: number;
  ageSecs: number;
}

/**
 * Lightweight parser for Pyth Solana Receiver `PriceUpdateV2` accounts. We
 * match the byte layout that the on-chain `state::oracle::PriceUpdateLite`
 * deserialises so our freshness gate matches what `read_oracle_price` does.
 *
 * Layout (after the 8-byte Anchor discriminator):
 *   write_authority   : Pubkey  (32 bytes)
 *   verification_level: enum    (1 byte variant + optional 1-byte u8)
 *   price_message:
 *     feed_id          : [u8; 32]
 *     price            : i64
 *     conf             : u64
 *     exponent         : i32
 *     publish_time     : i64
 *     prev_publish_time: i64
 *     ema_price        : i64
 *     ema_conf         : u64
 *   posted_slot       : u64
 *
 * The trailing 60 bytes after `feed_id` always have a fixed layout, so we
 * read price / exponent / publish_time backwards from the end of the buffer
 * to be robust against the optional Partial-vs-Full enum size.
 */
export function parsePriceUpdateAccount(data: Buffer): OracleSnapshot | null {
  if (data.length < 8 + 32 + 1 + 92) return null;
  const discrim = data.subarray(0, 8);
  if (!discrim.equals(PRICE_UPDATE_V2_DISCRIM)) return null;

  const tail = data.length;
  // From the tail, in reverse order:
  //   posted_slot       u64 : [tail - 8 ..  tail]
  //   ema_conf          u64 : [tail - 16 .. tail - 8]
  //   ema_price         i64 : [tail - 24 .. tail - 16]
  //   prev_publish_time i64 : [tail - 32 .. tail - 24]
  //   publish_time      i64 : [tail - 40 .. tail - 32]
  //   exponent          i32 : [tail - 44 .. tail - 40]
  //   conf              u64 : [tail - 52 .. tail - 44]
  //   price             i64 : [tail - 60 .. tail - 52]
  if (tail < 60) return null;
  const publishTime = data.readBigInt64LE(tail - 40);
  const exponent = data.readInt32LE(tail - 44);
  const price = data.readBigInt64LE(tail - 60);

  const nowS = Math.floor(Date.now() / 1000);
  const ageSecs = nowS - Number(publishTime);
  return {
    publishTimeUnix: Number(publishTime),
    price,
    exponent,
    ageSecs,
  };
}

export async function readOracleSnapshot(params: {
  connection: Connection;
  feed: PublicKey;
  log?: Logger;
}): Promise<OracleSnapshot | null> {
  try {
    const info = await params.connection.getAccountInfo(params.feed, "confirmed");
    if (!info) return null;
    const snap = parsePriceUpdateAccount(info.data);
    if (!snap) {
      params.log?.debug({ feed: params.feed.toBase58() }, "oracle: parse miss");
    }
    return snap;
  } catch (err: any) {
    params.log?.warn(
      { feed: params.feed.toBase58(), err: String(err?.message || err) },
      "oracle: read failed",
    );
    return null;
  }
}

export function priceAsFloat(snap: OracleSnapshot): number {
  return Number(snap.price) * Math.pow(10, snap.exponent);
}
