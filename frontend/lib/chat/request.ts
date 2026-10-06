import { cleanFilters, type LaptopFilters } from "./filters";

export const MAX_BODY_BYTES = 8_000;
export const MAX_QUESTION_CHARS = 600;
const MAX_PREVIOUS_QUESTIONS = 3;
const MAX_PREVIOUS_CHARS = 200;

export type ChatRequest = {
    question: string;
    previousQuestions: string[];
    lastFilters: LaptopFilters;
};

export type ParseResult = { ok: true; request: ChatRequest } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): ParseResult => ({ ok: false, status, error });

/**
 * Validates the raw request body. The browser sends only the new question, the
 * last few questions and the filters of the previous search: never a full
 * transcript, so a client cannot inject fake assistant or tool messages.
 */
export function parseChatRequest(rawBody: string): ParseResult {
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) return fail(413, "Request too large.");

    let body: unknown;
    try {
        body = JSON.parse(rawBody);
    } catch {
        return fail(400, "Invalid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Invalid request.");
    const { question, previousQuestions, lastFilters } = body as Record<string, unknown>;

    if (typeof question !== "string" || !question.trim()) return fail(400, "Ask a question first.");
    if (question.length > MAX_QUESTION_CHARS) return fail(400, `Keep your question under ${MAX_QUESTION_CHARS} characters.`);

    const previous = Array.isArray(previousQuestions)
        ? previousQuestions
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .slice(-MAX_PREVIOUS_QUESTIONS)
            .map((item) => item.trim().slice(0, MAX_PREVIOUS_CHARS))
        : [];

    return {
        ok: true,
        request: { question: question.trim(), previousQuestions: previous, lastFilters: cleanFilters(lastFilters) },
    };
}
