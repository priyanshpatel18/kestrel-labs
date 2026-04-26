# Kestrel

Policy-governed trading agents on oracle-resolved short BTC markets: the trading path on MagicBlock Ephemeral Rollup, lifecycle and custody on Solana devnet.

## What it is

Kestrel is a **single Anchor program** plus **off-chain workers**: a **scheduler** maintains a rolling horizon of markets, **delegates** each market and each agent profile to an **Ephemeral Rollup (ER)** for fast `place_bet` / `cancel_bet` / `close_position` / settlement, and **three agent roles** (MarketOps, Trader, Risk-LP) sign transactions against the same on-chain rules as a human would. A **Next.js** app (and optional **Supabase-backed indexer**) exposes markets, agent traces, and stats for demos and judges.

## How it works

1. **Scheduler** creates markets on **base layer**, **delegates** them to ER, opens books on ER with seeded liquidity, and drives **close** after the window; MarketOps can **halt / resume** when the oracle is stale.
2. **Agents** register and **deposit USDC** on base, **delegate** their `AgentProfile` to ER, then trade on ER. **Policy** (max stake per window, max open positions, allowlisted oracle feed, paused flag) is enforced **on-chain** on every bet.
3. **Oracle** price account is read for freshness at bet time and for **resolution** at market close; the program sets outcome and **closed** status, then agents (or tooling) can **settle** positions; slots free up for later windows.
4. **Withdraw** runs on **base** after commit/undelegate; protocol **fee_bps** applies on the profit leg as configured in `Config`.

## User stories

- **Agent operator:** Register an agent, fund it with devnet USDC, set policy caps; watch it trade successive windows with each attempt either succeeding or failing with an explicit on-chain reason (trace in the app when the indexer is enabled).
- **Market admin (MarketOps key):** When the feed is stale, **halt** the market so new risk increases stop; **resume** when healthy; optional scripted halt cadence for demos via env (see `agents/.env.example`).
- **Reviewer / judge:** Open a market or agent timeline, see **transaction signatures**, open them on a Solana explorer (devnet), and correlate **policy blocks** (e.g. over cap, wrong allowlist) and **chain blocks** (e.g. halted, oracle stale).
- **Demo withdrawal:** After settle and undelegate, run a **withdraw** flow (script or API) and see gross, fee, and net in the timeline where wired.

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Solana base (devnet)                                     │
│  Config, USDC vault, create_market, delegate_*, deposit,  │
│  withdraw, agent / market account owners pre-delegation   │
└───────────────────────────┬───────────────────────────────┘
                            │ delegate + commit / undelegate
                            ▼
┌───────────────────────────────────────────────────────────┐
│  MagicBlock Ephemeral Rollup                              │
│  Market AMM state, AgentProfile balances & positions,     │
│  place_bet, cancel_bet, close_position, close_market,     │
│  settle_position(s), halt/resume, commit_and_undelegate_* │
└───────────────────────────┬───────────────────────────────┘
                            │ RPC + signed txs
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   scheduler/          agents/              app/
   (horizon,           market_ops,          Next.js UI,
    open/close)        trader, risk_lp      optional indexer → Supabase
```

**Repo layout**

| Path | Role |
|------|------|
| `programs/kestrel` | Anchor program (source of truth for accounts and instructions). |
| `scheduler` | Long-running lifecycle worker (horizon, delegate market, ER open/close). |
| `agents` | Role binaries: `market_ops`, `trader`, `risk_lp` (`pnpm dev:all`). |
| `app` | Next.js frontend, REST tx builders under `app/api/v1`, indexer hook when enabled. |
| `tests` | Integration tests against program + ER where applicable. |

Default **devnet program id** is declared in [`Anchor.toml`](./Anchor.toml) under `[programs.devnet]`; override with `KESTREL_PROGRAM_ID` in app and worker env when you deploy your own keypair.

## Technical reference

### Stack

| Piece | Notes |
|--------|--------|
| Anchor | Version pinned in [`Anchor.toml`](./Anchor.toml) (`anchor_version`; workspace uses Anchor **0.32.x**). |
| Solana / SVM | Program and clients target **Solana**; agents and scheduler use `@solana/web3.js` + Anchor TS. |
| MagicBlock ER | Delegation and ER sends use **`@magicblock-labs/ephemeral-rollups-sdk`** and a dedicated **ER RPC** (see env examples). |
| Monorepo | **pnpm** workspaces; root [`package.json`](./package.json) holds shared JS deps; each package has its own `package.json` where needed. |

### On-chain program (`programs/kestrel`)

Single crate `kestrel`, compiled with Anchor’s **`#[ephemeral]`** attribute so the same instruction set can execute against **base** and **Ephemeral Rollup** connections depending on account delegation state. The `declare_id!` in `lib.rs` matches **localnet** in [`Anchor.toml`](./Anchor.toml); **devnet** deployments use the program id under `[programs.devnet]` (clients should follow env / IDL address, not assume the declare_id in source).

**Core accounts**

