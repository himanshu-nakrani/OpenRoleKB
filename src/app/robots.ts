import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://openrolekb.example.com";
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/about", "/privacy", "/terms", "/job/"],
      disallow: ["/search/", "/admin/", "/api/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
