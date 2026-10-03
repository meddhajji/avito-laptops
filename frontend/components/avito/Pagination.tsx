import React from "react";
import { Button } from "@/components/ui/button";

interface Props {
    page: number;
    totalPages: number;
    setPage: (p: number) => void;
}

export function Pagination({ page, totalPages, setPage }: Props) {
    if (totalPages <= 1) return null;

    return (
        <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
            </p>
            <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                </Button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let p: number;
                    if (totalPages <= 5) {
                        p = i;
                    } else if (page < 3) {
                        p = i;
                    } else if (page > totalPages - 4) {
                        p = totalPages - 5 + i;
                    } else {
                        p = page - 2 + i;
                    }
                    return (
                        <Button key={p} variant={p === page ? "default" : "outline"} size="sm" onClick={() => setPage(p)}>
                            {p + 1}
                        </Button>
                    );
                })}
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                    Next
                </Button>
            </div>
        </div>
    );
}
