import { db } from "@/lib/db";
import type { Laptop } from "@/lib/types";

export const PAGE_SIZE = 12;

/** Columns sent to the UI (everything except internal ones like search_vector). */
export const LAPTOP_COLUMNS = [
    "id", "avito_id", "link", "description", "price", "city", "is_shop", "has_delivery",
    "brand", "model", "cpu", "ram", "storage", "ssd", "gpu", "gpu_type", "gpu_vram",
    "screen_size", "refresh_rate", "new", "touchscreen", "score", "fair_price", "deal_pct",
    "is_sold", "listed_at", "created_at", "updated_at",
].join(", ");

export type LaptopSearchParams = { [key: string]: string | string[] | undefined };

const UPLOAD_WINDOWS_HOURS: Record<string, number> = { "24h": 24, "3d": 72, "1w": 168 };

/**
 * Listings priced this far below their estimate are almost never real offers
 * (deposits, typos, parts), so they are not ranked as deals.
 */
export const SUSPICIOUS_DEAL_PCT = -50;

/**
 * Credible deals first, then listings with no estimate or an implausible price.
 * Deals are ranked in 10-point discount bands and by hardware score within a
 * band, so the top of the list is strong laptops at a real discount rather than
 * whatever sits closest to the implausible threshold.
 */
export const BEST_DEAL_ORDER =
    `(deal_pct IS NULL OR deal_pct <= ${SUSPICIOUS_DEAL_PCT}), deal_pct / 10, score DESC NULLS LAST`;

const str = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const accentTolerant = (text: string) =>
    escapeRegex(text)
        .replace(/[eéèêë]/gi, "[eéèêë]")
        .replace(/[aàâä]/gi, "[aàâä]")
        .replace(/[cç]/gi, "[cç]")
        .replace(/[iîï]/gi, "[iîï]")
        .replace(/[oôö]/gi, "[oôö]")
        .replace(/[uùûü]/gi, "[uùûü]");

/**
 * One case-insensitive regex per word. Every word but the last must match a
 * whole word; the last matches as a prefix so results appear while typing.
 */
const wordPatterns = (input: string) => {
    const endsWithSpace = /\s$/.test(input);
    const words = input.trim().split(/\s+/).filter((w) => w.length >= 2);
    return words.map((word, i) => {
        const whole = endsWithSpace || i < words.length - 1;
        return `\\y${accentTolerant(word)}${whole ? "\\y" : ""}`;
    });
};

/** Prefix full-text query, e.g. "think i5" -> "think:* & i5:*". */
const toPrefixTsQuery = (search: string) => {
    const words = search.trim().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter((w) => w.length > 1);
    return words.length ? words.map((w) => `${w}:*`).join(" & ") : null;
};

/**
 * Builds the WHERE clause for the dashboard. Values are always bound as
 * parameters; only fixed column names are interpolated.
 */
function buildWhere(params: LaptopSearchParams) {
    // Duplicate listings (same specs, price and city) are hidden behind the newest one
    const conditions: string[] = ["duplicate_of IS NULL"];
    const values: Array<string | number> = [];
    const bind = (value: string | number) => {
        values.push(value);
        return `$${values.length}`;
    };

    const tsQuery = toPrefixTsQuery(str(params.search));
    if (tsQuery) conditions.push(`search_vector @@ to_tsquery('simple', ${bind(tsQuery)})`);

    for (const column of ["brand", "city", "gpu"] as const) {
        const input = str(params[column]);
        if (!input || input === "all" || input === "Any") continue;
        for (const pattern of wordPatterns(input)) conditions.push(`${column} ~* ${bind(pattern)}`);
    }

    const gpuType = str(params.gpu_type);
    if (gpuType && gpuType !== "all" && gpuType !== "Any") conditions.push(`gpu_type ILIKE ${bind(gpuType)}`);

    const ranges: Array<[param: string, column: string, op: string]> = [
        ["price_min", "price", ">="],
        ["price_max", "price", "<="],
        ["ram_min", "ram", ">="],
        ["storage_min", "storage", ">="],
        ["gpu_vram_min", "gpu_vram", ">="],
        ["screen_size_min", "screen_size", ">="],
        ["refresh_rate_min", "refresh_rate", ">="],
    ];
    for (const [param, column, op] of ranges) {
        const value = parseFloat(str(params[param]));
        if (Number.isFinite(value)) conditions.push(`${column} ${op} ${bind(value)}`);
    }

    if (params.is_new === "true") conditions.push("new = 1");
    if (params.touchscreen === "true") conditions.push("touchscreen = 1");
    if (params.ssd === "true") conditions.push("ssd = 1");
    if (params.is_shop === "true") conditions.push("is_shop");
    if (params.delivery_only === "true") conditions.push("has_delivery");
    if (params.hide_unknown_prices === "true") conditions.push("price > 0");
    if (params.show_sold !== "true") conditions.push("NOT is_sold");

    const hours = UPLOAD_WINDOWS_HOURS[str(params.upload_date)];
    if (hours) {
        const threshold = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        conditions.push(`coalesce(listed_at, created_at) >= ${bind(threshold)}`);
    }

    return { where: `WHERE ${conditions.join(" AND ")}`, values };
}

export async function fetchLaptops(params: LaptopSearchParams): Promise<{ laptops: Laptop[]; total: number }> {
    const page = Math.max(parseInt(str(params.page) || "0", 10) || 0, 0);
    const direction = str(params.sortOrder) === "asc" ? "ASC" : "DESC";
    const sortBy = str(params.sortBy);
    const orderBy =
        sortBy === "score" || sortBy === "price" ? `${sortBy} ${direction} NULLS LAST, id DESC`
        : sortBy === "newest" ? "coalesce(listed_at, created_at) DESC, id DESC"
        : `${BEST_DEAL_ORDER}, id DESC`;

    const { where, values } = buildWhere(params);
    const sql = db();

    const [rows, [{ total }]] = await Promise.all([
        sql.unsafe(
            `SELECT ${LAPTOP_COLUMNS} FROM laptops ${where} ORDER BY ${orderBy} LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`,
            values,
        ),
        sql.unsafe(`SELECT count(*)::int AS total FROM laptops ${where}`, values),
    ]);

    // Timestamps come back as Date objects; the UI types (and the data cache) expect ISO strings
    const laptops = rows.map((row) => ({
        ...row,
        listed_at: row.listed_at?.toISOString() ?? null,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
    })) as unknown as Laptop[];

    return { laptops, total: total as number };
}

/**
 * Finish time of the most recent successful run that covered the whole category.
 * Trial runs on a few pages and failed runs do not count as a refresh.
 */
export async function fetchLastUpdate(): Promise<{ created_at: string } | null> {
    const [row] = await db()`
        SELECT finished_at FROM pipeline_runs
        WHERE status = 'success' AND complete
        ORDER BY finished_at DESC
        LIMIT 1
    `;
    return row ? { created_at: (row.finished_at as Date).toISOString() } : null;
}
