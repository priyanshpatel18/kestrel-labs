import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The indexer worker runs in the Node runtime via instrumentation.ts and
  // pulls in @coral-xyz/anchor / @solana/web3.js / @magicblock-labs/* which
  // bring along native deps (bigint-buffer, bufferutil, utf-8-validate, …).
  // Treat them as externals so Next bundling/turbopack doesn't try to inline
  // their CJS entry points.
  serverExternalPackages: [
    "@coral-xyz/anchor",
    "@solana/web3.js",
    "@magicblock-labs/ephemeral-rollups-sdk",
    "bigint-buffer",
    "bs58",
    "bn.js",
  ],
};

export default nextConfig;
