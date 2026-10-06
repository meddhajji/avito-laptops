"use client";

import { useState, useEffect, useTransition, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Laptop } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

// Modularized components
import { FilterDialog } from "@/components/avito/FilterDialog";
import { LaptopTable } from "@/components/avito/LaptopTable";
import { Pagination } from "@/components/avito/Pagination";
import { ALL_COLUMNS } from "@/components/avito/Columns";

const PAGE_SIZE = 12;

type SortOption = "deal" | "score" | "price" | "newest";

interface Filters {
    brand: string;
    city: string;
    gpu_type: string;
    gpu: string;
    price_min: string;
    price_max: string;
    ram_min: string;
    storage_min: string;
    gpu_vram_min: string;
    screen_size_min: string;
    refresh_rate_min: string;
    is_new: boolean | null;
    is_shop: boolean | null;
    touchscreen: boolean | null;
    ssd: boolean | null;
    show_sold: boolean;
    delivery_only: boolean;
    hide_unknown_prices: boolean;
    upload_date: string;
}

const gpuTypeOptions = ["Dedicated", "Integrated"];

const emptyFilters: Filters = {
    brand: "",
    city: "",
    gpu_type: "Any",
    gpu: "Any",
    price_min: "",
    price_max: "",
    ram_min: "",
    storage_min: "",
    gpu_vram_min: "",
    screen_size_min: "",
    refresh_rate_min: "",
    is_new: null,
    is_shop: null,
    touchscreen: null,
    ssd: null,
    show_sold: false,
    delivery_only: false,
    hide_unknown_prices: false,
    upload_date: "Any",
};

const DEFAULT_VISIBLE = new Set(ALL_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key));

function parseFiltersFromURL(params: URLSearchParams): Filters {
    return {
        brand: params.get("brand") || "",
        city: params.get("city") || "",
        gpu_type: params.get("gpu_type") || "Any",
        gpu: params.get("gpu") || "Any",
        price_min: params.get("price_min") || "",
        price_max: params.get("price_max") || "",
        ram_min: params.get("ram_min") || "",
        storage_min: params.get("storage_min") || "",
        gpu_vram_min: params.get("gpu_vram_min") || "",
        screen_size_min: params.get("screen_size_min") || "",
        refresh_rate_min: params.get("refresh_rate_min") || "",
        is_new: params.has("is_new") ? params.get("is_new") === "true" : null,
        is_shop: params.has("is_shop") ? params.get("is_shop") === "true" : null,
        touchscreen: params.has("touchscreen") ? params.get("touchscreen") === "true" : null,
        ssd: params.has("ssd") ? params.get("ssd") === "true" : null,
        show_sold: params.get("show_sold") === "true",
        delivery_only: params.get("delivery_only") === "true",
        hide_unknown_prices: params.get("hide_unknown_prices") === "true",
        upload_date: params.get("upload_date") || "Any",
    };
}

