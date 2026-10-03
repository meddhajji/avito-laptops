//1. TOOL: Call queryLaptops for every laptop, filter, ranking, or comparison request. Never answer superlatives (cheapest/best/most expensive) or specific filter queries from memory — always re-query the database.

import {
    convertToModelMessages,
    createUIMessageStream,
    createUIMessageStreamResponse,
    stepCountIs,
    streamText,
    tool,
    zodSchema,
} from "ai";
import type { UIMessage } from "ai";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";
import { db } from "@/lib/db";
import { LAPTOP_COLUMNS } from "@/lib/laptops";
import { Laptop } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optionalStringArray = () => z.array(z.string()).nullish();
const optionalNumber = () => z.number().nullish();
const optionalBoolean = () => z.union([z.boolean(), z.number(), z.string()]).nullish().transform(val => {
    if (val === null || val === undefined) return val;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val > 0;
    if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1';
    return Boolean(val);
}) as z.ZodType<boolean | null | undefined>;
const optionalSortBy = () => z.enum(["score", "price"]).nullish();
const optionalSortOrder = () => z.enum(["asc", "desc"]).nullish();
const optionalGpuType = () => z.enum(["Dedicated", "Integrated"]).nullish();

const laptopQuerySchema = z.object({
    search_terms: optionalStringArray().describe(
        "Brand/model/spec keywords. Examples: ['ThinkPad'], ['Dell', 'XPS'], ['RTX 4060'], ['i7 12th gen']. " +
        "NEVER put city, condition (new/used), touchscreen, price words, or sort intent here."
    ),
    city: z.string().nullish().describe("City to filter by. Extract from the user message. Example: 'Casablanca', 'Rabat', 'Marrakech'."),
    price_min: optionalNumber().describe("Min price in DH (e.g. user says 'above 3000 DH' → 3000). Must be > 0."),
    price_max: optionalNumber().describe("Max price in DH (e.g. user says 'under 5000' or 'budget 5000 DH' → 5000)."),
    ram_min: optionalNumber().describe("Min RAM in GB. E.g. '16GB RAM' → 16."),
    storage_min: optionalNumber().describe("Min storage in GB. E.g. '512GB SSD' → 512, '1TB' → 1000."),
    gpu_type: optionalGpuType().describe("'Dedicated' for gaming/workstation, 'Integrated' for office/light use. Omit if not mentioned."),
    gpu: z.string().nullish().describe("Specific GPU model substring, e.g. 'RTX 4060', 'GTX 1650'. Omit if not mentioned."),
    gpu_vram_min: optionalNumber().describe("Min GPU VRAM in GB."),
    screen_size_min: optionalNumber().describe("Min screen size in inches."),
    screen_size_max: optionalNumber().describe("Max screen size in inches."),
    refresh_rate_min: optionalNumber().describe("Min refresh rate in Hz. E.g. 'gaming monitor 144Hz' → 144."),
    is_new: optionalBoolean().describe("true = new/neuf listings only. false = used/occasion only. Omit if not specified."),
    touchscreen: optionalBoolean().describe("true = touchscreen only. Omit if not mentioned."),
    suggested_columns: optionalStringArray().describe("UI table columns to show. Pick relevant ones: cpu, gpu, gpu_type, city, ram, storage, screen_size, refresh_rate, price, score."),
    limit: optionalNumber().describe(
        "How many results to return. Parse from the user message: " +
        "'cheapest 3 ThinkPads' → 3, 'show me five laptops' → 5, 'top 10' → 10. " +
        "Singular superlatives (cheapest, most expensive, best laptop) without a count → 1. " +
        "No count mentioned → omit (server defaults to 10)."
    ),
    sort_by: optionalSortBy().describe(
        "How to sort results. Rules: " +
        "cheap / affordable / budget / cheapest / lowest price / pas cher / bon marché → sort_by='price', sort_order='asc'. " +
        "most expensive / priciest / highest price → sort_by='price', sort_order='desc'. " +
        "best / top / highest value / meilleur → sort_by='score', sort_order='desc'. " +
        "No sorting intent → omit."
    ),
    sort_order: optionalSortOrder().describe("asc for cheapest/lowest, desc for most expensive/best. Must accompany sort_by."),
    show_sold: optionalBoolean().describe("true = include items already sold. Default is false (only available items)."),
    delivery_only: optionalBoolean().describe("true = only show items where delivery is available."),
    upload_date: z.enum(["Any", "24h", "3d", "1w"]).nullish().describe("Filter by when the listing was uploaded."),
});

