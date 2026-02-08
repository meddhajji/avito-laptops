"use client";

import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Loader2, Play, Database, Tag, DollarSign, XCircle, Cpu, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = "http://localhost:8000";

interface RefreshStatus {
    status: string;
    message: string;
    // Phase 1: Scraping
    scraping_progress: number;
    scraping_complete: boolean;
    scraping_message: string;
    // Phase 2: Parsing (renamed from recognition)
    parsing_progress: number;
    parsing_complete: boolean;
    parsing_message: string;
    // Stats
    new_count: number;
    sold_count: number;
    price_changed_count: number;
    total_scraped: number;
    items_added: number;
}

export function RefreshDialog({
    open,
    onOpenChange,
    onComplete,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete?: () => void;
}) {
    const [status, setStatus] = useState<RefreshStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [failureCount, setFailureCount] = useState(0);
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (open) {
            fetchStatus();
            const interval = status?.scraping_complete && !status?.parsing_complete ? 2000 : 1500;
            pollIntervalRef.current = setInterval(fetchStatus, interval);
        }
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, [open, status?.scraping_complete, status?.parsing_complete]);

    const fetchStatus = async () => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(`${API_BASE}/api/refresh/status`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) throw new Error("Status check failed");
            const data = await res.json();
            setStatus(data);
            setFailureCount(0);
            setError(null);

            if (data.status === "completed" && loading) {
                setLoading(false);
                if (onComplete) onComplete();
            }
        } catch (err) {
            console.error(err);
            setFailureCount(prev => {
                const newCount = prev + 1;
                if (newCount > 10) {
                    setError("Connection lost. Backend may be busy processing.");
                }
                return newCount;
            });
        }
    };

    const startRefresh = async () => {
        setLoading(true);
        setError(null);
        setFailureCount(0);
        try {
            const res = await fetch(`${API_BASE}/api/refresh/start?pages=500`, { method: "POST" });
            const data = await res.json();
            if (!data.started) {
                setError(data.message);
                setLoading(false);
            }
        } catch (err) {
            setError("Failed to start refresh");
            setLoading(false);
        }
    };

    const retryConnection = () => {
        setError(null);
        setFailureCount(0);
        fetchStatus();
    };

    const isRunning = status?.status === "running";
    const isCompleted = status?.status === "completed";
    const scrapingProgress = status?.scraping_progress || 0;
    const parsingProgress = status?.parsing_progress || 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Update database</DialogTitle>
                    <DialogDescription>
                        Scrape Avito for new laptops, price changes, and sold items.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Phase 1: Scraping Progress */}
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground flex items-center gap-2">
                                {status?.scraping_complete ? (
                                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                                ) : isRunning ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : null}
                                {status?.scraping_message || "Scraping pages..."}
                            </span>
                            <span className="font-medium">{Math.round(scrapingProgress)}%</span>
                        </div>
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                            <div
                                className={cn(
                                    "h-full transition-all duration-500 ease-out",
                                    status?.scraping_complete ? "bg-green-500" : "bg-blue-500"
                                )}
                                style={{ width: `${scrapingProgress}%` }}
                            />
                        </div>
                    </div>

                    {/* Stats Grid - Show after scraping complete */}
                    {status?.scraping_complete && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-muted/50 p-3 rounded-lg border">
                                <div className="flex items-center gap-2 mb-1">
                                    <Tag className="w-4 h-4 text-emerald-500" />
                                    <span className="text-xs font-medium text-muted-foreground">New items</span>
                                </div>
                                <p className="text-2xl font-bold">{status?.new_count || 0}</p>
                            </div>

                            <div className="bg-muted/50 p-3 rounded-lg border">
                                <div className="flex items-center gap-2 mb-1">
                                    <XCircle className="w-4 h-4 text-red-500" />
                                    <span className="text-xs font-medium text-muted-foreground">Sold items</span>
                                </div>
                                <p className="text-2xl font-bold">{status?.sold_count || 0}</p>
                            </div>

                            <div className="bg-muted/50 p-3 rounded-lg border">
                                <div className="flex items-center gap-2 mb-1">
                                    <DollarSign className="w-4 h-4 text-blue-500" />
                                    <span className="text-xs font-medium text-muted-foreground">Price changes</span>
                                </div>
                                <p className="text-2xl font-bold">{status?.price_changed_count || 0}</p>
                            </div>

                            <div className="bg-muted/50 p-3 rounded-lg border">
                                <div className="flex items-center gap-2 mb-1">
                                    <Database className="w-4 h-4 text-purple-500" />
                                    <span className="text-xs font-medium text-muted-foreground">Total scraped</span>
                                </div>
                                <p className="text-2xl font-bold">{status?.total_scraped || 0}</p>
                            </div>
                        </div>
                    )}

                    {/* Phase 2: Parsing Progress - Show after scraping complete */}
                    {status?.scraping_complete && status?.new_count > 0 && (
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground flex items-center gap-2">
                                    {status?.parsing_complete ? (
                                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                                    ) : (
                                        <Cpu className="w-4 h-4 animate-pulse text-orange-500" />
                                    )}
                                    <span>
                                        {status?.parsing_message || "Parsing new items..."}
                                    </span>
                                </span>
                                <span className="font-medium">{Math.round(parsingProgress)}%</span>
                            </div>
                            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                <div
                                    className={cn(
                                        "h-full transition-all duration-500 ease-out",
                                        status?.parsing_complete ? "bg-green-500" : "bg-orange-500"
                                    )}
                                    style={{ width: `${parsingProgress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Error with retry */}
                    {error && (
                        <div className="flex items-center justify-between gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-md">
                            <div className="flex items-center gap-2">
                                <AlertCircle className="w-4 h-4" />
                                {error}
                            </div>
                            <Button variant="ghost" size="sm" onClick={retryConnection}>
                                <RefreshCw className="w-4 h-4 mr-1" />
                                Retry
                            </Button>
                        </div>
                    )}

                    {/* Success message */}
                    {isCompleted && (
                        <div className="flex items-center gap-2 text-green-500 text-sm bg-green-500/10 p-3 rounded-md">
                            <CheckCircle2 className="w-4 h-4" />
                            Database updated! Added {status?.items_added || 0} new items.
                        </div>
                    )}
                </div>

                <DialogFooter className="sm:justify-between">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    {!isRunning && !isCompleted && (
                        <Button onClick={startRefresh} disabled={loading}>
                            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                            {error ? "Retry" : "Start update"}
                        </Button>
                    )}
                    {isCompleted && (
                        <Button onClick={() => onOpenChange(false)}>
                            Done
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
