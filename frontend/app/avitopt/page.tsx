"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowDown, ArrowUp, Loader2, StopCircle } from "lucide-react";
import { LaptopTable } from "@/components/avito/LaptopTable";
import { ALL_COLUMNS } from "@/components/avito/Columns";
import type { Laptop } from "@/lib/types";
import { cn } from "@/lib/utils";

type LaptopFilters = {
  search_terms?: string[];
  city?: string;
  price_min?: number;
  price_max?: number;
  ram_min?: number;
  storage_min?: number;
  gpu_type?: string;
  gpu?: string;
  gpu_vram_min?: number;
  screen_size_min?: number;
  screen_size_max?: number;
  refresh_rate_min?: number;
  is_new?: boolean;
  touchscreen?: boolean;
  suggested_columns?: string[];
  limit?: number;
  sort_by?: "score" | "price" | "value";
  sort_order?: "asc" | "desc";
};

type SearchStats = {
  total?: number;
  price_range?: string | null;
  top_city?: string | null;
  shown_in_table?: number;
};

/** Sent by the server with every search: the filters it applied and what it found. */
type SearchData = { filters: LaptopFilters; stats: SearchStats };

type MessagePart = {
  type?: string;
  text?: string;
  id?: string;
  data?: unknown;
};

type ChatMessage = UIMessage & {
  parts?: MessagePart[];
};

const CORE_COLS = new Set(["score", "brand", "model", "price", "link"]);
const DEFAULT_VISIBLE = new Set(ALL_COLUMNS.filter((column) => column.defaultOn).map((column) => column.key));
const LANE_CLASS = "mx-auto w-full max-w-[900px] px-4 sm:px-6";
const CONTENT_LANE_CLASS = "mx-auto w-full max-w-[900px] pl-5 pr-3 sm:pl-7 sm:pr-5";

// The server gets the new question, the last few questions and the previous
// search's filters: not the transcript, which it would have no reason to trust.
const transport = new DefaultChatTransport({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ body }) => ({ body: body ?? {} }),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const getSearchPart = (message: ChatMessage): MessagePart | null =>
  message.parts?.find((part) => part.type === "data-search") ?? null;

const getSearchData = (part: MessagePart | null): SearchData | null => {
  if (!part || !isRecord(part.data) || !isRecord(part.data.filters)) return null;
  return { filters: part.data.filters as LaptopFilters, stats: isRecord(part.data.stats) ? (part.data.stats as SearchStats) : {} };
};

const getLaptops = (message: ChatMessage): Laptop[] => {
  const part: MessagePart | undefined = message.parts?.find((candidate) => candidate.type === "data-laptops");
  return Array.isArray(part?.data) ? (part.data as Laptop[]) : [];
};

const getSmartColumns = (filters: LaptopFilters | null | undefined): Set<string> => {
  const visible = new Set(DEFAULT_VISIBLE);
  filters?.suggested_columns?.forEach((column) => {
    if (ALL_COLUMNS.some((definition) => definition.key === column)) {
      visible.add(column);
    }
  });
  return visible;
};

const getTextContent = (message: ChatMessage): string =>
  message.parts?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "";

const formatFilters = (filters: LaptopFilters | null, resultCount: number) => {
  if (!filters) return resultCount > 0 ? "Best matches" : "No active filters";

  const chunks: string[] = [];
  if (filters.search_terms?.length) chunks.push(filters.search_terms.slice(0, 3).join(", "));
  if (filters.city) chunks.push(`in ${filters.city}`);
  if (filters.price_max) chunks.push(`under ${filters.price_max.toLocaleString("en-US")} DH`);
  if (filters.price_min) chunks.push(`from ${filters.price_min.toLocaleString("en-US")} DH`);
  if (filters.ram_min) chunks.push(`${filters.ram_min}GB+ RAM`);
  if (filters.storage_min) chunks.push(`${filters.storage_min}GB+ storage`);
  if (filters.gpu_type) chunks.push(`${filters.gpu_type} GPU`);
  if (filters.refresh_rate_min) chunks.push(`${filters.refresh_rate_min}Hz+`);
  if (filters.is_new === true) chunks.push("new only");
  if (filters.is_new === false) chunks.push("used only");
  if (filters.touchscreen === true) chunks.push("touchscreen");
  if (filters.sort_by === "price") chunks.push(filters.sort_order === "desc" ? "highest price first" : "cheapest first");
  if (filters.sort_by === "value") chunks.push("best value first");

  return chunks.length > 0 ? chunks.join(" · ") : "Best matches";
};

