import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://meddhajji.vercel.app";
    return [
        {
            url: `${baseUrl}/`,
            lastModified: new Date(),
            changeFrequency: "monthly",
            priority: 1,
        },
        {
            url: `${baseUrl}/avito`,
            lastModified: new Date(),
            changeFrequency: "hourly",
            priority: 0.9,
        },
        {
            url: `${baseUrl}/avitopt`,
            lastModified: new Date(),
            changeFrequency: "daily",
            priority: 0.8,
        },
    ];
}
