import Link from "next/link";
import { bricolage } from "@/lib/font";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";

export function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/0 bg-background/40 backdrop-blur supports-[backdrop-filter]:bg-background/30">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <span className={cn("text-xl font-medium", bricolage)}>kestrel</span>
        </Link>

        <nav className="hidden items-center gap-5 text-sm text-muted-foreground sm:flex">
          {process.env.NODE_ENV !== "production" ? (
            <>
              <Link
                href="/markets"
                className="transition-colors hover:text-foreground"
              >
                Markets
              </Link>
              <Link
                href="/agents"
                className="transition-colors hover:text-foreground"
              >
                Agents
              </Link>
            </>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