function ChatInput({
  value,
  isLoading,
  onChange,
  onSubmit,
  onStop,
}: {
  value: string;
  isLoading: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = value.trim().length > 0 && !isLoading;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [value]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (canSubmit) onSubmit();
  };

  return (
    <form onSubmit={submit} className="relative">
      <div className="liquid-glass flex items-end gap-2 rounded-2xl bg-white/[0.045] p-2 shadow-[0_20px_70px_rgba(0,0,0,0.55)] transition-colors focus-within:border-white/20 focus-within:bg-white/[0.065]">
        <textarea
          ref={textareaRef}
          rows={1}
          maxLength={600}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
          placeholder="Ask AvitoPT"
          className="min-h-11 flex-1 resize-none bg-transparent px-3 py-3 text-[15px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/45"
        />
        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generation"
            className="mb-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-foreground transition hover:bg-white/15"
          >
            <StopCircle className="size-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSubmit}
            aria-label="Send message"
            className={cn(
              "mb-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl transition",
              canSubmit
                ? "bg-foreground text-background shadow-lg shadow-white/10 hover:scale-[1.03] active:scale-95"
                : "cursor-not-allowed border border-white/10 bg-white/5 text-muted-foreground/35"
            )}
          >
            <ArrowUp className="size-4" strokeWidth={2.6} />
          </button>
        )}
      </div>
    </form>
  );
}

function LoadingLine({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(CONTENT_LANE_CLASS, "flex items-center gap-3 py-2 text-[13px] font-medium text-muted-foreground/70 animate-in fade-in duration-200")}>
      <Loader2 className="size-3.5 animate-spin text-muted-foreground/50" />
      <span>{children}</span>
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div className={cn(CONTENT_LANE_CLASS, "py-2 animate-in fade-in duration-200")}>
      <div className="rounded-xl border border-red-400/15 bg-red-500/8 px-4 py-3 text-[13px] font-medium text-red-200">
        {message}
      </div>
    </div>
  );
}

type StreamPhase = "idle" | "reading" | "preparing";

const PHASE_LABELS: Record<Exclude<StreamPhase, "idle">, string> = {
  reading: "Searching the market...",
  preparing: "Preparing answer...",
};

/** Pure function: derives the current loading phase from SDK status + last message parts. */
const getStreamPhase = (status: string, messages: ChatMessage[]): StreamPhase => {
  if (status !== "submitted" && status !== "streaming") return "idle";
  const lastMsg = messages[messages.length - 1];
  // Still waiting for the assistant's first chunk
  if (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.parts?.length) return "reading";
  // Text has started streaming: no indicator needed
  if (getTextContent(lastMsg).length > 0) return "idle";
  // Results are on screen, the written summary is on its way
  return getSearchPart(lastMsg) ? "preparing" : "reading";
};

function StreamingIndicator({ phase }: { phase: StreamPhase }) {
  if (phase === "idle") return null;
  return <LoadingLine>{PHASE_LABELS[phase]}</LoadingLine>;
}

const NOOP = () => { };

