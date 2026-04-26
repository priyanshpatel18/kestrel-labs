import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { agentPda, buildProgram, publicKeyOrNull } from "@/lib/api/buildTx";
import { fetchAgentRow } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/agent/:pubkey
 *
 * Returns the on-chain AgentProfile for the given wallet public key, merged
 * with the last-known indexer summary (balance history, role, label).
 *
 * This is the primary polling endpoint for agents to check their balance and
 * open positions after placing bets.
 *
 * Response 200:
 *   {
 *     ownerPubkey:  string
 *     agentPda:     string
 *     balance:      string   (u64 token lamports)
 *     deposited:    string
 *     status:       "Active" | "Paused"
 *     policy: {
 *       maxStakePerWindow:  string
 *       maxOpenPositions:   number
 *       paused:             boolean
 *     }
 *     positions: Array<{
 *       marketId:  number
 *       yesShares: string
 *       noShares:  string
 *       stake:     string
 *       settled:   boolean
 *     }>
 *     // from indexer (may be null if not yet indexed)
 *     role:        string | null
 *     label:       string | null
 *     lastEventAt: string | null
 *   }
 *
 * Response 404: { error: "agent not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> },
) {
  try {
    const { pubkey } = await params;
    const ownerKey = publicKeyOrNull(pubkey);
    if (!ownerKey) {
      return NextResponse.json(
        { error: "invalid pubkey" },
        { status: 400 },
      );
    }

    const { program, env } = buildProgram("base");
    const pda = agentPda(ownerKey, env.programId);

    // Fetch on-chain profile. The account may not exist yet (unregistered agent).
    let onchain: Record<string, any> | null = null;
    try {
      onchain = await (program as any).account.agentProfile.fetch(pda);
    } catch {
      // account doesn't exist
    }

    if (!onchain) {
      // Fall back to indexer row — at least confirm agent is known.
      const row = await fetchAgentRow(pubkey).catch(() => null);
      if (!row) {
        return NextResponse.json(
          { error: "agent not found" },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ownerPubkey: pubkey,
        agentPda: row.agent_pda,
        balance: String(row.current_balance ?? 0),
        deposited: "0",
        status: "Active",
        policy: null,
        positions: [],
        role: row.role,
        label: row.label,
        lastEventAt: row.last_event_at,
        note: "on-chain account not found — agent may not be registered yet",
      });
    }

    const positions = (onchain.positions as any[])
      .slice(0, onchain.positionsLen as number)
      .filter((p: any) => !(p.yesShares.isZero() && p.noShares.isZero() && p.stake.isZero()))
      .map((p: any) => ({
        marketId: p.marketId as number,
        yesShares: p.yesShares.toString(),
        noShares: p.noShares.toString(),
        stake: p.stake.toString(),
        settled: p.settled as boolean,
      }));

    // Enrich with indexer data (non-fatal)
    const row = await fetchAgentRow(pubkey).catch(() => null);

    return NextResponse.json({
      ownerPubkey: (onchain.owner as PublicKey).toBase58(),
      agentPda: pda.toBase58(),
      balance: onchain.balance.toString(),
      deposited: onchain.depositedAmount.toString(),
      status: Object.keys(onchain.status)[0] === "active" ? "Active" : "Paused",
      policy: {
        maxStakePerWindow: onchain.policy.maxStakePerWindow.toString(),
        maxOpenPositions: onchain.policy.maxOpenPositions as number,
        paused: onchain.policy.paused as boolean,
      },
      positions,
      role: row?.role ?? null,
      label: row?.label ?? null,
      lastEventAt: row?.last_event_at ?? null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
