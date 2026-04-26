import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent API — Kestrel",
  description:
    "REST API reference for agent-controlled trading on Kestrel prediction markets.",
};

// ── Shared primitives ─────────────────────────────────────────────────────────

function Section({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      {children}
    </section>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-xl font-semibold tracking-tight">{children}</h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-6 text-base font-semibold text-foreground/90">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

function Pre({ children, label }: { children: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {label && (
        <div className="border-b border-border bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">
          {label}
        </div>
      )}
      <pre className="overflow-x-auto bg-muted/20 p-4 font-mono text-xs leading-relaxed text-foreground">
        {children.trim()}
      </pre>
    </div>
  );
}

function ParamTable({
  rows,
}: {
  rows: { name: string; type: string; required?: boolean; desc: string }[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-muted-foreground">
            <th className="px-3 py-2 font-medium">Parameter</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Required</th>
            <th className="px-3 py-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.name} className="hover:bg-muted/20">
              <td className="px-3 py-2 font-mono">{r.name}</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">
                {r.type}
              </td>
              <td className="px-3 py-2">
                {r.required !== false ? (
                  <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                    yes
                  </span>
                ) : (
                  <span className="text-muted-foreground">no</span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndpointHeader({
  method,
  path,
  summary,
  chain,
}: {
  method: "GET" | "POST";
  path: string;
  summary: string;
  chain?: "base" | "er";
}) {
  const methodColor =
    method === "GET"
      ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
      : "bg-violet-500/10 text-violet-600 dark:text-violet-400";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${methodColor}`}
        >
          {method}
        </span>
        <code className="font-mono text-sm font-medium">{path}</code>
        {chain && (
          <span className="ml-auto rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            submit to: {chain === "er" ? "Ephemeral Rollup" : "base layer"}
          </span>
        )}
      </div>
      <P>{summary}</P>
    </div>
  );
}

function Divider() {
  return <hr className="border-border" />;
}

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "flow", label: "Agent flow" },
  { id: "ref-markets", label: "GET /markets" },
  { id: "ref-markets-id", label: "GET /markets/:id" },
  { id: "ref-agent-pubkey", label: "GET /agent/:pubkey" },
  { id: "ref-agent-register", label: "POST /agent/register" },
  { id: "ref-agent-deposit", label: "POST /agent/deposit" },
  { id: "ref-agent-withdraw", label: "POST /agent/withdraw" },
  { id: "ref-bet-place", label: "POST /bet/place" },
  { id: "ref-bet-cancel", label: "POST /bet/cancel" },
  { id: "ref-bet-close", label: "POST /bet/close" },
  { id: "ref-tx-send", label: "POST /tx/send" },
  { id: "sdk-ts", label: "TypeScript example" },
  { id: "sdk-py", label: "Python example" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl gap-0 px-4 pb-24 pt-10 sm:px-6 lg:gap-10">
      {/* Sidebar */}
      <aside className="hidden w-52 shrink-0 lg:block">
        <nav className="sticky top-20 flex flex-col gap-0.5 text-xs">
          {NAV.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              className="rounded px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {n.label}
            </a>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-10">
        {/* ── Overview ── */}
        <Section id="overview">
          <H2>Kestrel Agent API</H2>
          <div className="space-y-3">
            <P>
              Kestrel is a five-minute Bitcoin prediction market settled on
              Solana via MagicBlock Ephemeral Rollups. This API lets any agent
              with a Solana wallet trade on Kestrel markets without writing
              Anchor code or knowing the program internals.
            </P>
            <P>
              Every mutating endpoint returns an{" "}
              <strong>unsigned base64 transaction</strong>. Your agent decodes
              it, signs with its keypair, and submits to the indicated RPC. Read
              endpoints return plain JSON with no signing required.
            </P>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Base URL
              </p>
              <code className="font-mono text-sm">
                https://&lt;your-kestrel-host&gt;/api/v1
              </code>
            </div>
          </div>
        </Section>

        <Divider />

        {/* ── Quickstart ── */}
        <Section id="quickstart">
          <H2>Quickstart (5 API calls)</H2>
          <div className="space-y-4">
            <P>
              Everything an agent needs to go from zero to a live bet — no SDK,
              no Anchor dependency, just a wallet keypair and{" "}
              <Code>fetch</Code>.
            </P>

            <div className="space-y-3">
              {[
                {
                  step: "1",
                  title: "Find an open market",
                  code: `GET /api/v1/markets?status=open`,
                },
                {
                  step: "2",
                  title: "Register your agent (once per wallet)",
                  code: `POST /api/v1/agent/register\n{ "pubkey": "<your wallet pubkey>" }`,
                },
                {
                  step: "3",
                  title: "Deposit USDC",
                  code: `POST /api/v1/agent/deposit\n{ "pubkey": "...", "amount": 1000000 }`,
                },
                {
                  step: "4",
                  title: "Place a bet",
                  code: `POST /api/v1/bet/place\n{ "pubkey": "...", "marketId": 42, "side": "yes", "amount": 200000 }`,
                },
                {
                  step: "5",
                  title: "Each response gives you a base64 tx to sign + send",
                  code: `// pseudo-code\nconst { transaction, erRpcUrl } = await res.json();\nconst tx = Transaction.from(Buffer.from(transaction, "base64"));\ntx.sign(myKeypair);\nawait connection.sendRawTransaction(tx.serialize());`,
                },
              ].map(({ step, title, code }) => (
                <div key={step} className="flex gap-3">
                  <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                    {step}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <p className="text-sm font-medium">{title}</p>
                    <Pre>{code}</Pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        <Divider />

        {/* ── Flow ── */}
        <Section id="flow">
          <H2>Agent lifecycle</H2>
          <P>
            A full agent lifecycle from first registration through withdrawal:
          </P>
          <div className="mt-4 space-y-2">
            {[
              {
                n: 1,
                label: "register",
                endpoint: "POST /agent/register",
                chain: "base",
                note: "One-time setup. Creates your on-chain agent PDA.",
              },
              {
                n: 2,
                label: "deposit",
                endpoint: "POST /agent/deposit",
                chain: "base",
                note: "Transfer USDC into the program vault. Balance credited to your agent.",
              },
              {
                n: 3,
                label: "list markets",
                endpoint: "GET /markets?status=open",
                chain: "—",
                note: "Discover the currently open five-minute window.",
              },
              {
                n: 4,
                label: "place bet",
                endpoint: "POST /bet/place",
                chain: "ER",
                note: "Buy YES or NO shares on the Ephemeral Rollup. Near-instant.",
              },
              {
                n: 5,
                label: "poll",
                endpoint: "GET /agent/:pubkey",
                chain: "—",
                note: "Check your balance and open positions at any time.",
              },
              {
                n: 6,
                label: "cancel (optional)",
                endpoint: "POST /bet/cancel",
                chain: "ER",
                note: "Exit your entire position mid-window if you change your mind.",
              },
              {
                n: 7,
                label: "withdraw",
                endpoint: "POST /agent/withdraw",
                chain: "base",
                note: "Pull USDC back to your wallet. Agent must be undelegated from ER first (scheduler handles this automatically after market close).",
              },
            ].map(({ n, label, endpoint, chain, note }) => (
              <div
                key={n}
                className="flex items-start gap-3 rounded-lg border border-border p-3"
              >
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                  {n}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-xs font-medium">
                      {endpoint}
                    </code>
                    {chain !== "—" && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {chain}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Divider />

        {/* ── GET /markets ── */}
        <Section id="ref-markets">
          <EndpointHeader
            method="GET"
            path="/api/v1/markets"
            summary="List all markets. Filter by status to find the active window."
          />
          <H3>Query parameters</H3>
          <ParamTable
            rows={[
              {
                name: "status",
                type: "string",
                required: false,
                desc: "Filter: pending | open | halted | closed | settled",
              },
              {
                name: "limit",
                type: "number",
                required: false,
                desc: "Max results 1–100 (default 20)",
              },
            ]}
          />
          <H3>Example</H3>
          <Pre label="Request">GET /api/v1/markets?status=open&limit=5</Pre>
          <Pre label="Response 200">
            {`{
  "markets": [
    {
      "marketId":     42,
      "marketPubkey": "H7xY...Zk3m",
      "status":       "open",
      "strikePrice":  "9432150000000",
      "closePrice":   null,
      "winner":       null,
      "openTs":       1714120800,
      "closeTs":      1714121100
    }
  ]
}`}
          </Pre>
        </Section>

        <Divider />

        {/* ── GET /markets/:id ── */}
        <Section id="ref-markets-id">
          <EndpointHeader
            method="GET"
            path="/api/v1/markets/:id"
            summary="Single market detail by integer ID."
          />
          <H3>Path parameters</H3>
          <ParamTable
            rows={[
              {
                name: "id",
                type: "number",
                required: true,
                desc: "Integer market ID from the markets list",
              },
            ]}
          />
          <H3>Example</H3>
          <Pre label="Request">GET /api/v1/markets/42</Pre>
          <Pre label="Response 200">
            {`{
  "marketId":     42,
  "marketPubkey": "H7xY...Zk3m",
  "status":       "closed",
  "strikePrice":  "9432150000000",
  "closePrice":   "9441200000000",
  "winner":       "yes",
  "openTs":       1714120800,
  "closeTs":      1714121100
}`}
          </Pre>
        </Section>

        <Divider />

        {/* ── GET /agent/:pubkey ── */}
        <Section id="ref-agent-pubkey">
          <EndpointHeader
            method="GET"
            path="/api/v1/agent/:pubkey"
            summary="On-chain agent profile: balance, policy, and open positions."
          />
          <H3>Path parameters</H3>
          <ParamTable
            rows={[
              {
                name: "pubkey",
                type: "string",
                required: true,
                desc: "Base58 wallet public key",
              },
            ]}
          />
          <H3>Example</H3>
          <Pre label="Request">GET /api/v1/agent/9xQ3...Wm7p</Pre>
          <Pre label="Response 200">
            {`{
  "ownerPubkey":  "9xQ3...Wm7p",
  "agentPda":     "B2rk...Ux9v",
  "balance":      "800000",
  "deposited":    "1000000",
  "status":       "Active",
  "policy": {
    "maxStakePerWindow": "500000",
    "maxOpenPositions":  8,
    "paused":            false
  },
  "positions": [
    {
      "marketId":  42,
      "yesShares": "398212",
      "noShares":  "0",
      "stake":     "200000",
      "settled":   false
    }
  ],
  "role":        "trader",
  "label":       null,
  "lastEventAt": "2024-04-26T09:00:01Z"
}`}
          </Pre>
        </Section>

        <Divider />

        {/* ── POST /agent/register ── */}
        <Section id="ref-agent-register">
          <EndpointHeader
            method="POST"
            path="/api/v1/agent/register"
            summary="Build a register_agent transaction. Call once per wallet. Submit to the base-layer RPC."
            chain="base"
          />
          <H3>Request body</H3>
          <ParamTable
            rows={[
              {
                name: "pubkey",
                type: "string",
                required: true,
                desc: "Your wallet public key (base58)",
              },
              {
                name: "maxStakePerWindow",
                type: "number",
                required: false,
                desc: "Token lamports per-bet cap (default 500,000)",
              },
              {
                name: "maxOpenPositions",
                type: "number",
                required: false,
                desc: "Max concurrent open positions (default 8, max 16)",
              },
            ]}
          />
          <H3>Example</H3>
          <Pre label="Request body">
            {`{
  "pubkey": "9xQ3...Wm7p",
  "maxStakePerWindow": 500000
}`}
          </Pre>
          <Pre label="Response 200">
            {`{
  "transaction": "AQAAAA...base64...",
  "agentPda":    "B2rk...Ux9v",
  "baseRpcUrl":  "https://api.devnet.solana.com",
  "note":        "Sign this transaction with your wallet and submit it to baseRpcUrl"
}`}
          </Pre>
        </Section>

        <Divider />

        {/* ── POST /agent/deposit ── */}
        <Section id="ref-agent-deposit">
          <EndpointHeader
            method="POST"
            path="/api/v1/agent/deposit"
            summary="Build a deposit transaction. Transfers USDC from your ATA into the program vault. Submit to the base-layer RPC."
            chain="base"
          />
          <H3>Request body</H3>
          <ParamTable
            rows={[
              {
                name: "pubkey",
                type: "string",
                required: true,
                desc: "Your wallet public key (base58)",
              },
              {
                name: "amount",
                type: "number",
                required: true,
                desc: "USDC in token lamports (e.g. 1,000,000 = 1 USDC at 6 decimals)",
              },
            ]}
          />
          <H3>Example</H3>
          <Pre label="Request body">
            {`{
  "pubkey":  "9xQ3...Wm7p",
  "amount":  1000000
}`}
          </Pre>
          <Pre label="Response 200">
            {`{
  "transaction": "AQAAAA...base64...",
  "baseRpcUrl":  "https://api.devnet.solana.com",
  "usdcMint":    "4zMMC...MkGb",
  "userAta":     "FjqQ...7y2t",
  "note":        "Sign this transaction with your wallet and submit it to baseRpcUrl. Your USDC ATA must already exist."
}`}
          </Pre>
        </Section>

        <Divider />

        {/* ── POST /agent/withdraw ── */}
        <Section id="ref-agent-withdraw">
          <EndpointHeader
            method="POST"
            path="/api/v1/agent/withdraw"
            summary="Build a withdraw transaction. Pulls USDC back to your wallet. Submit to the base-layer RPC. Agent must be undelegated from the ER first."
            chain="base"
          />
          <H3>Request body</H3>
          <ParamTable
            rows={[
              {
                name: "pubkey",
                type: "string",
                required: true,
                desc: "Your wallet public key (base58)",
              },
              {
                name: "amount",
                type: "number",
                required: true,
                desc: "USDC in token lamports to withdraw",
              },
            ]}
          />
          <H3>Example</H3>
          <Pre label="Request body">
            {`{
  "pubkey":  "9xQ3...Wm7p",
  "amount":  800000
}`}
          </Pre>
          <Pre label="Response 200">
            {`{
  "transaction":  "AQAAAA...base64...",
  "baseRpcUrl":   "https://api.devnet.solana.com",
  "usdcMint":     "4zMMC...MkGb",
  "userAta":      "FjqQ...7y2t",
  "treasuryAta":  "Hm3p...9wQs",
  "note":         "Sign and submit to baseRpcUrl. Agent must be undelegated from the ER first."
}`}
          </Pre>
        </Section>

        <Divider />

        {/* ── POST /bet/place ── */}
        <Section id="ref-bet-place">
          <EndpointHeader
            method="POST"
            path="/api/v1/bet/place"
            summary="Build a place_bet transaction. Buys YES or NO shares on the open market. Submit to the Ephemeral Rollup RPC for near-instant settlement."
            chain="er"
          />
          <H3>Request body</H3>
          <ParamTable
            rows={[
              {
                name: "pubkey",
                type: "string",
                required: true,
                desc: "Your wallet public key (base58)",
              },
              {
                name: "marketId",
                type: "number",
                required: true,
                desc: "Integer market ID (from GET /markets?status=open)",
              },
              {
                name: "side",
                type: '"yes" | "no"',
                required: true,
                desc: 'YES = price closes above strike, NO = below',
              },
              {
                name: "amount",
                type: "number",
                required: true,
                desc: "Collateral in token lamports. Must be ≤ policy.maxStakePerWindow.",
              },
            ]}
          />
          <H3>Example</H3>
          <Pre label="Request body">
            {`{
  "pubkey":    "9xQ3...Wm7p",
  "marketId":  42,
  "side":      "yes",
  "amount":    200000
}`}
          </Pre>
          <Pre label="Response 200">
            {`{
  "transaction":  "AQAAAA...base64...",
  "erRpcUrl":     "https://devnet-as.magicblock.app/",
  "marketPubkey": "H7xY...Zk3m",
  "oracleFeed":   "71wtT...51sr",
  "note":         "Sign this transaction and submit it to erRpcUrl. This runs on the Ephemeral Rollup for instant settlement."
}`}
          </Pre>
        </Section>

        <Divider />

        {/* ── POST /bet/cancel ── */}
        <Section id="ref-bet-cancel">
          <EndpointHeader
            method="POST"
            path="/api/v1/bet/cancel"
            summary="Build a cancel_bet transaction. Closes your entire position in a market and returns collateral to your agent balance. Submit to the ER RPC."
            chain="er"
          />
          <H3>Request body</H3>
          <ParamTable
            rows={[
              {
                name: "pubkey",
                type: "string",
                required: true,
                desc: "Your wallet public key (base58)",
              },
              {
                name: "marketId",
                type: "number",
                required: true,
                desc: "Integer market ID",
              },
            ]}
          />
          <H3>Example</H3>
          <Pre label="Request body">
            {`{
  "pubkey":   "9xQ3...Wm7p",
  "marketId": 42
}`}
          </Pre>
          <Pre label="Response 200">
            {`{
  "transaction":  "AQAAAA...base64...",
  "erRpcUrl":     "https://devnet-as.magicblock.app/",
  "marketPubkey": "H7xY...Zk3m",
  "note":         "Sign and submit to erRpcUrl while the market is still open."
}`}
          </Pre>
        </Section>

        <Divider />

        {/* ── POST /bet/close ── */}
        <Section id="ref-bet-close">
          <EndpointHeader
            method="POST"
            path="/api/v1/bet/close"
            summary="Build a close_position transaction. Partially sells shares of one side back to the AMM at the current market price. Submit to the ER RPC."
            chain="er"
          />
          <H3>Request body</H3>
          <ParamTable
            rows={[
              {
                name: "pubkey",
                type: "string",
                required: true,
                desc: "Your wallet public key (base58)",
              },
              {
                name: "marketId",
                type: "number",
                required: true,
                desc: "Integer market ID",
              },
              {
                name: "side",
                type: '"yes" | "no"',
                required: true,
                desc: "Which side's shares to sell",
              },
              {
                name: "shares",
                type: "number",
                required: true,
                desc: "Number of shares to sell (must be ≤ held shares)",
              },
            ]}
          />
          <H3>Example</H3>
          <Pre label="Request body">
            {`{
  "pubkey":   "9xQ3...Wm7p",
  "marketId": 42,
  "side":     "yes",
  "shares":   200000
}`}
          </Pre>
          <Pre label="Response 200">
            {`{
  "transaction":  "AQAAAA...base64...",
  "erRpcUrl":     "https://devnet-as.magicblock.app/",
  "marketPubkey": "H7xY...Zk3m",
  "note":         "Sign and submit to erRpcUrl while the market is still open. Partial closes are allowed."
}`}
          </Pre>
        </Section>

        <Divider />

        {/* ── POST /tx/send ── */}
        <Section id="ref-tx-send">
          <EndpointHeader
            method="POST"
            path="/api/v1/tx/send"
            summary="Optional relay: broadcast a signed transaction to the base or ER RPC without managing the URL yourself."
          />
          <H3>Request body</H3>
          <ParamTable
            rows={[
              {
                name: "transaction",
                type: "string",
                required: true,
                desc: "Base64 SIGNED transaction bytes",
              },
              {
                name: "cluster",
                type: '"base" | "er"',
                required: false,
                desc: 'Which chain to submit to (default "er")',
              },
            ]}
          />
          <H3>Example</H3>
          <Pre label="Request body">
            {`{
  "transaction": "AQAAAA...signed...",
  "cluster":     "er"
}`}
          </Pre>
          <Pre label="Response 200">
            {`{
  "signature":   "4fGZ...base58sig...",
  "cluster":     "er",
  "rpcUrl":      "https://devnet-as.magicblock.app/",
  "explorerUrl": "https://explorer.solana.com/tx/4fGZ...?cluster=devnet"
}`}
          </Pre>
        </Section>

        <Divider />

        {/* ── TypeScript example ── */}
        <Section id="sdk-ts">
          <H2>TypeScript — full agent loop</H2>
          <P>
            A minimal but complete agent that finds an open market, places a YES
            bet, and logs the result. No Anchor dependency required.
          </P>
          <Pre label="agent.ts">
            {`import {
  Connection,
  Keypair,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const BASE_URL = "https://<your-kestrel-host>/api/v1";

// Load your keypair however you manage secrets.
const secret = JSON.parse(process.env.AGENT_SECRET_KEY!);
const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
const pubkey  = keypair.publicKey.toBase58();

async function call(path: string, body?: object) {
  const res = await fetch(\`\${BASE_URL}\${path}\`, {
    method:  body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body:    body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(\`\${path} \${res.status}: \${await res.text()}\`);
  return res.json();
}

async function signAndSend(
  transaction: string,
  rpcUrl: string,
): Promise<string> {
  const connection = new Connection(rpcUrl, "confirmed");
  const tx = Transaction.from(Buffer.from(transaction, "base64"));
  tx.sign(keypair);
  return connection.sendRawTransaction(tx.serialize());
}

async function main() {
  // 1. Register (safe to call multiple times — will fail if already registered).
  try {
    const reg = await call("/agent/register", { pubkey });
    const sig = await signAndSend(reg.transaction, reg.baseRpcUrl);
    console.log("registered", sig);
  } catch (e) {
    console.log("register skipped:", (e as Error).message.slice(0, 60));
  }

  // 2. Deposit 1 USDC.
  const dep = await call("/agent/deposit", { pubkey, amount: 1_000_000 });
  const depSig = await signAndSend(dep.transaction, dep.baseRpcUrl);
  console.log("deposited", depSig);

  // 3. Find an open market.
  const { markets } = await call("/markets?status=open");
  if (!markets.length) { console.log("no open market"); return; }
  const market = markets[0];
  console.log("open market:", market.marketId, "closes at", market.closeTs);

  // 4. Place a YES bet of 200,000 lamports.
  const bet = await call("/bet/place", {
    pubkey,
    marketId: market.marketId,
    side:     "yes",
    amount:   200_000,
  });
  const betSig = await signAndSend(bet.transaction, bet.erRpcUrl);
  console.log("bet placed:", betSig);

  // 5. Poll agent state.
  const agent = await call(\`/agent/\${pubkey}\`);
  console.log("balance:", agent.balance);
  console.log("positions:", agent.positions);
}

main().catch(console.error);`}
          </Pre>
        </Section>

        <Divider />

        {/* ── Python example ── */}
        <Section id="sdk-py">
          <H2>Python — full agent loop</H2>
          <P>
            Same flow in Python using{" "}
            <code className="font-mono text-xs">solders</code> and{" "}
            <code className="font-mono text-xs">httpx</code>.
          </P>
          <Pre label="agent.py">
            {`"""
pip install solders httpx base58
"""
import os, base64, httpx
from solders.keypair import Keypair
from solders.transaction import Transaction

BASE_URL = "https://<your-kestrel-host>/api/v1"

# Load your keypair (base58 private key string).
keypair = Keypair.from_base58_string(os.environ["AGENT_SECRET_KEY"])
pubkey  = str(keypair.pubkey())

def call(path: str, body: dict | None = None) -> dict:
    method = "POST" if body else "GET"
    r = httpx.request(method, BASE_URL + path, json=body, timeout=30)
    r.raise_for_status()
    return r.json()

def sign_and_send(transaction_b64: str, rpc_url: str) -> str:
    tx_bytes = base64.b64decode(transaction_b64)
    tx = Transaction.from_bytes(tx_bytes)
    tx.sign([keypair], tx.message.recent_blockhash)
    raw = bytes(tx)
    r = httpx.post(rpc_url, json={
        "jsonrpc": "2.0", "id": 1,
        "method":  "sendTransaction",
        "params":  [base64.b64encode(raw).decode(), {"encoding": "base64"}],
    }, timeout=30)
    r.raise_for_status()
    return r.json()["result"]

def main():
    # 1. Register.
    try:
        reg = call("/agent/register", {"pubkey": pubkey})
        sig = sign_and_send(reg["transaction"], reg["baseRpcUrl"])
        print("registered", sig)
    except Exception as e:
        print("register skipped:", str(e)[:60])

    # 2. Deposit 1 USDC (1_000_000 lamports at 6 decimals).
    dep = call("/agent/deposit", {"pubkey": pubkey, "amount": 1_000_000})
    print("deposited", sign_and_send(dep["transaction"], dep["baseRpcUrl"]))

    # 3. Find open market.
    markets = call("/markets?status=open")["markets"]
    if not markets:
        print("no open market")
        return
    market = markets[0]
    print(f"open market: {market['marketId']} closes {market['closeTs']}")

    # 4. Place YES bet.
    bet = call("/bet/place", {
        "pubkey":   pubkey,
        "marketId": market["marketId"],
        "side":     "yes",
        "amount":   200_000,
    })
    print("bet placed:", sign_and_send(bet["transaction"], bet["erRpcUrl"]))

    # 5. Check state.
    agent = call(f"/agent/{pubkey}")
    print("balance:", agent["balance"])
    print("positions:", agent["positions"])

if __name__ == "__main__":
    main()`}
          </Pre>
        </Section>
      </div>
    </div>
  );
}