type LaptopToolInput = z.infer<typeof laptopQuerySchema>;
type LaptopQuery = {
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
    suggested_columns?: string[];
    limit?: number;
    sort_by?: "score" | "price";
    sort_order?: "asc" | "desc";
    show_sold?: boolean;
    delivery_only?: boolean;
    upload_date?: "Any" | "24h" | "3d" | "1w";
};

type MessagePartLike = {
    text?: string;
};

type ToolInvocationLike = {
    state?: string;
    result?: Record<string, unknown>;
};

type ChatMessageLike = {
    role: UIMessage["role"];
    content?: string | MessagePartLike[];
    parts: UIMessage["parts"];
    toolCalls?: unknown;
    toolInvocations?: ToolInvocationLike[];
} & UIMessage;

const getPartText = (part: unknown): string => {
    if (!part || typeof part !== "object" || !("text" in part)) return "";
    const text = (part as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
};

const hasFilters = (filters: unknown): filters is Partial<LaptopQuery> =>
    Boolean(filters && typeof filters === "object" && Object.keys(filters as Record<string, unknown>).length > 0);

const getMessageText = (message: ChatMessageLike | undefined): string => {
    if (!message) return "";
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
        return message.content.map(getPartText).join(" ");
    }
    if (Array.isArray(message.parts)) {
        return message.parts.map(getPartText).join(" ");
    }
    return "";
};

const laptopIntentPattern = /\b(laptops?|pcs?|ordinateurs?|macs?|macbooks?|thinkpads?|ideapads?|latitudes?|xps|inspirons?|elitebooks?|pavilions?|zenbooks?|vivobooks?|rog|tuf|legions?|apple|lenovo|dell|hp|asus|acer|msi|ram|ssd|hdd|storage|cpu|gpu|rtx|gtx|i[3579]|ryzen|dh|mad|budget|affordable|price|prix|cheap|cheapest|expensive|gaming|occasion|reconditionn[ée]s?)\b/i;
const laptopSubjectPattern = /\b(laptops?|pcs?|ordinateurs?|macs?|macbooks?|thinkpads?|ideapads?|latitudes?|xps|inspirons?|elitebooks?|pavilions?|zenbooks?|vivobooks?|rog|tuf|legions?|apple|lenovo|dell|hp|asus|acer|msi|rtx|gtx|i[3579]|ryzen|gaming)\b/i;
const followUpPattern = /\b(same|cheaper|cheapest|expensive|better|another|alternative|compare|only|with|without|under|below|above|more|less|in|city|near|new|used|those|these|that|them|it|use|tool|search|query)\b/i;
const contextualFollowUpPattern = /\b(one|ones|same|those|these|that|them|it|previous|above|last|result|results)\b/i;
const appleQueryPattern = /\b(apple|macs?|macbooks?)\b/i;

// Routing only — does this message warrant forcing the laptop tool?
const shouldQueryLaptops = (latestUserText: string, lastFilters: unknown) =>
    laptopIntentPattern.test(latestUserText) || (hasFilters(lastFilters) && followUpPattern.test(latestUserText));

// Routing only — should we inherit prior query filters?
const shouldInheritFilters = (latestUserText: string, lastFilters: unknown) =>
    hasFilters(lastFilters)
    && (contextualFollowUpPattern.test(latestUserText) || (!laptopSubjectPattern.test(latestUserText) && followUpPattern.test(latestUserText)));