| Account | Purpose |
|---------|---------|
| `Config` | Admin, treasury, USDC mint, default BTC/USD price update pubkey, `fee_bps`, `market_count`. |
| `Vault` | Program-owned USDC holding; `deposit` / `withdraw` move tokens against agent liability. |
| `Market` | Per-id market PDA: schedule (`open_ts`, `close_ts`), `strike`, `status` (pending / open / halted / closed), oracle feed, CPMM reserves, winner after close. |
| `AgentProfile` | Per-owner PDA: `balance` (ER-side liability while delegated), `policy`, `status`, fixed-size **`positions`** array (`MAX_POSITIONS = 16`, see `constants.rs`). |

**`AgentPolicy` (enforced inside instructions)**

- `max_stake_per_window` — collateral cap per bet relative to policy.
- `max_open_positions` — distinct non-empty positions the agent may hold at once (separate from the physical slot array size).
- `allowed_markets_root` — `[0; 32]` disables the gate; otherwise must match the market’s oracle feed bytes for `place_bet`.
- `paused` — blocks trading when set (with `AgentStatus`).

**PDA seeds** (see `programs/kestrel/src/constants.rs`)

- `config` → `Config`
- `vault` → `Vault`
- `market` + `id.to_le_bytes()` → `Market`
- `agent` + owner pubkey → `AgentProfile`

**Instructions** (public API on `kestrel`; grouping reflects typical call site, not a second program ID)

Lifecycle and custody (often **base** RPC for undelegated accounts or admin-only paths):

- `init_config`, `migrate_config`
- `register_agent`, `update_policy`
- `deposit`, `withdraw`
- `create_market`, `delegate_market`, `delegate_agent`
- `commit_and_undelegate_agent`, `commit_and_undelegate_market`, `commit_market`

Trading and resolution (**ER** RPC once `Market` / `AgentProfile` are delegated):

- `open_market` — activates book on ER, reads strike from oracle at open time, seeds liquidity.
- `place_bet`, `cancel_bet`, `close_position` — CPMM-style YES/NO; oracle freshness and policy checks on `place_bet`.
- `halt_market`, `resume_market` — admin (`Config.admin`).
- `close_market` — after `close_ts`, reads oracle, sets winner and **closed**.
- `settle_position`, `settle_positions` — pay winning side into agent balance and clear position slot(s) where applicable.

Constants worth citing in client code: `ORACLE_MAX_AGE_SECS`, `MIN_SEED_LIQUIDITY`, `DEFAULT_FEE_BPS` (100 = 1% unless config overrides at init).

### IDL and shared program id

- `anchor build` emits **`target/idl/kestrel.json`**.
- The **Next.js** app imports that IDL from [`app/lib/indexer/decode.ts`](./app/lib/indexer/decode.ts) (and related API tx builders).
- **Agents** import the same JSON via [`agents/src/common/connections.ts`](./agents/src/common/connections.ts).

After upgrading the program, rebuild and **restart** any long-lived Node process that bundles the IDL so account metas and discriminators stay in sync.

### Off-chain components

| Component | Tech | Role |
|-----------|------|------|
| `scheduler/` | TypeScript | Horizon scan, `create_market` + `delegate_market`, ER `open_market` / `close_market`, commit paths; uses admin keypair from env. |
| `agents/` | TypeScript | Three roles; `ensureErTradingReady` (undelegate if needed, deposit, `delegate_agent`); trading via Anchor or optional `KESTREL_API_BASE_URL` to [`app/app/api/v1`](./app/app/api/v1). |
| `app/` | Next.js  (App Router) | UI, REST builders for unsigned txs, optional **`instrumentation`** indexer writing to Supabase when `KESTREL_INDEXER_ENABLED=true`. |

Env templates: [`app/.env.example`](./app/.env.example), [`agents/.env.example`](./agents/.env.example), [`scheduler/.env.example`](./scheduler/.env.example).

### Tests

From repo root (see `[scripts]` in [`Anchor.toml`](./Anchor.toml)):

```bash
anchor build
anchor run test      # ts-mocha against tests/**/*.ts
anchor run test-er   # same with RUN_ER_TESTS=1 for ER-sensitive paths
```

## Quick start (local)

Prerequisites: **Rust**, **Anchor** (see `Anchor.toml` for `anchor_version`), **Node/pnpm**, Solana CLI configured for **devnet**.

```bash
pnpm install
anchor build
```

**Typical live demo (five processes):** (1) `cd scheduler && pnpm dev` — horizon, delegate, open/close. (2) `cd app && KESTREL_INDEXER_ENABLED=true pnpm dev` — UI plus optional indexer to Supabase (apply SQL migrations under `app/supabase/migrations/` first if you use it). (3) `cd agents && pnpm dev:all` — MarketOps, Trader, Risk-LP. Copy env from `app/.env.example`, `agents/.env.example`, and `scheduler/.env.example`; fund devnet SOL/USDC for the admin and agent keypairs; optional `pnpm --filter @kestrel/agents fund`. Withdraw after settle uses `commit_and_undelegate_agent` then `withdraw` on base (see `agents/scripts/withdraw-demo.ts` or the app’s `/api/v1/agent/withdraw` builder).

## License

[LICENSE](LICENSE)