import type { MetadataRoute } from "next";
const BASE_URL = "https://kestrel.priyanshpatel.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}