export default function AvitoDashboard({
    dataPromise,
    statsPromise
}: {
    dataPromise: Promise<{ laptops: Laptop[], total: number }>;
    statsPromise: Promise<{ created_at: string } | null>;
}) {
    const { laptops, total } = use(dataPromise);
    const lastUpdate = use(statsPromise);
    const router = useRouter();
    const searchParams = useSearchParams();

    // Local state for interactive UI
    const [filterOpen, setFilterOpen] = useState(false);
    const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
    const [draftFilters, setDraftFilters] = useState<Filters>(parseFiltersFromURL(new URLSearchParams(searchParams.toString())));
    const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(DEFAULT_VISIBLE));
    const [isPending, startTransition] = useTransition();

    // Keep the search box and draft filters in step with the URL (back/forward, links).
    // Adjusting state during render is React's recommended alternative to an effect here.
    const paramsString = searchParams.toString();
    const [syncedParams, setSyncedParams] = useState(paramsString);
    if (syncedParams !== paramsString) {
        setSyncedParams(paramsString);
        setSearchInput(searchParams.get("search") || "");
        setDraftFilters(parseFiltersFromURL(new URLSearchParams(paramsString)));
    }

    // Always save current state, even if empty, so "clearing" persists across navigation
    useEffect(() => {
        sessionStorage.setItem("avito_dashboard_params", paramsString);
    }, [paramsString]);

    // Restore state on mount if no params are present
    useEffect(() => {
        if (!searchParams.toString()) {
            const saved = sessionStorage.getItem("avito_dashboard_params");
            if (saved) {
                startTransition(() => {
                    router.replace("?" + saved);
                });
            }
        }
    }, [searchParams, router]);

    const page = parseInt(searchParams.get("page") || "0", 10);
    const requestedSort = searchParams.get("sortBy");
    const sortBy: SortOption = requestedSort === "score" || requestedSort === "price" || requestedSort === "newest" ? requestedSort : "deal";
    const sortOrder = (searchParams.get("sortOrder") as "asc" | "desc") || "desc";

    const totalPages = Math.ceil(total / PAGE_SIZE);

    const toggleCol = (key: string) => {
        setVisibleCols((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const updateURL = (params: URLSearchParams) => {
        startTransition(() => {
            router.push("?" + params.toString());
        });
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const params = new URLSearchParams(searchParams.toString());
        if (searchInput) params.set("search", searchInput);
        else params.delete("search");
        params.set("page", "0");
        updateURL(params);
    };

    const applyFilters = () => {
        const params = new URLSearchParams(searchParams.toString());

        Object.entries(draftFilters).forEach(([key, value]) => {
            if (value === null || value === "" || value === false || ((key === "gpu_type" || key === "gpu" || key === "upload_date") && value === "Any")) {
                params.delete(key);
            } else {
                params.set(key, String(value));
            }
        });

        // show_sold is false by default
        if (draftFilters.show_sold === true) {
            params.set("show_sold", "true");
        } else {
            params.delete("show_sold");
        }

        if (searchInput) params.set("search", searchInput);
        else params.delete("search");

        params.set("page", "0");
        updateURL(params);
        setFilterOpen(false);
    };

    const clearFilters = () => {
        const params = new URLSearchParams(searchParams.toString());
        Object.keys(emptyFilters).forEach(k => params.delete(k));
        params.delete("search");
        params.set("page", "0");
        setSearchInput("");
        setDraftFilters(emptyFilters);
        updateURL(params);
        setFilterOpen(false);
    };

    const currentFilters = parseFiltersFromURL(new URLSearchParams(searchParams.toString()));
    const currentSearch = searchParams.get("search") || "";
    const activeFilterCount = [
        currentSearch,
        currentFilters.brand,
        currentFilters.city,
        currentFilters.gpu_type !== "Any" ? "y" : "",
        currentFilters.gpu !== "Any" ? "y" : "",
        currentFilters.price_min,
        currentFilters.price_max,
        currentFilters.ram_min,
        currentFilters.storage_min,
        currentFilters.gpu_vram_min,
        currentFilters.screen_size_min,
        currentFilters.refresh_rate_min,
        currentFilters.is_new !== null ? "y" : "",
        currentFilters.is_shop !== null ? "y" : "",
        currentFilters.touchscreen !== null ? "y" : "",
        currentFilters.ssd !== null ? "y" : "",
        currentFilters.show_sold ? "y" : "",
        currentFilters.delivery_only ? "y" : "",
        currentFilters.hide_unknown_prices ? "y" : "",
        currentFilters.upload_date !== "Any" ? "y" : "",
    ].filter(Boolean).length;

    return (
        <div className="h-full overflow-y-auto custom-scrollbar border-none outline-none">
            <div className="mx-auto max-w-[1100px] px-6 pt-3 pb-8">
                {/* Header Row */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 mb-[14px]">
                <div 
                    onClick={() => {
                        setSearchInput("");
                        setDraftFilters(parseFiltersFromURL(new URLSearchParams()));
                        router.push("/avito");
                    }}
                    className="cursor-pointer hover:opacity-70 transition-opacity active:scale-95 select-none"
                    title="Reset all filters"
                >
                    <h1 className="text-2xl font-black tracking-tight">Avito Laptops</h1>
                </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <p>{total.toLocaleString("en-US")} laptops available</p>
                    </div>
                </div>

                {/* search + sort + filter bar */}
                <div className="flex flex-wrap gap-2 items-center w-full">
                    <form onSubmit={handleSearch} className="basis-full sm:basis-0 sm:flex-1">
                        <Input
                            placeholder="Search laptops..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="w-full"
                        />
                    </form>
                    <Button variant="outline" onClick={handleSearch} className="hidden sm:inline-flex w-[87px] shrink-0 justify-center">
                        Search
                    </Button>
                    <Select value={sortBy} onValueChange={(v) => {
                        const params = new URLSearchParams(searchParams.toString());
                        params.set("sortBy", v || "");
                        if (v === "price") params.set("sortOrder", "asc");
                        else params.set("sortOrder", "desc");
                        params.set("page", "0");
                        updateURL(params);
                    }}>
                        <SelectTrigger className="flex-1 sm:flex-none sm:w-[87px] shrink-0 capitalize">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent
                            side="bottom"
                            align="start"
                            alignItemWithTrigger={false}
                            className="pt-1.5 pb-0 px-0 rounded-xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50 overflow-hidden"
                        >
                            <p className="px-3 pt-1 pb-2 text-[10px] font-semibold tracking-widest uppercase text-zinc-500 select-none">
                                Sort by
                            </p>
                            <SelectItem value="deal"    className="rounded-none px-3 py-2 text-sm font-medium text-zinc-300 cursor-pointer transition-all duration-150 focus:bg-white/[0.08] focus:text-white">Best deal</SelectItem>
                            <SelectItem value="score"   className="rounded-none px-3 py-2 text-sm font-medium text-zinc-300 cursor-pointer transition-all duration-150 focus:bg-white/[0.08] focus:text-white">Score</SelectItem>
                            <SelectItem value="price"   className="rounded-none px-3 py-2 text-sm font-medium text-zinc-300 cursor-pointer transition-all duration-150 focus:bg-white/[0.08] focus:text-white">Price</SelectItem>
                            <SelectItem value="newest"  className="rounded-none px-3 pb-[calc(0.5rem+1.5px*2)] pt-2 text-sm font-medium text-zinc-300 cursor-pointer transition-all duration-150 focus:bg-white/[0.08] focus:text-white">Newest</SelectItem>
                        </SelectContent>
                    </Select>
                    <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
                        <DialogTrigger
                            id="avito-filters-trigger"
                            render={
                                <Button variant="outline" className="flex-1 sm:flex-none sm:w-[87px] shrink-0 justify-center">
                                    Filters
                                    {activeFilterCount > 0 && (
                                        <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px] text-emerald-500 leading-none">
                                            {activeFilterCount}
                                        </Badge>
                                    )}
                                </Button>
                            }
                        />
                        <FilterDialog
                            filters={draftFilters}
                            setFilters={setDraftFilters}
                            gpuTypes={gpuTypeOptions}
                            applyFilters={applyFilters}
                            clearFilters={clearFilters}
                        />
                    </Dialog>
                </div>

                {/* data table */}
                <div className="mt-5">
                    <LaptopTable
                        laptops={laptops}
                        loading={isPending}
                        visibleCols={visibleCols}
                        toggleCol={toggleCol}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSortChange={(field, order) => {
                            const params = new URLSearchParams(searchParams.toString());
                            params.set("sortBy", field);
                            params.set("sortOrder", order);
                            params.set("page", "0");
                            updateURL(params);
                        }}
                        containerClassName="max-h-[560px] overflow-y-auto overflow-x-scroll custom-scrollbar bg-white/5 rounded-2xl border border-white/10 backdrop-blur-sm"
                    />
                </div>

                {/* pagination */}
                <div className="mt-4">
                    <Pagination
                        page={page}
                        totalPages={totalPages}
                        setPage={(newPage) => {
                            const params = new URLSearchParams(searchParams.toString());
                            params.set("page", newPage.toString());
                            updateURL(params);
                        }}
                    />
                </div>

                <div className="text-[11px] text-muted-foreground/60 text-center space-y-0.5 pt-4 pb-4 max-w-4xl mx-auto leading-relaxed border-t border-black/5 dark:border-white/5 mt-4">
                    <p>The percentage beside a price compares it with an estimate learned from similar listings.</p>
                    <p>
                        Specs extracted with Gemini
                        {lastUpdate && <> · Last updated {new Date(lastUpdate.created_at).toLocaleDateString("en-GB", { timeZone: "UTC" })}</>}
                    </p>
                </div>
            </div>
        </div>
    );
}

