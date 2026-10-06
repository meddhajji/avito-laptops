import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Public address of the site, without a trailing slash. On Vercel it comes from
 * the platform; NEXT_PUBLIC_APP_URL overrides it (custom domain, local runs).
 */
export function siteUrl(): string {
    const explicit = process.env.NEXT_PUBLIC_APP_URL;
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const url = explicit || (vercel ? `https://${vercel}` : "http://localhost:3000");
    return url.replace(/\/+$/, "");
}
