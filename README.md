# Kestrel

Policy-governed trading agents on oracle-resolved short BTC markets: the trading path on MagicBlock Ephemeral Rollup, lifecycle and custody on Solana devnet.

## What it is

Kestrel is a **single Anchor program** plus **off-chain workers**: a **scheduler** maintains a rolling horizon of markets, **delegates** each market and each agent profile to an **Ephemeral Rollup (ER)** for fast `place_bet` / `cancel_bet` / `close_position` / settlement, and **three agent roles** (MarketOps, Trader, Risk-LP) sign transactions against the same on-chain rules as a human would. A **Next.js** app (and optional **Supabase-backed indexer**) exposes markets, agent traces, and stats for demos and judges.

Product framing and naming notes live in [`AGENTIC_HACK_IDEA.md`](./AGENTIC_HACK_IDEA.md). **Hackathon runbook** (env, five processes, withdraw path): [`HACKATHON_RUN.md`](./HACKATHON_RUN.md).

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
┌─────────────────────────────────────────────────────────────┐
│  Solana base (devnet)                                       │
│  Config, USDC vault, create_market, delegate_*, deposit,     │
│  withdraw, agent / market account owners pre-delegation      │
└───────────────────────────┬───────────────────────────────┘
                            │ delegate + commit / undelegate
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  MagicBlock Ephemeral Rollup                                 │
│  Market AMM state, AgentProfile balances & positions,          │
│  place_bet, cancel_bet, close_position, close_market,        │
│  settle_position(s), halt/resume, commit_and_undelegate_*    │
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

## Quick start (local)

Prerequisites: **Rust**, **Anchor** (see `Anchor.toml` for `anchor_version`), **Node/pnpm**, Solana CLI configured for **devnet**.

```bash
pnpm install
anchor build
```

Run the five-process demo (scheduler, app with indexer if desired, agents): see **[`HACKATHON_RUN.md`](./HACKATHON_RUN.md)** for env files, Supabase migrations, funding, and withdraw.

## License

ISC (see root and package `license` fields). Add or replace with a dedicated `LICENSE` file if you need a standard OSS license for distribution.