const ResultPanel = React.memo(function ResultPanel({
  laptops,
  filters,
  stats,
  visibleCols,
  toggleCol,
}: {
  laptops: Laptop[];
  filters: LaptopFilters | null;
  stats: SearchStats | null;
  visibleCols: Set<string>;
  toggleCol: (key: string) => void;
}) {
  const total = stats?.total ?? laptops.length;
  const shown = laptops.length;

  return (
    <div className={cn(CONTENT_LANE_CLASS, "animate-in fade-in slide-in-from-bottom-3 duration-500")}>
      <div className="rounded-2xl border border-white/10 bg-white/[0.045] shadow-[0_20px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl">
        <div className="flex flex-col gap-2 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">
              Showing {shown}/{total} {total === 1 ? "match" : "matches"}
            </div>
            <div className="mt-1 truncate text-[13px] text-muted-foreground">
              {formatFilters(filters, laptops.length)}
            </div>
          </div>
        </div>
        <LaptopTable
          laptops={laptops}
          visibleCols={visibleCols}
          toggleCol={toggleCol}
          sortBy={filters?.sort_by ?? "score"}
          sortOrder={filters?.sort_order ?? "desc"}
          isLocked
          density="compact"
          maxHeightClassName="max-h-[52vh]"
          containerClassName="rounded-none border-0 bg-transparent"
          onSortChange={NOOP}
        />
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.laptops === next.laptops &&
    prev.visibleCols === next.visibleCols &&
    prev.toggleCol === next.toggleCol &&
    prev.stats?.total === next.stats?.total;
});

const MessageItem = React.memo(function MessageItem({
  message,
  visibleCols,
  toggleCol,
}: {
  message: ChatMessage;
  visibleCols: Set<string>;
  toggleCol: (key: string) => void;
}) {
  const text = getTextContent(message);

  if (message.role === "user") {
    return (
      <div className={cn(CONTENT_LANE_CLASS, "flex justify-end")}>
        <div className="max-w-[88%] rounded-2xl border border-white/10 bg-white/[0.075] px-4 py-3 text-[15px] leading-6 text-foreground shadow-lg backdrop-blur-xl sm:max-w-[70%]">
          <p className="whitespace-pre-wrap break-words">{text}</p>
        </div>
      </div>
    );
  }

  if (message.role !== "assistant" || !message.parts?.length) return null;

  const search = getSearchData(getSearchPart(message));
  const laptops = getLaptops(message);
  const filters = search?.filters ?? null;
  const stats = search?.stats ?? null;

  const hasText = text.length > 0;
  const showTable = Boolean(search) && laptops.length > 0;

  return (
    <div className="w-full space-y-4">

      {/* Table first: locks layout before text streams in, prevents end-of-stream jump */}
      {showTable && (
        <ResultPanel laptops={laptops} filters={filters} stats={stats} visibleCols={visibleCols} toggleCol={toggleCol} />
      )}

      {hasText && (
        <div className={cn(CONTENT_LANE_CLASS, "animate-in fade-in duration-200")}>
          <div className="prose prose-invert max-w-none text-[15px] leading-7 text-foreground/88 prose-p:my-2 prose-strong:text-foreground prose-a:text-blue-300 prose-ul:my-2 prose-li:my-0">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  return prev.message === next.message &&
    prev.visibleCols === next.visibleCols &&
    prev.toggleCol === next.toggleCol;
});

function loadSavedMessages(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = sessionStorage.getItem("avitopt_messages");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export default function AvitoPTPage() {
  const [inputValue, setInputValue] = useState("");
  const [visibleCols, setVisibleCols] = useState<Set<string>>(DEFAULT_VISIBLE);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [lastSubmittedId, setLastSubmittedId] = useState<string | null>(null);
  const activeFiltersRef = useRef<LaptopFilters>({});
  const viewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSearchIdRef = useRef<string | null>(null);

  const { messages, sendMessage, status, error, stop, setMessages } = useChat({ transport });

  useEffect(() => {
    const saved = loadSavedMessages();
    if (saved.length > 0) {
      setMessages(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    if (messages.length > 0) {
      sessionStorage.setItem("avitopt_messages", JSON.stringify(messages));
    } else {
      sessionStorage.removeItem("avitopt_messages");
    }
  }, [messages]);

  const typedMessages = messages as ChatMessage[];
  const isLoading = status === "submitted" || status === "streaming";
  const hasMessages = typedMessages.length > 0;
  const streamPhase = getStreamPhase(status, typedMessages);

  const toggleCol = useCallback((key: string) => {
    setVisibleCols((previous) => {
      if (previous.has(key) && CORE_COLS.has(key)) return previous;
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    }
    setIsNearBottom(true);
  }, []);

  // Scroll to bottom only on new user messages and when stream fully settles , 
  // NOT on every streaming tick, to avoid fighting native scroll anchoring mid-stream.
  const messageCountRef = useRef(0);
  useEffect(() => {
    const newCount = typedMessages.length;
    const countChanged = newCount !== messageCountRef.current;
    messageCountRef.current = newCount;

    if (!isNearBottom) return;
    // Fire on new message arrival or when stream ends (not on every streaming tick)
    if (countChanged || status === "ready" || status === "error") {
      const frame = window.requestAnimationFrame(() => scrollToLatest("smooth"));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [isNearBottom, scrollToLatest, status, typedMessages.length]);

  // Keep the columns and the follow-up context in sync with the latest search
  useEffect(() => {
    for (let index = typedMessages.length - 1; index >= 0; index -= 1) {
      const part = getSearchPart(typedMessages[index]);
      const search = getSearchData(part);
      if (!part || !search) continue;

      const searchId = part.id ?? typedMessages[index].id;
      if (searchId === lastSearchIdRef.current) return;
      lastSearchIdRef.current = searchId;
      activeFiltersRef.current = search.filters;

      const timer = window.setTimeout(() => setVisibleCols(getSmartColumns(search.filters)), 0);
      return () => window.clearTimeout(timer);
    }
  }, [typedMessages]);

  const resetChat = useCallback(() => {
    stop();
    setMessages([]);
    setInputValue("");
    setVisibleCols(new Set(DEFAULT_VISIBLE));
    setLastSubmittedId(null);
    activeFiltersRef.current = {};
    lastSearchIdRef.current = null;
    setIsNearBottom(true);
  }, [setMessages, stop]);

  const submitMessage = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    const submittedId = `submitted-${Date.now()}`;
    setLastSubmittedId(submittedId);
    setInputValue("");
    setIsNearBottom(true);

    const previousQuestions = typedMessages
      .filter((message) => message.role === "user")
      .map(getTextContent)
      .slice(-3);

    await sendMessage(
      { text },
      { body: { question: text, previousQuestions, lastFilters: activeFiltersRef.current } },
    );
  }, [inputValue, isLoading, sendMessage, typedMessages]);

  const errorMessage = useMemo(() => {
    if (!error) return null;
    // The API answers errors with {"error": "..."} written for the user
    try {
      const parsed: unknown = JSON.parse(error.message);
      if (isRecord(parsed) && typeof parsed.error === "string") return parsed.error;
    } catch {
      // not JSON: fall through to the generic message
    }
    return "Something went wrong with this message. Please try again.";
  }, [error]);

  return (
    <div className="relative h-full bg-background text-foreground">
      <div
        ref={viewportRef}
        onScroll={() => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
          setIsNearBottom(distance < 180);
        }}
        className="h-full overflow-y-scroll overflow-x-hidden custom-scrollbar"
      >
        <div className="sticky top-0 z-30 pointer-events-none">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-background to-transparent" />
          <div className="relative mx-auto max-w-[1100px] px-6 pt-3 pb-3 pointer-events-auto">
            <div className="flex items-baseline justify-between relative z-10">
              <div
                onClick={resetChat}
                className="cursor-pointer hover:opacity-70 transition-opacity active:scale-95 select-none"
                title="Reset conversation"
              >
                <h1 className="text-2xl font-black tracking-tight drop-shadow-md">AvitoPT</h1>
              </div>

            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[1100px] px-6 pb-8">
          <main className="relative flex flex-col" suppressHydrationWarning>
            {!hasMessages ? (
              <div className="flex flex-1 items-center justify-center px-4 pb-44 pt-14">
                <div className="w-full max-w-[900px] text-center">
                  <h2 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">Find your laptop</h2>
                  <p className="mx-auto mt-3 max-w-xl text-[14px] leading-6 text-muted-foreground">
                    Search by Brand, model, city, budget, or specs and the assistant will bring reliable items from the Avito laptops database.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-7 px-0 pb-24 pt-8">
                {typedMessages.map((message) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    visibleCols={visibleCols}
                    toggleCol={toggleCol}
                  />
                ))}

                <StreamingIndicator phase={streamPhase} />

                {errorMessage && lastSubmittedId && <ErrorLine message={errorMessage} />}
              </div>
            )}
            <div ref={bottomRef} className="h-px w-full" style={{ overflowAnchor: "auto" }} />
          </main>
        </div>
      </div>

      {!isNearBottom && hasMessages && (
        <button
          type="button"
          onClick={() => scrollToLatest("smooth")}
          className="fixed bottom-[calc(112px+env(safe-area-inset-bottom))] left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/10 bg-zinc-950/90 px-3 py-2 text-[12px] font-medium text-foreground shadow-2xl backdrop-blur-xl transition hover:bg-zinc-900"
        >
          <ArrowDown className="size-3.5" />
          Jump to latest
        </button>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-28 bg-gradient-to-t from-background to-transparent" />
      <div className="fixed inset-x-0 bottom-0 z-40 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className={LANE_CLASS}>
          <ChatInput
            value={inputValue}
            isLoading={isLoading}
            onChange={setInputValue}
            onSubmit={submitMessage}
            onStop={stop}
          />
          <p className="mt-2 text-center text-[11px] text-muted-foreground/60 leading-relaxed">
            Answers are generated by AI from live listings; check the listing before you buy.
          </p>
        </div>
      </div>
    </div>
  );
}