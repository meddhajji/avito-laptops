import { db } from "@/lib/db";
import { BEST_DEAL_ORDER, LAPTOP_COLUMNS, SUSPICIOUS_DEAL_PCT } from "@/lib/laptops";
import type { Laptop } from "@/lib/types";
import { DEFAULT_RESULTS, MAX_RESULTS, type LaptopFilters } from "./filters";

export type SearchStats = {
    total: number;
    price_range: string | null;
    top_city: string | null;
    shown_in_table: number;
};

const UPLOAD_WINDOWS_HOURS = { "24h": 24, "3d": 72, "1w": 168 } as const;
const APPLE_TERM = /^(apple|macs?|macbooks?)$/i;

const ORDER_BY: Record<string, string> = {
    "price:asc": "price ASC, score DESC NULLS LAST",
    "price:desc": "price DESC NULLS LAST",
    "value:desc": BEST_DEAL_ORDER,
    "value:asc": BEST_DEAL_ORDER,
    "score:desc": "score DESC NULLS LAST, deal_pct ASC NULLS LAST",
    "score:asc": "score DESC NULLS LAST, deal_pct ASC NULLS LAST",
};

/**
 * Builds the search SQL for a set of filters. Every user-influenced value is a
 * bound parameter; the only interpolated pieces are fixed strings from this file.
 */
export function buildSearchQuery(filters: LaptopFilters, now: Date = new Date()) {
    const conditions: string[] = ["duplicate_of IS NULL"];
    const params: Array<string | number> = [];
    const bind = (value: string | number) => {
        params.push(value);
        return `$${params.length}`;
    };
    const containsAll = (column: string, phrase: string) => {
        for (const word of phrase.split(/\s+/).filter(Boolean)) conditions.push(`${column} ILIKE ${bind(`%${word}%`)}`);
    };

    if (!filters.show_sold) conditions.push("NOT is_sold");
    if (filters.city) containsAll("city", filters.city);
    if (filters.gpu) containsAll("gpu", filters.gpu);
    if (filters.price_max) conditions.push(`price <= ${bind(filters.price_max)} AND price > 0`);
    if (filters.price_min) conditions.push(`price >= ${bind(filters.price_min)}`);
    if (filters.ram_min) conditions.push(`ram >= ${bind(filters.ram_min)}`);
    if (filters.storage_min) conditions.push(`storage >= ${bind(filters.storage_min)}`);
    if (filters.gpu_type) conditions.push(`gpu_type = ${bind(filters.gpu_type)}`);
    if (filters.gpu_vram_min) conditions.push(`gpu_vram >= ${bind(filters.gpu_vram_min)}`);
    if (filters.screen_size_min) conditions.push(`screen_size >= ${bind(filters.screen_size_min)}`);
    if (filters.screen_size_max) conditions.push(`screen_size <= ${bind(filters.screen_size_max)}`);
    if (filters.refresh_rate_min) conditions.push(`refresh_rate >= ${bind(filters.refresh_rate_min)}`);
    if (filters.is_new !== undefined) conditions.push(`new = ${bind(filters.is_new ? 1 : 0)}`);
    if (filters.touchscreen !== undefined) conditions.push(`touchscreen = ${bind(filters.touchscreen ? 1 : 0)}`);
    if (filters.delivery_only) conditions.push("has_delivery");

    if (filters.upload_date) {
        const threshold = new Date(now.getTime() - UPLOAD_WINDOWS_HOURS[filters.upload_date] * 60 * 60 * 1000);
        conditions.push(`coalesce(listed_at, created_at) >= ${bind(threshold.toISOString())}`);
    }

    for (const term of filters.search_terms ?? []) {
        if (APPLE_TERM.test(term)) {
            // "mac", "macbook" and "apple" all mean the same brand
            conditions.push(`(brand ILIKE ${bind("%apple%")} OR model ILIKE ${bind("%macbook%")})`);
            continue;
        }
        const pattern = bind(`%${term}%`);
        conditions.push(
            `(brand ILIKE ${pattern} OR model ILIKE ${pattern} OR cpu ILIKE ${pattern} OR gpu ILIKE ${pattern} OR description ILIKE ${pattern})`
        );
    }

    const sortBy = filters.sort_by ?? "score";
    const sortOrder = filters.sort_order ?? (sortBy === "price" ? "asc" : "desc");
    if (sortBy === "price" || sortBy === "value") conditions.push("price > 0");
    // "Cheapest" should not surface prices that are too low to be real offers
    if (sortBy === "price" && sortOrder === "asc") conditions.push(`(deal_pct IS NULL OR deal_pct > ${SUSPICIOUS_DEAL_PCT})`);

    const where = conditions.join(" AND ");
    const limit = Math.min(Math.max(Math.round(filters.limit ?? DEFAULT_RESULTS), 1), MAX_RESULTS);

    return {
        resultsSQL: `SELECT ${LAPTOP_COLUMNS} FROM laptops WHERE ${where} ORDER BY ${ORDER_BY[`${sortBy}:${sortOrder}`]} LIMIT ${limit}`,
        statsSQL: `
            WITH matched AS (SELECT price, city FROM laptops WHERE ${where})
            SELECT count(*)::int AS total,
                   min(price) FILTER (WHERE price > 0) AS price_min,
                   max(price) FILTER (WHERE price > 0) AS price_max,
                   (SELECT city FROM matched GROUP BY city ORDER BY count(*) DESC LIMIT 1) AS top_city
            FROM matched`,
        params,
        limit,
    };
}

const formatDH = (value: number) => value.toLocaleString("en-US");

export async function runSearch(filters: LaptopFilters): Promise<{ laptops: Laptop[]; stats: SearchStats }> {
    const { resultsSQL, statsSQL, params } = buildSearchQuery(filters);
    const sql = db();
    const [rows, [stats]] = await Promise.all([sql.unsafe(resultsSQL, params), sql.unsafe(statsSQL, params)]);

    const priceMin = Number(stats?.price_min) || 0;
    const priceMax = Number(stats?.price_max) || 0;

    return {
        laptops: rows as unknown as Laptop[],
        stats: {
            total: Number(stats?.total) || 0,
            price_range: priceMin && priceMax ? `${formatDH(priceMin)} - ${formatDH(priceMax)} DH` : null,
            top_city: (stats?.top_city as string | null) ?? null,
            shown_in_table: rows.length,
        },
    };
}