// Thin normalization: data hygiene only — the LLM owns sort/limit decisions.
const normalizeLaptopQuery = (input: LaptopQuery, latestUserText: string): LaptopQuery => {
    const result: LaptopQuery = { ...input };

    // Safety net: if the LLM forgot to set boolean flags that are unambiguous in the text, set them.
    if (/\b(touchscreen|tactile|écran\s+tactile)\b/i.test(latestUserText) && result.touchscreen === undefined) {
        result.touchscreen = true;
    }
    // Only force is_new=true on unambiguous standalone words ("neuf", "جديد") to avoid false positives
    // ("new" alone is too ambiguous in follow-up messages like "show me new results")
    if (/\b(neuf|جديد)\b/i.test(latestUserText) && result.is_new === undefined) {
        result.is_new = true;
    }

    // Strip non-search words that sometimes leak into search_terms
    if (result.search_terms?.length) {
        result.search_terms = result.search_terms.filter(
            (t) => !/^(touchscreen|tactile|new|neuf|جديد|laptops?|pcs?|ordinateurs?|cheap|affordable|budget|gaming|occasion)$/i.test(t)
        );
        if (!result.search_terms.length) result.search_terms = undefined;
    }

    // Enforce bounds — the LLM sets the value, we just clamp it
    if (result.limit !== undefined) {
        result.limit = Math.min(Math.max(Math.round(result.limit), 1), 20);
    }

    return result;
};

const normalizeSearchTerms = (terms: string[] | undefined): string[] | undefined => {
    if (!terms?.length) return terms;
    const normalized = terms.map((term) => {
        const lower = term.trim().toLowerCase();
        if (["mac", "macs", "macbook", "macbooks"].includes(lower)) return "Apple";
        return term;
    });
    return [...new Set(normalized.filter(Boolean))];
};

const sanitizeLaptopInput = (input: LaptopToolInput): LaptopQuery => ({
    search_terms: input.search_terms ?? undefined,
    city: input.city ?? undefined,
    price_min: input.price_min ?? undefined,
    price_max: input.price_max ?? undefined,
    ram_min: input.ram_min ?? undefined,
    storage_min: input.storage_min ?? undefined,
    gpu_type: input.gpu_type ?? undefined,
    gpu: input.gpu ?? undefined,
    gpu_vram_min: input.gpu_vram_min ?? undefined,
    screen_size_min: input.screen_size_min ?? undefined,
    screen_size_max: input.screen_size_max ?? undefined,
    refresh_rate_min: input.refresh_rate_min ?? undefined,
    is_new: input.is_new ?? undefined,
    touchscreen: input.touchscreen ?? undefined,
    suggested_columns: input.suggested_columns ?? undefined,
    limit: input.limit ?? undefined,
    sort_by: input.sort_by ?? undefined,
    sort_order: input.sort_order ?? undefined,
    show_sold: input.show_sold ?? undefined,
    delivery_only: input.delivery_only ?? undefined,
    upload_date: input.upload_date ?? undefined,
});

const mergeInheritedFilters = (input: LaptopQuery, inheritedFilters: Partial<LaptopQuery>): LaptopQuery => ({
    search_terms: input.search_terms ?? inheritedFilters.search_terms,
    city: input.city ?? inheritedFilters.city,
    price_min: input.price_min ?? inheritedFilters.price_min,
    price_max: input.price_max ?? inheritedFilters.price_max,
    ram_min: input.ram_min ?? inheritedFilters.ram_min,
    storage_min: input.storage_min ?? inheritedFilters.storage_min,
    gpu_type: input.gpu_type ?? inheritedFilters.gpu_type,
    gpu: input.gpu ?? inheritedFilters.gpu,
    gpu_vram_min: input.gpu_vram_min ?? inheritedFilters.gpu_vram_min,
    screen_size_min: input.screen_size_min ?? inheritedFilters.screen_size_min,
    screen_size_max: input.screen_size_max ?? inheritedFilters.screen_size_max,
    refresh_rate_min: input.refresh_rate_min ?? inheritedFilters.refresh_rate_min,
    is_new: input.is_new ?? inheritedFilters.is_new,
    touchscreen: input.touchscreen ?? inheritedFilters.touchscreen,
    suggested_columns: input.suggested_columns ?? inheritedFilters.suggested_columns,
    limit: input.limit ?? inheritedFilters.limit,
    sort_by: input.sort_by ?? inheritedFilters.sort_by,
    sort_order: input.sort_order ?? inheritedFilters.sort_order,
    show_sold: input.show_sold ?? inheritedFilters.show_sold,
    delivery_only: input.delivery_only ?? inheritedFilters.delivery_only,
    upload_date: input.upload_date ?? inheritedFilters.upload_date,
});

const formatPrice = (price: number | null) =>
    price && price > 0 ? `${price.toLocaleString("en-US")} DH` : "price not listed";

const formatStorage = (storage: number | null) => {
    if (!storage) return null;
    if (storage >= 1000) return `${storage / 1000}TB storage`;
    return `${storage}GB storage`;
};

