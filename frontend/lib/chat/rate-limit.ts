import { createHash } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Chat rate limits. Counters live in PostgreSQL because serverless instances
 * share no memory: an in-process counter would reset on every cold start.
 *
 * The global cap protects the LLM provider's daily quota from the whole
 * internet; the per-visitor caps stop one client from using it all.
 */
export const LIMITS = {
    perVisitorMinute: 6,
    perVisitorDay: 40,
    globalDay: 400,
} as const;

export type RateLimitResult = { ok: true } | { ok: false; reason: "visitor" | "global"; retryAfterSeconds: number };

/** Visitors are counted by a salted hash, so no IP address is ever stored. */
export function visitorKey(ip: string, salt: string = process.env.RATE_LIMIT_SALT ?? "avito-laptop-tracker"): string {
    return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export function clientIp(request: Request): string {
    // On Vercel the first x-forwarded-for entry is set by the platform, not the client
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function evaluate(counts: { minute: number; day: number; global: number }, now: Date): RateLimitResult {
    const secondsToNextMinute = 60 - now.getUTCSeconds();
    const secondsToNextDay = 86_400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds());

    if (counts.global > LIMITS.globalDay) return { ok: false, reason: "global", retryAfterSeconds: secondsToNextDay };
    if (counts.day > LIMITS.perVisitorDay) return { ok: false, reason: "visitor", retryAfterSeconds: secondsToNextDay };
    if (counts.minute > LIMITS.perVisitorMinute) return { ok: false, reason: "visitor", retryAfterSeconds: secondsToNextMinute };
    return { ok: true };
}

/** Counts this request and reports whether it is within the limits. */
export async function checkRateLimit(ip: string, now: Date = new Date()): Promise<RateLimitResult> {
    const visitor = visitorKey(ip);
    const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const sql = db();

    // One atomic statement: increment the three counters and read them back
    const rows = await sql`
        INSERT INTO chat_usage (scope, window_start, key, count)
        VALUES ('minute', ${minute}, ${visitor}, 1),
               ('day', ${day}, ${visitor}, 1),
               ('day', ${day}, 'global', 1)
        ON CONFLICT (scope, window_start, key) DO UPDATE SET count = chat_usage.count + 1
        RETURNING scope, key, count
    `;

    const count = (scope: string, key: string) => rows.find((r) => r.scope === scope && r.key === key)?.count ?? 0;

    // Old windows are useless; clear them occasionally instead of on every request
    if (Math.random() < 0.02) {
        await sql`DELETE FROM chat_usage WHERE window_start < now() - interval '2 days'`;
    }

    return evaluate({ minute: count("minute", visitor), day: count("day", visitor), global: count("day", "global") }, now);
}
