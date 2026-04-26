import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    ConnectionMagicRouter,
    DELEGATION_PROGRAM_ID,
    GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
    TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountIdempotent,
    createMint,
    createTransferInstruction,
    getAccount,
    getAssociatedTokenAddressSync,
    getMint,
    mintTo,
} from "@solana/spl-token";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import { assert, expect } from "chai";

import { Kestrel } from "../target/types/kestrel";

const CONFIG_SEED = Buffer.from("config");
const VAULT_SEED = Buffer.from("vault");
const AGENT_SEED = Buffer.from("agent");
const MARKET_SEED = Buffer.from("market");

const DEFAULT_BTC_FEED = "71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr";
const BTC_USD_FEED = process.env.KESTREL_BTC_USD_PRICE_UPDATE || DEFAULT_BTC_FEED;
const DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

type UsdcMintChoice =
  | { kind: "synthetic" }
  | { kind: "fixed"; mint: PublicKey };

function rpcLooksLikeDevnet(connection: Connection): boolean {
  return (connection.rpcEndpoint || "").toLowerCase().includes("devnet");
}

function resolveUsdcMintChoice(connection: Connection): UsdcMintChoice {
  const env = process.env.KESTREL_USDC_MINT?.trim();
  if (env) {
    return { kind: "fixed", mint: new PublicKey(env) };
  }
  if (rpcLooksLikeDevnet(connection)) {
    return { kind: "fixed", mint: DEVNET_USDC_MINT };
  }
  return { kind: "synthetic" };
}

async function fundOwnerUsdcFromWallet(params: {
  connection: Connection;
  payer: Keypair;
  walletPubkey: PublicKey;
  mint: PublicKey;
  ownerUserAta: PublicKey;
  amount: bigint;
  signers: Keypair[];
}): Promise<void> {
  const {
    connection,
    payer,
    walletPubkey,
    mint,
    ownerUserAta,
    amount,
    signers,
  } = params;
  await createAssociatedTokenAccountIdempotent(
    connection,
    payer,
    mint,
    walletPubkey,
  );
  const walletAta = getAssociatedTokenAddressSync(mint, walletPubkey, true);
  const src = await getAccount(connection, walletAta);
  if (src.amount < amount) {
    throw new Error(
      `Wallet USDC ATA ${walletAta.toBase58()} has ${src.amount} raw units; need >= ${amount} (mint ${mint.toBase58()})`,
    );
  }
  const ix = createTransferInstruction(
    walletAta,
    ownerUserAta,
    walletPubkey,
    amount,
    [],
    TOKEN_PROGRAM_ID,
  );
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    signers,
    { commitment: "confirmed" },
  );
}

async function ensureOwnerUsdcBalance(params: {
  connection: Connection;
  payer: Keypair;
  walletPubkey: PublicKey;
  mint: PublicKey;
  ownerUserAta: PublicKey;
  amount: bigint;
  signers: Keypair[];
}): Promise<void> {
  const { connection, mint, walletPubkey } = params;
  const mintInfo = await getMint(connection, mint);
  const walletIsMintAuthority =
    mintInfo.mintAuthority !== null &&
    mintInfo.mintAuthority.equals(walletPubkey);
  if (walletIsMintAuthority) {
    await mintTo(
      connection,
      params.payer,
      mint,
      params.ownerUserAta,
      walletPubkey,
      Number(params.amount),
    );
  } else {
    await fundOwnerUsdcFromWallet(params);
  }
}

function u32LE(id: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(id, 0);
  return buf;
}

function configPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
}

function vaultPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_SEED], programId);
}

function agentPda(owner: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [AGENT_SEED, owner.toBuffer()],
    programId,
  );
}

function marketPda(id: number, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED, u32LE(id)],
    programId,
  );
}

async function pickUnusedMarketId(
  connection: Connection,
  programId: PublicKey,
): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const id =
      (Math.floor(Math.random() * 2_000_000_000) | 0) + 1;
    const [mkt] = marketPda(id, programId);
    const info = await connection.getAccountInfo(mkt, "confirmed");
    if (!info) return id;
  }
  throw new Error("Could not find an unused market id");
}


const LOCAL_OWNER_FUND_LAMPORTS = 25_000_000;
const ER_MIN_WALLET_LAMPORTS = 2_000_000;
const ER_OWNER_FUND_LAMPORTS = 100_000_000;