const formatLaptopForAI = (laptop: Laptop) => {
    const model = [laptop.brand, laptop.model].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const specs = [
        laptop.cpu,
        laptop.ram ? `${laptop.ram}GB RAM` : null,
        formatStorage(laptop.storage),
        laptop.gpu_type && laptop.gpu_type !== "Integrated" ? laptop.gpu_type : null,
    ].filter(Boolean);

    return {
        model,
        specs: specs.join(", "),
        price: laptop.price,
        formatted_price: formatPrice(laptop.price),
        city: laptop.city,
        score: laptop.score,
        answer_line: `${model || "Unknown laptop"} at ${formatPrice(laptop.price)}${laptop.city ? ` in ${laptop.city}` : ""}${specs.length ? ` (${specs.join(", ")})` : ""}.`,
    };
};

const toSafeTsQueryTokens = (term: string) =>
    term
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

const toTsQuery = (terms: string[]) => {
    const mapping: Record<string, string[]> = {
        apple: ["apple", "macbook"],
        mac: ["apple", "macbook"],
        macs: ["apple", "macbook"],
        macbook: ["apple", "macbook"],
        macbooks: ["apple", "macbook"],
        lenovo: ["lenovo", "thinkpad", "ideapad", "legion", "yoga"],
        dell: ["dell", "latitude", "xps", "inspiron", "precision", "alienware"],
        hp: ["hp", "elitebook", "pavilion", "envy", "zbook", "omen"],
        asus: ["asus", "zenbook", "vivobook", "rog", "tuf"],
    };

    const parts = terms.flatMap((term) => {
        const normalizedTerm = term.toLowerCase().trim();
        const expanded = mapping[normalizedTerm];
        if (expanded) return [`(${expanded.join(" | ")})`];

        return toSafeTsQueryTokens(term).map((token) => `${token.toLowerCase()}:*`);
    });

    return parts.length > 0 ? parts.join(" & ") : null;
};

