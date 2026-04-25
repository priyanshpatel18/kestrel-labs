import { LiveMarketCard } from "@/components/markets/LiveMarketCard";
import { HeroShader } from "@/components/site/HeroShader";
import { fetchDashboardSnapshot } from "@/lib/db/queries";
import type { MarketCloseOutcome, MarketRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  let nowMarket: MarketRow | null = null;
  let recentCloses: MarketCloseOutcome[] = [];

  try {
    const snapshot = await fetchDashboardSnapshot();
    nowMarket = snapshot.nowMarket;
    recentCloses = snapshot.recentCloseOutcomes;
  } catch {
    // Render the page anyway — the live oracle subscription is independent.
  }

  return (
    <div className="flex flex-col">
      <Hero />
      <div className="mx-auto -mt-24 w-full max-w-4xl px-4 sm:-mt-32 sm:px-6">
        <LiveMarketCard
          initialMarket={nowMarket}
          initialCloses={recentCloses}
        />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <HeroShader className="absolute inset-0 -z-10 h-full w-full opacity-80" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-background/30 to-background" />
      <div className="mx-auto flex w-full max-w-4xl flex-col items-start gap-6 px-6 pb-40 pt-20 sm:pb-48 sm:pt-28">
        <h1 className="max-w-3xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Five-minute Bitcoin markets,
          <br />
          settled on chain.
        </h1>
      </div>
    </section>
  );
}
