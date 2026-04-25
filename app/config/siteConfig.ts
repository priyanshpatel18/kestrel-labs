import { Metadata } from "next";

const { title, description, ogImage, baseURL } = {
  title: "kestrel",
  description:
    "Five-minute Bitcoin markets, settled on Solana with MagicBlock Ephemeral Rollups.",
  baseURL: "https://kestrel.priyanshpatel.com",
  ogImage: "https://kestrel.priyanshpatel.com/open-graph.png",
};

export const siteConfig: Metadata = {
  title: {
    default: title,
    template: `%s | ${title}`,
  },
  description,
  metadataBase: new URL(baseURL),
  openGraph: {
    title,
    description,
    images: [ogImage],
    url: baseURL,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [ogImage],
    creator: `@${title}`,
  },
  icons: {
    icon: "/favicon.ico",
  },
  applicationName: title,
  alternates: {
    canonical: baseURL,
  },
  keywords: [
    "Solana",
    "MagicBlock",
    "Ephemeral Rollups",
    "Bitcoin",
    "Markets",
    "Settled on Chain",
    "kestrel",
  ],
};