export async function POST(req: Request) {
    try {
        const { messages = [], lastFilters } = await req.json() as { messages?: ChatMessageLike[]; lastFilters?: unknown };
        const latestUserMessage = messages.findLast((m) => m.role === "user");
        const latestUserText = getMessageText(latestUserMessage);
        const inheritedFilters = shouldInheritFilters(latestUserText, lastFilters) ? lastFilters as Partial<LaptopQuery> : {};
        const forceLaptopTool = shouldQueryLaptops(latestUserText, lastFilters);

        const systemPrompt = `You are AvitoPT, a sharp market analyst for Moroccan Avito.ma laptop listings. Answer in one concise paragraph (≤400 chars). A data table is shown to the user automatically after your reply.

TOOL RULES (queryLaptops):
1. Call queryLaptops for every laptop/PC question. Skip only for pure greetings or off-topic.
2. PARAMETERS — parse carefully from the user's exact words:
   • city → city param (never into search_terms). E.g. "in Casablanca" → city="Casablanca".
   • Brand/model → search_terms. E.g. "ThinkPad" → ["ThinkPad"], "Dell XPS" → ["Dell","XPS"].
   • Count → limit. "cheapest 3 ThinkPads" → limit=3. "five laptops" → limit=5. "the cheapest" (no count) → limit=1.
   • Sorting → sort_by + sort_order:
       ONLY if user says cheap / affordable / budget / cheapest / lowest price / pas cher → sort_by="price", sort_order="asc"
       ONLY if user says most expensive / priciest / highest price / le plus cher → sort_by="price", sort_order="desc"
       ONLY if user says best / top / highest value / meilleur → sort_by="score", sort_order="desc"
       IF NO SORTING INTENT IS MENTIONED → omit sort_by entirely (server defaults to value/score). NEVER guess sorting.
   • Condition → is_new: "new/neuf" → true, "used/occasion" → false. Omit if not stated.
   • Price range → price_min / price_max in DH.
3. RESPONSE — two modes:
   • shown_in_table = 1: ONE direct sentence naming the result + key specs/price. No filler.
     Example: "The cheapest ThinkPad in Casablanca is the T14 at 4,200 DH — Ryzen 5, 8GB RAM."
   • shown_in_table > 1: 1–2 sentences. "Here are {shown_in_table} of {total} found..." + one market insight.
     Never enumerate listings (the table does that). No markdown tables. No "0 DH".
4. FOLLOW-UPS: Preserve prior brand/city filters when the user says "same", "those", "them", etc.${hasFilters(inheritedFilters) ? `\nCONTEXT: Follow-up — preserve these unless overridden: ${JSON.stringify(inheritedFilters)}` : ""}
`.trim();

        const historyWindow = 8;
        const finalMessages = messages.slice(-historyWindow);

        while (finalMessages.length > 0 && finalMessages[0].role === "assistant" && finalMessages[0].toolCalls) {
            finalMessages.shift();
        }
        while (finalMessages.length > 0 && finalMessages[0].role !== "user") {
            finalMessages.shift();
        }

        const modelMessagesToStream = await convertToModelMessages(finalMessages || []);
        const requestStartTime = performance.now();
        const models = ["openai/gpt-oss-120b", "qwen/qwen3-32b", "llama-3.3-70b-versatile"];

        const uiStream = createUIMessageStream({
            execute: async ({ writer }) => {
                let lastError: unknown;
                for (const modelId of models) {
                    try {
                        console.log("\n" + "=".repeat(80));
                        console.log(`[LLM REQUEST] Model: ${modelId}`);
                        console.log(`[Chat] messages=${modelMessagesToStream.length} forceLaptopTool=${forceLaptopTool} inheritFilters=${hasFilters(inheritedFilters)}`);
                        console.log("=".repeat(80) + "\n");

                        const result = streamText({
                            model: groq(modelId),
                            system: systemPrompt,
                            messages: modelMessagesToStream,
                            stopWhen: stepCountIs(3),
                            toolChoice: "auto",
                            prepareStep({ stepNumber }) {
                                if (stepNumber === 0 && forceLaptopTool) {
                                    return {
                                        activeTools: ["queryLaptops"],
                                        toolChoice: "auto",
                                    };
                                }

                            },
                            onError({ error }) {
                                console.error("[AVITOPT STREAM] Stream error:", error);
                            },
                            onStepFinish({ text, toolCalls, toolResults, finishReason, usage }) {
                                const stepTime = ((performance.now() - requestStartTime) / 1000).toFixed(2);
                                console.log(`\n[Step Finish @ ${stepTime}s] Model: ${modelId}`);
                                console.log(`- Finish Reason: ${finishReason}`);
                                console.log(`- Tokens: In ${usage.inputTokens}, Out ${usage.outputTokens} (Total: ${usage.totalTokens})`);

                                if (toolCalls.length > 0) {
                                    console.log("- Tool Calls:", JSON.stringify(toolCalls, null, 2));
                                }
                                if (toolResults.length > 0) {
                                    console.log("- Tool Results:", JSON.stringify(toolResults, null, 2));
                                }
                                if (text) {
                                    console.log("- Text Content:", text.length > 200 ? text.substring(0, 200) + "..." : text);
                                }
                            },
                            onFinish({ finishReason, usage }) {
                                const totalTime = ((performance.now() - requestStartTime) / 1000).toFixed(2);
                                console.log("\n" + "=".repeat(80));
                                console.log(`[STREAM COMPLETE @ ${totalTime}s]`);
                                console.log(`- Final Reason: ${finishReason}`);
                                console.log(`- Total Tokens: ${usage.totalTokens} (${usage.inputTokens} in / ${usage.outputTokens} out)`);
                                console.log("=".repeat(80) + "\n");
                            },
                            tools: {
                                queryLaptops: tool({
                                    description: "Execute a filtered search against the Avito PostgreSQL laptop database.",
                                    inputSchema: zodSchema(laptopQuerySchema),
                                    execute: async (input) => {
                                        const cleanInput = sanitizeLaptopInput(input);
                                        const mergedInput = mergeInheritedFilters(cleanInput, inheritedFilters);
                                        const subjectStableInput = hasFilters(inheritedFilters) && !laptopSubjectPattern.test(latestUserText)
                                            ? {
                                                ...mergedInput,
                                                search_terms: inheritedFilters.search_terms ?? mergedInput.search_terms,
                                            }
                                            : mergedInput;
                                        const effectiveInput = normalizeLaptopQuery({
                                            ...subjectStableInput,
                                            search_terms: normalizeSearchTerms(subjectStableInput.search_terms),
                                        }, latestUserText);
                                        console.log("[AVITOPT TOOL] queryLaptops args:", JSON.stringify(effectiveInput));

                                        const resultLimit = Math.min(Math.max(effectiveInput.limit ?? 10, 1), 20);
                                        const conditions: string[] = ["duplicate_of IS NULL"];
                                        if (!effectiveInput.show_sold) {
                                            conditions.push("is_sold = false");
                                        }
                                        const params: Array<string | number | boolean> = [];
                                        const p = () => `$${params.length + 1}`;
                                        const searchTerms = effectiveInput.search_terms ?? [];
                                        const isAppleQuery = searchTerms.some((term) => appleQueryPattern.test(term));

                                        if (effectiveInput.city) {
                                            const cityWords = effectiveInput.city.trim().split(/\s+/).filter(Boolean);
                                            cityWords.forEach(word => {
                                                conditions.push(`city ILIKE ${p()}`);
                                                params.push(`%${word}%`);
                                            });
                                        }
                                        if (effectiveInput.price_max) {
                                            conditions.push(`price <= ${p()} AND price > 0`);
                                            params.push(effectiveInput.price_max);
                                        }
                                        if (effectiveInput.price_min) {
                                            conditions.push(`price >= ${p()}`);
                                            params.push(effectiveInput.price_min);
                                        }
                                        if (effectiveInput.ram_min) {
                                            conditions.push(`ram >= ${p()}`);
                                            params.push(effectiveInput.ram_min);
                                        }
                                        if (effectiveInput.storage_min) {
                                            conditions.push(`storage >= ${p()}`);
                                            params.push(effectiveInput.storage_min);
                                        }
                                        if (effectiveInput.gpu_type) {
                                            conditions.push(`gpu_type = ${p()}`);
                                            params.push(effectiveInput.gpu_type);
                                        }
                                        if (effectiveInput.gpu) {
                                            const gpuWords = effectiveInput.gpu.trim().split(/\s+/).filter(Boolean);
                                            gpuWords.forEach(word => {
                                                conditions.push(`gpu ILIKE ${p()}`);
                                                params.push(`%${word}%`);
                                            });
                                        }
                                        if (effectiveInput.gpu_vram_min) {
                                            conditions.push(`gpu_vram >= ${p()}`);
                                            params.push(effectiveInput.gpu_vram_min);
                                        }
                                        if (effectiveInput.screen_size_min) {
                                            conditions.push(`screen_size >= ${p()}`);
                                            params.push(effectiveInput.screen_size_min);
                                        }
                                        if (effectiveInput.screen_size_max) {
                                            conditions.push(`screen_size <= ${p()}`);
                                            params.push(effectiveInput.screen_size_max);
                                        }
                                        if (effectiveInput.refresh_rate_min) {
                                            conditions.push(`refresh_rate >= ${p()}`);
                                            params.push(effectiveInput.refresh_rate_min);
                                        }
                                        if (effectiveInput.is_new !== undefined && effectiveInput.is_new !== null) {
                                            conditions.push(`new = ${p()}`);
                                            params.push(effectiveInput.is_new ? 1.0 : 0.0);
                                        }
                                        if (effectiveInput.touchscreen !== undefined && effectiveInput.touchscreen !== null) {
                                            conditions.push(`touchscreen = ${p()}`);
                                            params.push(effectiveInput.touchscreen ? 1.0 : 0.0);
                                        }
                                        if (effectiveInput.delivery_only) {
                                            conditions.push(`has_delivery = true`);
                                        }
                                        if (effectiveInput.upload_date && effectiveInput.upload_date !== "Any") {
                                            const now = new Date();
                                            let threshold: Date | null = null;
                                            if (effectiveInput.upload_date === "24h") threshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                                            else if (effectiveInput.upload_date === "3d") threshold = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
                                            else if (effectiveInput.upload_date === "1w") threshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                                            
                                            if (threshold) {
                                                conditions.push(`coalesce(listed_at, created_at) >= ${p()}`);
                                                params.push(threshold.toISOString());
                                            }
                                        }

                                        if (isAppleQuery) {
                                            const brandParam = p();
                                            params.push("%apple%");
                                            const modelParam = p();
                                            params.push("%macbook%");
                                            conditions.push(`(brand ILIKE ${brandParam} OR model ILIKE ${modelParam})`);
                                        }

                                        if (searchTerms.length > 0) {
                                            searchTerms.forEach(term => {
                                                const termParam = p();
                                                params.push(`%${term}%`);
                                                conditions.push(`(brand ILIKE ${termParam} OR model ILIKE ${termParam} OR cpu ILIKE ${termParam} OR gpu ILIKE ${termParam} OR city ILIKE ${termParam} OR description ILIKE ${termParam})`);
                                            });
                                        }

                                        let orderClause = "ORDER BY score DESC NULLS LAST, value DESC NULLS LAST";
                                        if (effectiveInput.sort_by === "price") {
                                            if (effectiveInput.sort_order === "asc") {
                                                conditions.push("price > 0");
                                                // Secondary sort by value DESC: among same-price ties, show better-value ones first
                                                orderClause = "ORDER BY price ASC NULLS LAST, value DESC NULLS LAST";
                                            } else {
                                                orderClause = "ORDER BY price DESC NULLS LAST";
                                            }
                                        }

                                        const whereClause = conditions.join(" AND ");
                                        const resultsSQL = `
                                            SELECT ${LAPTOP_COLUMNS}
                                            FROM laptops
                                            WHERE ${whereClause}
                                            ${orderClause}
                                            LIMIT ${resultLimit}
                                        `;

                                        const statsSQL = `
                                            WITH filtered_laptops AS (
                                                SELECT price, city
                                                FROM laptops
                                                WHERE ${whereClause}
                                            )
                                            SELECT
                                                count(*) as total_count,
                                                MIN(price) FILTER (WHERE price > 0) as price_min,
                                                MAX(price) FILTER (WHERE price > 0) as price_max,
                                                (
                                                    SELECT city FROM filtered_laptops
                                                    GROUP BY city ORDER BY count(*) DESC LIMIT 1
                                                ) as top_city
                                            FROM filtered_laptops
                                        `;

                                        const sql = db();
                                        const [rows, statsRows] = await Promise.all([
                                            sql.unsafe(resultsSQL, params),
                                            sql.unsafe(statsSQL, params),
                                        ]);

                                        const stats = statsRows[0] || {};
                                        const total = Number(stats.total_count) || 0;
                                        const resultsForUI = rows as unknown as Laptop[];

                                        const priceMin = Number(stats.price_min) || 0;
                                        const priceMax = Number(stats.price_max) || 0;
                                        let priceRange: string | null = null;
                                        if (priceMin > 0 && priceMax > 0) priceRange = `${priceMin.toLocaleString("fr-MA")} - ${priceMax.toLocaleString("fr-MA")} DH`;
                                        else if (priceMax > 0) priceRange = `up to ${priceMax.toLocaleString("fr-MA")} DH`;

                                        const resultsForLLM = resultsForUI.slice(0, 5).map(formatLaptopForAI);

                                        writer.write({
                                            type: "data-laptops",
                                            id: `laptops-${Date.now()}`,
                                            data: resultsForUI,
                                        });

                                        return {
                                            user_query: latestUserText || "No query found",
                                            effective_filters: effectiveInput,
                                            stats: {
                                                total,
                                                price_range: priceRange,
                                                top_city: stats.top_city ?? null,
                                                shown_in_table: resultsForUI.length,
                                            },
                                            summary_for_ai: resultsForLLM,
                                            _note: "Full search results have been side-channeled to the UI. Answer using these stats and examples.",
                                        };
                                    },
                                }),
                            },
                        });

                        writer.merge(result.toUIMessageStream());
                        return;
                    } catch (error: unknown) {
                        lastError = error;
                        const errorMsg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
                        console.warn(`[AVITOPT STREAM] Error on ${modelId}:`, errorMsg);
                        if (modelId !== models[models.length - 1]) {
                            console.warn(`[AVITOPT STREAM] Falling back from ${modelId}...`);
                            continue;
                        }
                        throw error;
                    }
                }
                throw lastError;
            },
            onError(error) {
                console.error("[AVITOPT UI STREAM] Fatal stream error:", error);
                return "The chat stream failed. Please retry.";
            },
        });

        return createUIMessageStreamResponse({ stream: uiStream });
    } catch (error: unknown) {
        console.error("[AVITOPT API] Fatal error:", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        return new Response(JSON.stringify({ error: message }), { status: 500 });
    }
}