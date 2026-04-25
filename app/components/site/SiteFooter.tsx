import { bricolage } from "@/lib/font";
import { cn } from "@/lib/utils";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="px-6 pb-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pt-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className={cn("text-lg font-medium", bricolage)}>kestrel</span>
          </div>
        </div>

        <nav className="flex items-center gap-5 text-xs text-muted-foreground">
          <Link
            href="https://github.com/priyanshpatel18/kestrel-labs"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </Link>
          <Link
            href="https://magicblock.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            MagicBlock
          </Link>
        </nav>
      </div>
    </footer>
  );
}
