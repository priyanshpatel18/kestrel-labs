import Link from "next/link";

export function TopNav() {
  return (
    <header className="border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Kestrel
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link
            href="/"
            className="transition-colors hover:text-foreground"
          >
            Dashboard
          </Link>
          <Link
            href="/markets"
            className="transition-colors hover:text-foreground"
          >
            Markets
          </Link>
        </nav>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          policy-governed BTC/USD 5m markets
        </span>
      </div>
    </header>
  );
}
