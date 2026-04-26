import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { SiteFooter } from "@/components/site/SiteFooter";
import { TopNav } from "@/components/site/TopNav";
import { siteConfig } from "@/config/siteConfig";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";
import { Geist, Inter_Tight } from "next/font/google";
import "./globals.css";

const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const display = Inter_Tight({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = siteConfig;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", sans.variable, display.variable)}
    >
      <body className="min-h-full bg-background font-sans text-foreground">
        <ThemeProvider>
          <div className="flex min-h-dvh flex-col">
            <TopNav />
            <main className="flex flex-1 flex-col">{children}</main>
            <SiteFooter />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
