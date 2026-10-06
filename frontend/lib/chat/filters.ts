import { z } from "zod";

/**
 * Search filters the assistant can apply. This is the only thing the language
 * model is allowed to produce for a search: it never writes SQL.
 */
export type LaptopFilters = {
    search_terms?: string[];
    city?: string;
    price_min?: number;
    price_max?: number;
    ram_min?: number;
    storage_min?: number;
    gpu_type?: "Dedicated" | "Integrated";
    gpu?: string;
    gpu_vram_min?: number;
    screen_size_min?: number;
    screen_size_max?: number;
    refresh_rate_min?: number;
    is_new?: boolean;
    touchscreen?: boolean;
    delivery_only?: boolean;
    show_sold?: boolean;
    upload_date?: "24h" | "3d" | "1w";
    sort_by?: "score" | "price" | "value";
    sort_order?: "asc" | "desc";
    limit?: number;
    suggested_columns?: string[];
};

export const MAX_RESULTS = 20;
export const DEFAULT_RESULTS = 10;

const DISPLAY_COLUMNS = ["cpu", "gpu", "gpu_type", "city", "ram", "storage", "screen_size", "refresh_rate", "price", "score"];

/** Schema handed to the model. Types only: every limit is enforced by cleanFilters. */
export const llmFiltersSchema = z.object({
    search_terms: z.array(z.string()).nullable().describe(
        "Brand, model or component keywords only, e.g. ['ThinkPad'], ['Dell', 'XPS'], ['RTX 4060']. Never city, price, condition or sorting words."
    ),
    city: z.string().nullable().describe("Moroccan city, e.g. 'Casablanca'."),
    price_min: z.number().nullable().describe("Minimum price in DH."),
    price_max: z.number().nullable().describe("Maximum price / budget in DH."),
    ram_min: z.number().nullable().describe("Minimum RAM in GB."),
    storage_min: z.number().nullable().describe("Minimum storage in GB (1 TB = 1000)."),
    gpu_type: z.enum(["Dedicated", "Integrated"]).nullable().describe("'Dedicated' for gaming, 3D, video editing or ML needs."),
    gpu: z.string().nullable().describe("Specific GPU model, e.g. 'RTX 4060'."),
    gpu_vram_min: z.number().nullable(),
    screen_size_min: z.number().nullable().describe("Inches."),
    screen_size_max: z.number().nullable().describe("Inches."),
    refresh_rate_min: z.number().nullable().describe("Hz."),
    is_new: z.boolean().nullable().describe("true = new/neuf only, false = used/occasion only, null if not stated."),
    touchscreen: z.boolean().nullable(),
    delivery_only: z.boolean().nullable(),
    show_sold: z.boolean().nullable().describe("true only if the user asks about sold listings."),
    upload_date: z.enum(["24h", "3d", "1w"]).nullable().describe("Only listings posted within this window."),
    sort_by: z.enum(["score", "price", "value"]).nullable().describe(
        "'price' for cheapest/most expensive, 'score' for most powerful/best specs, 'value' for best deal or value for money. null if no preference."
    ),
    sort_order: z.enum(["asc", "desc"]).nullable().describe("'asc' only for cheapest."),
    limit: z.number().nullable().describe("How many results the user asked for; 1 for a singular superlative like 'the cheapest'. null otherwise."),
    suggested_columns: z.array(z.string()).nullable().describe(`Table columns relevant to the request, from: ${DISPLAY_COLUMNS.join(", ")}.`),
});

// Words the model sometimes leaks into search_terms; they are filters or noise, not keywords
const NON_KEYWORDS = /^(touchscreen|tactile|new|neuf|used|occasion|laptops?|pcs?|ordinateurs?|portables?|cheap|affordable|budget|gaming|best|good)$/i;

const text = (value: unknown, maxLength: number): string | undefined => {
    if (typeof value !== "string") return undefined;
    // Letters, digits and a few separators are all a brand, model or city needs
    const cleaned = value.replace(/[^\p{L}\p{N}\s.+\-/]/gu, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
    return cleaned || undefined;
};

const number = (value: unknown, min: number, max: number): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? Math.min(value, max) : undefined;

const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);

const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | undefined =>
    options.includes(value as T) ? (value as T) : undefined;

const strings = (value: unknown, maxItems: number, maxLength: number): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const items = [...new Set(value.map((item) => text(item, maxLength)).filter((item): item is string => Boolean(item)))];
    return items.length ? items.slice(0, maxItems) : undefined;
};

/**
 * Turns untrusted input (model output, or filters echoed back by the browser)
 * into safe, bounded filters. Unknown keys are dropped, strings are stripped of
 * punctuation and truncated, numbers are clamped.
 */
export function cleanFilters(input: unknown): LaptopFilters {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const raw = input as Record<string, unknown>;

    const filters: LaptopFilters = {
        search_terms: strings(raw.search_terms, 5, 40)?.filter((term) => !NON_KEYWORDS.test(term)),
        city: text(raw.city, 40),
        price_min: number(raw.price_min, 1, 1_000_000),
        price_max: number(raw.price_max, 1, 1_000_000),
        ram_min: number(raw.ram_min, 1, 512),
        storage_min: number(raw.storage_min, 1, 16_000),
        gpu_type: oneOf(raw.gpu_type, ["Dedicated", "Integrated"] as const),
        gpu: text(raw.gpu, 40),
        gpu_vram_min: number(raw.gpu_vram_min, 1, 64),
        screen_size_min: number(raw.screen_size_min, 1, 30),
        screen_size_max: number(raw.screen_size_max, 1, 30),
        refresh_rate_min: number(raw.refresh_rate_min, 1, 1000),
        is_new: bool(raw.is_new),
        touchscreen: bool(raw.touchscreen),
        delivery_only: bool(raw.delivery_only),
        show_sold: bool(raw.show_sold),
        upload_date: oneOf(raw.upload_date, ["24h", "3d", "1w"] as const),
        sort_by: oneOf(raw.sort_by, ["score", "price", "value"] as const),
        sort_order: oneOf(raw.sort_order, ["asc", "desc"] as const),
        limit: number(raw.limit, 1, MAX_RESULTS),
        suggested_columns: strings(raw.suggested_columns, 8, 20)?.filter((column) => DISPLAY_COLUMNS.includes(column)),
    };
    if (filters.limit !== undefined) filters.limit = Math.round(filters.limit);
    if (!filters.search_terms?.length) filters.search_terms = undefined;
    if (!filters.suggested_columns?.length) filters.suggested_columns = undefined;

    // Drop undefined keys so the object serializes and merges cleanly
    return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)) as LaptopFilters;
}

/** A follow-up ("cheaper ones", "same but in Rabat") keeps the previous filters unless overridden. */
export function mergeFilters(previous: LaptopFilters, next: LaptopFilters): LaptopFilters {
    return { ...previous, ...next };
}