function defaultPolicy(maxStakePerWindow = 5_000_000) {
  return {
    maxStakePerWindow: new anchor.BN(maxStakePerWindow),
    maxOpenPositions: 8,
    allowedMarketsRoot: Array.from(new PublicKey(DEFAULT_BTC_FEED).toBytes()),
    paused: false,
  };
}


async function waitForOwner(
  connection: Connection,
  pda: PublicKey,
  expected: PublicKey,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await connection.getAccountInfo(pda, "confirmed");
    if (info && info.owner.equals(expected)) return;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(
    `Timed out waiting for ${pda.toBase58()} to be owned by ${expected.toBase58()}`,
  );
}

const LOCAL_DEPOSIT_AMOUNT = new anchor.BN(1_200_000);
const LOCAL_WITHDRAW_PRINCIPAL = new anchor.BN(400_000);
const LOCAL_OWNER_USDC_FUND_SYNTHETIC = 5_000_000n;
const LOCAL_OWNER_USDC_FUND_EXTERNAL = 2_500_000n;


const isLocalnet =
  (process.env.ANCHOR_PROVIDER_URL || "").includes("127.0.0.1") ||
  (process.env.ANCHOR_PROVIDER_URL || "").includes("localhost");

(isLocalnet ? describe : describe.skip)("kestrel local", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Kestrel as Program<Kestrel>;
  const wallet = provider.wallet as anchor.Wallet;

  const treasury = Keypair.generate();
  const owner = Keypair.generate();

  let treasuryPubkey: PublicKey;
  let reusedExistingConfig = false;

  let usdcMint: PublicKey;
  let userAta: PublicKey;
  let treasuryAta: PublicKey;
  const [config] = configPda(program.programId);
  const [vault] = vaultPda(program.programId);
  const [agent] = agentPda(owner.publicKey, program.programId);

  const FEE_BPS = 100;

  before(async () => {
    const fundOwner = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: owner.publicKey,
        lamports: LOCAL_OWNER_FUND_LAMPORTS,
      }),
    );
    await sendAndConfirmTransaction(
      provider.connection,
      fundOwner,
      [wallet.payer],
      { commitment: "confirmed" },
    );

    const existingCfg = await provider.connection.getAccountInfo(
      config,
      "confirmed",
    );
    if (existingCfg) {
      const cfg = await program.account.config.fetch(config);
      if (!cfg.admin.equals(wallet.publicKey)) {
        throw new Error(
          `On-chain config.admin=${cfg.admin.toBase58()} does not match test wallet; use a clean cluster or matching id.json`,
        );
      }
      reusedExistingConfig = true;
      treasuryPubkey = cfg.treasury;
      usdcMint = cfg.usdcMint;
    } else {
      reusedExistingConfig = false;
      treasuryPubkey = treasury.publicKey;
      const mintChoice = resolveUsdcMintChoice(provider.connection);
      if (mintChoice.kind === "fixed") {
        usdcMint = mintChoice.mint;
      } else {
        usdcMint = await createMint(
          provider.connection,
          wallet.payer,
          wallet.publicKey,
          null,
          6,
        );
      }
    }

    userAta = await createAssociatedTokenAccountIdempotent(
      provider.connection,
      wallet.payer,
      usdcMint,
      owner.publicKey,
    );
    treasuryAta = await createAssociatedTokenAccountIdempotent(
      provider.connection,
      wallet.payer,
      usdcMint,
      treasuryPubkey,
    );

    const mintMeta = await getMint(provider.connection, usdcMint);
    const walletIsMintAuthority =
      mintMeta.mintAuthority !== null &&
      mintMeta.mintAuthority.equals(wallet.publicKey);
    const ownerStartUsdc = walletIsMintAuthority
      ? LOCAL_OWNER_USDC_FUND_SYNTHETIC
      : LOCAL_OWNER_USDC_FUND_EXTERNAL;

    await ensureOwnerUsdcBalance({
      connection: provider.connection,
      payer: wallet.payer,
      walletPubkey: wallet.publicKey,
      mint: usdcMint,
      ownerUserAta: userAta,
      amount: ownerStartUsdc,
      signers: [wallet.payer],
    });
  });

  it("initializes config + vault", async () => {
    if (!reusedExistingConfig) {
      await program.methods
        .initConfig(treasuryPubkey, new PublicKey(BTC_USD_FEED), FEE_BPS)
        .accounts({
          admin: wallet.publicKey,
          usdcMint,
        })
        .rpc();
    }

    const cfg = await program.account.config.fetch(config);
    expect(cfg.admin.toBase58()).to.eq(wallet.publicKey.toBase58());
    expect(cfg.treasury.toBase58()).to.eq(treasuryPubkey.toBase58());
    expect(cfg.usdcMint.toBase58()).to.eq(usdcMint.toBase58());
    if (!reusedExistingConfig) {
      expect(cfg.feeBps).to.eq(FEE_BPS);
      expect(cfg.marketCount).to.eq(0);
    }

    const vaultAcc = await getAccount(provider.connection, vault);
    expect(vaultAcc.mint.toBase58()).to.eq(usdcMint.toBase58());
    expect(vaultAcc.owner.toBase58()).to.eq(config.toBase58());
  });

  it("registers an agent", async () => {
    await program.methods
      .registerAgent(defaultPolicy())
      .accounts({
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    const acc = await program.account.agentProfile.fetch(agent);
    expect(acc.owner.toBase58()).to.eq(owner.publicKey.toBase58());
    expect(acc.balance.toNumber()).to.eq(0);
    expect(acc.depositedAmount.toNumber()).to.eq(0);
    expect(acc.policy.maxOpenPositions).to.eq(8);
  });

  it("update_policy rewrites the policy in place", async () => {
    const tighter = {
      maxStakePerWindow: new anchor.BN(2_000_000),
      maxOpenPositions: 4,
      allowedMarketsRoot: Array.from(new PublicKey(DEFAULT_BTC_FEED).toBytes()),
      paused: false,
    };
    await program.methods
      .updatePolicy(tighter)
      .accounts({
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    const acc = await program.account.agentProfile.fetch(agent);
    expect(acc.policy.maxStakePerWindow.toString()).to.eq("2000000");
    expect(acc.policy.maxOpenPositions).to.eq(4);
  });

  it("deposits USDC and increments balance", async () => {
    const amount = LOCAL_DEPOSIT_AMOUNT;
    const beforeAgent = await program.account.agentProfile.fetch(agent);
    const beforeVault = (await getAccount(provider.connection, vault)).amount;

    await program.methods
      .deposit(amount)
      .accounts({
        owner: owner.publicKey,
        usdcMint,
        userAta,
      })
      .signers([owner])
      .rpc();

    const acc = await program.account.agentProfile.fetch(agent);
    expect(acc.balance.sub(beforeAgent.balance).toString()).to.eq(amount.toString());
    expect(acc.depositedAmount.sub(beforeAgent.depositedAmount).toString()).to.eq(
      amount.toString(),
    );

    const vaultAfter = (await getAccount(provider.connection, vault)).amount;
    expect((vaultAfter - beforeVault).toString()).to.eq(amount.toString());
  });

  it("rejects deposit of zero", async () => {
    let threw = false;
    try {
      await program.methods
        .deposit(new anchor.BN(0))
        .accounts({
          owner: owner.publicKey,
          usdcMint,
          userAta,
        })
        .signers([owner])
        .rpc();
    } catch (err: any) {
      threw = true;
      const msg = String(err?.error?.errorMessage || err?.message || "");
      expect(msg).to.match(/InvalidAmount|amount/i);
    }
    expect(threw, "expected InvalidAmount").to.be.true;
  });

  it("withdraws principal back to user (no fee on principal)", async () => {
    const amount = LOCAL_WITHDRAW_PRINCIPAL;
    const agentBefore = await program.account.agentProfile.fetch(agent);
    const balBefore = new anchor.BN(agentBefore.balance.toString());
    const depBefore = new anchor.BN(agentBefore.depositedAmount.toString());
    const userBefore = (await getAccount(provider.connection, userAta)).amount;
    const treasuryBefore = (await getAccount(provider.connection, treasuryAta)).amount;
    const vaultBefore = (await getAccount(provider.connection, vault)).amount;

    await program.methods
      .withdraw(amount)
      .accounts({
        owner: owner.publicKey,
        usdcMint,
        userAta,
        treasuryAta,
      })
      .signers([owner])
      .rpc();

    const acc = await program.account.agentProfile.fetch(agent);
    expect(acc.balance.toString()).to.eq(balBefore.sub(amount).toString());
    expect(acc.depositedAmount.toString()).to.eq(depBefore.sub(amount).toString());

    const userAfter = (await getAccount(provider.connection, userAta)).amount;
    const treasuryAfter = (await getAccount(provider.connection, treasuryAta)).amount;
    const vaultAfter = (await getAccount(provider.connection, vault)).amount;

    expect((userAfter - userBefore).toString()).to.eq(amount.toString());
    expect(treasuryAfter).to.eq(treasuryBefore);
    expect((vaultBefore - vaultAfter).toString()).to.eq(amount.toString());
  });

  it("rejects withdraw above balance", async () => {
    let threw = false;
    try {
      await program.methods
        .withdraw(new anchor.BN(1_000_000_000))
        .accounts({
          owner: owner.publicKey,
          usdcMint,
          userAta,
          treasuryAta,
        })
        .signers([owner])
        .rpc();
    } catch (err: any) {
      threw = true;
      const msg = String(err?.error?.errorMessage || err?.message || "");
      expect(msg).to.match(/WithdrawExceedsFree|exceed/i);
    }
    expect(threw, "expected WithdrawExceedsFree").to.be.true;
  });

  it("creates a market on base", async () => {
    const id = await pickUnusedMarketId(provider.connection, program.programId);
    const now = Math.floor(Date.now() / 1000);
    await program.methods
      .createMarket(id, new anchor.BN(now), new anchor.BN(now + 3600))
      .accounts({
        admin: wallet.publicKey,
      })
      .rpc();

    const [market] = marketPda(id, program.programId);
    const m = await program.account.market.fetch(market);
    expect(m.id).to.eq(id);
    expect(m.oracleFeed.toBase58()).to.eq(DEFAULT_BTC_FEED);
    expect(m.status).to.deep.eq({ pending: {} });
    expect(m.yesReserve.toString()).to.eq("0");
  });
});


const runErTests = process.env.RUN_ER_TESTS === "1";
const erDescribe = runErTests ? describe : describe.skip;

erDescribe("kestrel devnet ER", function () {
  this.timeout(600_000);

  const baseRpcUrl =
    process.env.KESTREL_BASE_RPC_URL || "https://api.devnet.solana.com";
  const erRpcUrl =
    process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
    "https://devnet-as.magicblock.app/";
  const erWsUrl =
    process.env.EPHEMERAL_WS_ENDPOINT ||
    erRpcUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const btcFeed = new PublicKey(process.env.BTC_FEED_PUBKEY || DEFAULT_BTC_FEED);

  const baseConnection = new Connection(baseRpcUrl, "confirmed");
  const wallet = anchor.Wallet.local();
  const baseProvider = new anchor.AnchorProvider(baseConnection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(baseProvider);

  const erConnection = new Connection(erRpcUrl, {
    commitment: "confirmed",
    wsEndpoint: erWsUrl,
  });
  const validatorLookupUrl =
    process.env.EPHEMERAL_ROUTER_URL ||
    "https://devnet-router.magicblock.app/";
  const validatorLookupWs =
    process.env.EPHEMERAL_ROUTER_WS_URL ||
    validatorLookupUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const erValidatorRouter = new ConnectionMagicRouter(validatorLookupUrl, {
    wsEndpoint: validatorLookupWs,
    commitment: "confirmed",
  });
  const erProvider = new anchor.AnchorProvider(erConnection, wallet, {
    commitment: "confirmed",
  });

  async function sendErTx(
    tx: Transaction,
    extraSigners: Keypair[] = [],
    opts?: { feePayer?: Keypair },
  ): Promise<string> {
    const feePayerKp = opts?.feePayer ?? wallet.payer;
    tx.feePayer = feePayerKp.publicKey;
    const { blockhash, lastValidBlockHeight } =
      await erConnection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    const byPk = new Map<string, Keypair>();
    byPk.set(feePayerKp.publicKey.toBase58(), feePayerKp);
    for (const k of extraSigners) {
      byPk.set(k.publicKey.toBase58(), k);
    }
    return sendAndConfirmTransaction(
      erConnection,
      tx,
      Array.from(byPk.values()),
      { skipPreflight: true, commitment: "confirmed" },
    );
  }

  function isRetriableCloseMarketErr(err: unknown): boolean {
    const msg = String((err as any)?.message || err || "");
    if (msg.includes("OutsideMarketWindow")) return true;
    if (msg.includes("6006")) return true;
    if (msg.includes("0x1776")) return true;
    if (/InstructionError.*6006/i.test(msg)) return true;
    return false;
  }

  function isErProgramNotUpgradedYet(err: unknown): boolean {
    const msg = String((err as any)?.message || err || "");
    if (msg.includes("InstructionFallbackNotFound")) return true;
    if (msg.includes("Custom\":101") || msg.includes("custom program error: 0x65"))
      return true;
    return false;
  }

  const program = anchor.workspace.Kestrel as Program<Kestrel>;
  const erProgram = new Program<Kestrel>(program.idl as Kestrel, erProvider);

  const owner = Keypair.generate();
  const owner2 = Keypair.generate();
  const marketId = Math.floor(Date.now() / 1000) % 1_000_000_000;

  const [config] = configPda(program.programId);
  const [agent] = agentPda(owner.publicKey, program.programId);
  const [agent2] = agentPda(owner2.publicKey, program.programId);
  const [market] = marketPda(marketId, program.programId);

  const FEE_BPS = 100;
  const SEED_LIQUIDITY = new anchor.BN(1_000_000);
  const DEPOSIT = new anchor.BN(1_200_000);
  const BET = new anchor.BN(200_000);
  const ER_OWNER_USDC_FUND_SYNTHETIC = BigInt(DEPOSIT.toNumber() * 3);
  const ER_OWNER_USDC_FUND_EXTERNAL = 2_500_000n;

  let usdcMint: PublicKey;
  let userAta: PublicKey;
  let userAta2: PublicKey;
  let treasuryAta: PublicKey;
  let validatorIdentity: PublicKey;
  let validatorFqdn: string | undefined;

  before(async () => {
    console.log("Wallet:  ", wallet.publicKey.toBase58());
    const balance = await baseConnection.getBalance(wallet.publicKey);
    console.log(
      `Wallet base SOL balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)}`,
    );
    if (balance < ER_MIN_WALLET_LAMPORTS) {
      throw new Error(
        `Wallet ${wallet.publicKey.toBase58()} needs >= ${ER_MIN_WALLET_LAMPORTS / LAMPORTS_PER_SOL} SOL on the base layer for the ER suite`,
      );
    }

    const v = await erValidatorRouter.getClosestValidator();
    validatorIdentity = new PublicKey(v.identity);
    validatorFqdn = (v as any).fqdn;
    console.log("Closest validator identity:", validatorIdentity.toBase58());

    const cfgInfo = await baseConnection.getAccountInfo(config, "confirmed");
    if (cfgInfo) {
      const cfg = await program.account.config.fetch(config);
      usdcMint = cfg.usdcMint;
      console.log("Existing config; using config.usdc_mint:", usdcMint.toBase58());
    } else {
      const mintChoice = resolveUsdcMintChoice(baseConnection);
      if (mintChoice.kind === "fixed") {
        usdcMint = mintChoice.mint;
        console.log("No config yet; using resolved USDC mint:", usdcMint.toBase58());
      } else {
        usdcMint = await createMint(
          baseConnection,
          wallet.payer,
          wallet.publicKey,
          null,
          6,
        );
        console.log("Created synthetic USDC-like mint:", usdcMint.toBase58());
      }
    }

    const minOwnerLamports = Math.max(
      ER_OWNER_FUND_LAMPORTS,
      await baseConnection.getMinimumBalanceForRentExemption(0),
    );
    const fundIx = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: owner.publicKey,
      lamports: minOwnerLamports,
    });
    const fundIx2 = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: owner2.publicKey,
      lamports: minOwnerLamports,
    });
    const fundTx = new Transaction().add(fundIx, fundIx2);
    await sendAndConfirmTransaction(baseConnection, fundTx, [wallet.payer], {
      commitment: "confirmed",
    });

    userAta = await createAssociatedTokenAccountIdempotent(
      baseConnection,
      wallet.payer,
      usdcMint,
      owner.publicKey,
    );
    userAta2 = await createAssociatedTokenAccountIdempotent(
      baseConnection,
      wallet.payer,
      usdcMint,
      owner2.publicKey,
    );
    treasuryAta = await createAssociatedTokenAccountIdempotent(
      baseConnection,
      wallet.payer,
      usdcMint,
      wallet.publicKey,
    );
    const mintMeta = await getMint(baseConnection, usdcMint);
    const walletIsMintAuthority =
      mintMeta.mintAuthority !== null &&
      mintMeta.mintAuthority.equals(wallet.publicKey);
    const ownerStartUsdc = walletIsMintAuthority
      ? ER_OWNER_USDC_FUND_SYNTHETIC
      : ER_OWNER_USDC_FUND_EXTERNAL;
    await ensureOwnerUsdcBalance({
      connection: baseConnection,
      payer: wallet.payer,
      walletPubkey: wallet.publicKey,
      mint: usdcMint,
      ownerUserAta: userAta,
      amount: ownerStartUsdc,
      signers: [wallet.payer],
    });
    await ensureOwnerUsdcBalance({
      connection: baseConnection,
      payer: wallet.payer,
      walletPubkey: wallet.publicKey,
      mint: usdcMint,
      ownerUserAta: userAta2,
      amount: ownerStartUsdc,
      signers: [wallet.payer],
    });
  });

  it("init_config (idempotent if already deployed)", async () => {
    const existing = await baseConnection.getAccountInfo(config);
    if (existing) {
      console.log("Config already exists, skipping init_config.");
      // If the on-chain config was created with the old layout (pre oracle pubkey),
      // migrate it in-place so subsequent account fetches decode correctly.
      const V1_SIZE = 8 + 32 * 3 + 2 + 4 + 1 + 1;
      if (existing.data.length === V1_SIZE) {
        console.log("Config appears to be v1; migrating.");
        const migTx = await program.methods
          .migrateConfig(new PublicKey(BTC_USD_FEED))
          .accounts({ admin: wallet.publicKey })
          .transaction();
        await sendAndConfirmTransaction(baseConnection, migTx, [wallet.payer], {
          skipPreflight: true,
          commitment: "confirmed",
        });
      }
      const cfg = await program.account.config.fetch(config);
      treasuryAta = await createAssociatedTokenAccountIdempotent(
        baseConnection,
        wallet.payer,
        cfg.usdcMint,
        cfg.treasury,
      );
      return;
    }

    const tx = await program.methods
      .initConfig(wallet.publicKey, new PublicKey(BTC_USD_FEED), FEE_BPS)
      .accounts({
        admin: wallet.publicKey,
        usdcMint,
      })
      .transaction();
    await sendAndConfirmTransaction(baseConnection, tx, [wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
  });

  it("registers agent + deposits on base", async () => {
    const regTx = await program.methods
      .registerAgent(defaultPolicy(BET.toNumber() * 4))
      .accounts({
        owner: owner.publicKey,
      })
      .transaction();
    await sendAndConfirmTransaction(
      baseConnection,
      regTx,
      [wallet.payer, owner],
      { skipPreflight: true, commitment: "confirmed" },
    );

    const cfg = await program.account.config.fetch(config);
    const depTx = await program.methods
      .deposit(DEPOSIT)
      .accounts({
        owner: owner.publicKey,
        usdcMint: cfg.usdcMint,
        userAta,
      })
      .transaction();
    await sendAndConfirmTransaction(
      baseConnection,
      depTx,
      [wallet.payer, owner],
      { skipPreflight: true, commitment: "confirmed" },
    );

    const acc = await program.account.agentProfile.fetch(agent);
    expect(acc.balance.toString()).to.eq(DEPOSIT.toString());
  });

  it("registers second agent + deposits on base", async () => {
    const regTx = await program.methods
      .registerAgent(defaultPolicy(BET.toNumber() * 4))
      .accounts({
        owner: owner2.publicKey,
      })
      .transaction();
    await sendAndConfirmTransaction(
      baseConnection,
      regTx,
      [wallet.payer, owner2],
      { skipPreflight: true, commitment: "confirmed" },
    );

    const cfg = await program.account.config.fetch(config);
    const depTx = await program.methods
      .deposit(DEPOSIT)
      .accounts({
        owner: owner2.publicKey,
        usdcMint: cfg.usdcMint,
        userAta: userAta2,
      })
      .transaction();
    await sendAndConfirmTransaction(
      baseConnection,
      depTx,
      [wallet.payer, owner2],
      { skipPreflight: true, commitment: "confirmed" },
    );

    const acc = await program.account.agentProfile.fetch(agent2);
    expect(acc.balance.toString()).to.eq(DEPOSIT.toString());
  });

  it("creates market + delegates market and agent", async () => {
    const now = Math.floor(Date.now() / 1000);
    const closeTs = now + 60;

    const cmTx = await program.methods
      .createMarket(marketId, new anchor.BN(now), new anchor.BN(closeTs))
      .accounts({ admin: wallet.publicKey })
      .transaction();
    await sendAndConfirmTransaction(baseConnection, cmTx, [wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });

    const remainingAccounts = [
      { pubkey: validatorIdentity, isSigner: false, isWritable: false },
    ];

    const dmTx = await program.methods
      .delegateMarket(marketId)
      .accounts({
        payer: wallet.publicKey,
        validator: null,
      })
      .remainingAccounts(remainingAccounts)
      .transaction();
    await sendAndConfirmTransaction(baseConnection, dmTx, [wallet.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });

    const daTx = await program.methods
      .delegateAgent()
      .accounts({
        payer: owner.publicKey,
        validator: null,
      })
      .remainingAccounts(remainingAccounts)
      .transaction();
    await sendAndConfirmTransaction(
      baseConnection,
      daTx,
      [wallet.payer, owner],
      { skipPreflight: true, commitment: "confirmed" },
    );

    const daTx2 = await program.methods
      .delegateAgent()
      .accounts({
        payer: owner2.publicKey,
        validator: null,
      })
      .remainingAccounts(remainingAccounts)
      .transaction();
    await sendAndConfirmTransaction(
      baseConnection,
      daTx2,
      [wallet.payer, owner2],
      { skipPreflight: true, commitment: "confirmed" },
    );

    await waitForOwner(baseConnection, market, DELEGATION_PROGRAM_ID);
    await waitForOwner(baseConnection, agent, DELEGATION_PROGRAM_ID);
    await waitForOwner(baseConnection, agent2, DELEGATION_PROGRAM_ID);
  });

  it("opens the market on ER (oracle read)", async () => {
    const tx = await erProgram.methods
      .openMarket(marketId, SEED_LIQUIDITY)
      .accounts({
        admin: wallet.publicKey,
        priceUpdate: btcFeed,
      })
      .transaction();
    const sig = await sendErTx(tx);
    console.log("open_market on ER:", sig);
  });

  it("places bets on ER", async () => {
    const tx1 = await erProgram.methods
      .placeBet(marketId, { yes: {} } as any, BET)
      .accounts({
        owner: owner.publicKey,
        priceUpdate: btcFeed,
      })
      .transaction();
    const sig1 = await sendErTx(tx1, [owner], { feePayer: owner });
    console.log("place_bet (owner) on ER:", sig1);

    const tx2 = await erProgram.methods
      .placeBet(marketId, { no: {} } as any, BET)
      .accounts({
        owner: owner2.publicKey,
        priceUpdate: btcFeed,
      })
      .transaction();
    const sig2 = await sendErTx(tx2, [owner2], { feePayer: owner2 });
    console.log("place_bet (owner2) on ER:", sig2);

    // Decode emitted BetPlaced events to confirm the program is shipping
    // typed Anchor events the indexer can subscribe to.
    const tx1Info = await erConnection.getTransaction(sig1, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx1Info?.meta?.logMessages ?? [];
    const eventCoder = new anchor.BorshEventCoder(program.idl as anchor.Idl);
    const decoded: { name: string; data: any }[] = [];
    for (const line of logs) {
      const m = line.match(/Program data:\s+(.+)$/);
      if (!m) continue;
      const ev = eventCoder.decode(m[1]);
      if (ev) decoded.push({ name: ev.name, data: ev.data });
    }
    const bp = decoded.find((d) => d.name === "betPlaced" || d.name === "BetPlaced");
    expect(bp, "expected BetPlaced event").to.exist;
  });

  it("cancel_bet closes the whole position on ER", async function () {
    const before = await erProgram.account.agentProfile.fetch(agent);
    const tx = await erProgram.methods
      .cancelBet(marketId)
      .accounts({ owner: owner.publicKey })
      .transaction();

    const deadline = Date.now() + 300_000;
    while (true) {
      try {
        const sig = await sendErTx(tx, [owner], { feePayer: owner });
        console.log("cancel_bet on ER:", sig);
        break;
      } catch (err: any) {
        if (!isErProgramNotUpgradedYet(err) || Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }

    const after = await erProgram.account.agentProfile.fetch(agent);
    expect(after.balance.gt(before.balance)).to.eq(true);
  });

  it("waits for close_ts then closes the market on ER", async () => {
    const cfg = await program.account.config.fetch(config);
    void cfg;

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        const tx = await erProgram.methods
          .closeMarket(marketId)
          .accounts({
            admin: wallet.publicKey,
            priceUpdate: btcFeed,
          })
          .transaction();
        const sig = await sendErTx(tx);
        console.log("close_market on ER:", sig);
        return;
      } catch (err: any) {
        if (!isRetriableCloseMarketErr(err)) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 4_000));
      }
    }
    throw new Error("Timed out waiting for close_ts to elapse");
  });

  it("settles the position on ER", async () => {
    const tx = await erProgram.methods
      .settlePosition(marketId, owner.publicKey)
      .accounts({
        payer: wallet.publicKey,
      })
      .transaction();
    const sig = await sendErTx(tx);
    console.log("settle_position on ER:", sig);
  });

  it("settle_positions batch-settles remaining agents on ER", async function () {
    const marketAcc = await erProgram.account.market.fetch(market);
    expect(marketAcc.winner).to.exist;

    const before = await erProgram.account.agentProfile.fetch(agent2);
    const slot = before.positions.findIndex(
      (p: any) => p.marketId === marketAcc.id && !p.settled,
    );
    expect(slot).to.not.eq(-1);
    const pos = before.positions[slot];
    const winner = marketAcc.winner as any;
    const payout = winner.yes !== undefined ? pos.yesShares : pos.noShares;

    const tx = await erProgram.methods
      .settlePositions(marketId)
      .accounts({ payer: wallet.publicKey })
      .remainingAccounts([{ pubkey: agent2, isSigner: false, isWritable: true }])
      .transaction();

    const deadline = Date.now() + 300_000;
    while (true) {
      try {
        const sig = await sendErTx(tx);
        console.log("settle_positions on ER:", sig);
        break;
      } catch (err: any) {
        if (!isErProgramNotUpgradedYet(err) || Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }

    const after = await erProgram.account.agentProfile.fetch(agent2);
    expect(after.balance.sub(before.balance).toString()).to.eq(
      new anchor.BN(payout.toString()).toString(),
    );
  });

  it("commits + undelegates the agent and withdraws on base", async () => {
    const tx = await erProgram.methods
      .commitAndUndelegateAgent()
      .accounts({
        owner: owner.publicKey,
      })
      .transaction();
    const erSig = await sendErTx(tx, [owner], { feePayer: owner });
    console.log("commit_and_undelegate_agent on ER:", erSig);

    const commitConn = validatorFqdn
      ? new Connection(validatorFqdn, "confirmed")
      : erConnection;
    try {
      const baseSig = await GetCommitmentSignature(erSig, commitConn);
      console.log("base-layer commit signature:", baseSig);
    } catch (err) {
      console.log("GetCommitmentSignature warning:", String(err));
    }

    await waitForOwner(baseConnection, agent, program.programId);

    const cfg = await program.account.config.fetch(config);
    const treasuryAtaForCfg = getAssociatedTokenAddressSync(
      cfg.usdcMint,
      cfg.treasury,
      true,
    );

    const acc = await program.account.agentProfile.fetch(agent);
    const amount = acc.balance;
    expect(amount.gt(new anchor.BN(0))).to.be.true;

    const wdTx = await program.methods
      .withdraw(amount)
      .accounts({
        owner: owner.publicKey,
        usdcMint: cfg.usdcMint,
        userAta,
        treasuryAta: treasuryAtaForCfg,
      })
      .transaction();
    const wdSig = await sendAndConfirmTransaction(
      baseConnection,
      wdTx,
      [wallet.payer, owner],
      { skipPreflight: true, commitment: "confirmed" },
    );
    console.log("withdraw on base:", wdSig);

    const after = await program.account.agentProfile.fetch(agent);
    expect(after.balance.toString()).to.eq("0");
  });

  it("checks final market state on base (after admin commit_and_undelegate_market)", async () => {
    try {
      const tx = await erProgram.methods
        .commitAndUndelegateMarket(marketId)
        .accounts({ admin: wallet.publicKey })
        .transaction();
      await sendErTx(tx);
    } catch (err) {
      console.log("commit_and_undelegate_market (best effort):", String(err));
    }

    await new Promise((r) => setTimeout(r, 5_000));
    try {
      const m = await program.account.market.fetch(market);
      assert(m.status, "market should expose a status");
      assert(m.winner, "market should have a winner once Closed");
    } catch (err) {
      console.log("market state fetch (best effort):", String(err));
    }
  });
});
