"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
} from "@/components/ui/card";

interface LaptopResult {
    title: string;
    brand: string;
    model: string;
    cpu: string;
    gpu: string;
    ram: string;
    storage: string;
    price: number;
    match_score: number;
    link?: string;
    screen_size?: number;
    is_new?: boolean;
}

export default function SearchPage() {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<LaptopResult[]>([]);
    const [showMore, setShowMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSearch = async () => {
        if (!query.trim()) return;

        setLoading(true);
        setError(null);
        setResults([]);
        setShowMore(false);

        try {
            const response = await fetch(
                `http://localhost:8000/api/search/search?q=${encodeURIComponent(query)}&limit=20`
            );

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || "Search failed");
            }

            const data = await response.json();
            setResults(data.results);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSearch();
    };

    const displayedResults = showMore ? results : results.slice(0, 10);

    return (
        <div className="min-h-screen bg-background">
            {/* Navbar */}
            <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
                    <a href="/" className="text-sm font-medium hover:opacity-80">
                        Avito laptops
                    </a>

                    <div className="flex flex-1 items-center justify-center px-6">
                        <div className="relative w-full max-w-md">
                            <Input
                                type="text"
                                placeholder="Search laptops..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="h-9 w-full pr-20 text-xs"
                            />
                            <Button
                                onClick={handleSearch}
                                disabled={loading || !query.trim()}
                                size="sm"
                                variant="secondary"
                                className="absolute right-1 top-1 h-7 px-3 text-xs"
                            >
                                {loading ? "..." : "Search"}
                            </Button>
                        </div>
                    </div>

                    <a
                        href="/"
                        className="text-xs text-muted-foreground hover:text-foreground"
                    >
                        Estimate price
                    </a>
                </div>
            </nav>

            {/* Main Content */}
            <main className="mx-auto max-w-4xl px-4 py-10">
                {results.length === 0 && !error && !loading && (
                    <div className="flex flex-col items-center justify-center pt-20 text-center">
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Find similar laptops
                        </h1>
                        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                            Describe the laptop you're looking for and find matching listings from Avito.
                        </p>
                    </div>
                )}

                {loading && (
                    <div className="flex items-center justify-center pt-20">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                    </div>
                )}

                {error && (
                    <div className="mx-auto mt-6 max-w-md rounded-md border border-destructive/50 bg-destructive/10 p-3 text-center text-xs text-destructive">
                        {error}
                    </div>
                )}

                {results.length > 0 && (
                    <div className="space-y-4">
                        {displayedResults.map((laptop, index) => (
                            <Card key={index} className="group border-border/40 bg-card/40 hover:bg-card/80 hover:border-border/80 transition-all duration-300">
                                <CardContent className="p-5">
                                    {/* Header */}
                                    <div className="flex items-baseline justify-between mb-4">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <h3 className="text-base font-medium tracking-tight text-foreground truncate max-w-[500px]">
                                                {laptop.title}
                                            </h3>
                                            <span className="shrink-0 rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                                                {laptop.match_score}% match
                                            </span>
                                        </div>
                                    </div>

                                    {/* 3-Column Specs Grid */}
                                    <div className="grid grid-cols-12 gap-6">
                                        {/* Column 1 (Specs A) */}
                                        <div className="col-span-4 space-y-2">
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground/60 text-xs">Brand</span>
                                                <span className="font-medium text-foreground">{laptop.brand}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground/60 text-xs">RAM</span>
                                                <span className="font-medium text-foreground">{laptop.ram}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground/60 text-xs">GPU</span>
                                                <span className="font-medium text-foreground truncate max-w-[120px] ml-2 text-right" title={laptop.gpu}>{laptop.gpu}</span>
                                            </div>
                                        </div>

                                        {/* Column 2 (Specs B) */}
                                        <div className="col-span-4 space-y-2 border-l border-border/40 pl-6">
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground/60 text-xs">CPU</span>
                                                <span className="font-medium text-foreground truncate max-w-[120px] ml-2 text-right" title={laptop.cpu}>{laptop.cpu}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground/60 text-xs">Storage</span>
                                                <span className="font-medium text-foreground">{laptop.storage}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground/60 text-xs">Screen</span>
                                                <span className="font-medium text-foreground">{laptop.screen_size ? `${laptop.screen_size}"` : "—"}</span>
                                            </div>
                                        </div>

                                        {/* Column 3 (Price & Link) */}
                                        <div className="col-span-4 flex flex-col items-end justify-between border-l border-border/40 pl-6">
                                            <div>
                                                <p className="text-xl font-bold tracking-tight text-foreground text-right">
                                                    {laptop.price.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">DH</span>
                                                </p>
                                                <p className="text-[10px] text-muted-foreground text-right mt-1">
                                                    {laptop.is_new ? "New condition" : "Used"}
                                                </p>
                                            </div>

                                            {laptop.link && (
                                                <a
                                                    href={laptop.link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs font-medium text-foreground hover:underline decoration-muted-foreground/50 underline-offset-4"
                                                >
                                                    View Listing
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}

                        {!showMore && results.length > 10 && (
                            <div className="flex justify-center pt-8">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowMore(true)}
                                    className="text-xs text-muted-foreground hover:text-foreground"
                                >
                                    Load more results
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
