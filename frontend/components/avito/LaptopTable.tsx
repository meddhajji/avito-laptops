import React from "react";
import type { Laptop } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ALL_COLUMNS, RENDER_LINK } from "./Columns";

interface Props {
    laptops: Laptop[];
    loading?: boolean;
    visibleCols?: Set<string>;
    toggleCol?: (key: string) => void;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    onSortChange?: (field: string, order: "asc" | "desc") => void;
    isLocked?: boolean;
    containerClassName?: string;
    maxHeightClassName?: string;
    density?: "default" | "compact";
}

const DEFAULT_VISIBLE_COLS = new Set(ALL_COLUMNS.filter(c => c.defaultOn).map(c => c.key));

export const LaptopTable = React.memo(function LaptopTable({ 
    laptops, 
    loading = false, 
    visibleCols = DEFAULT_VISIBLE_COLS, 
    toggleCol = () => {}, 
    sortBy = 'score', 
    sortOrder = 'desc', 
    onSortChange = () => {},
    isLocked = false,
    containerClassName,
    maxHeightClassName,
    density = "default",
}: Props) {
    const activeCols = ALL_COLUMNS.filter((c) => visibleCols.has(c.key));
    const compact = density === "compact";

    return (
        <div className={cn("relative w-full rounded-2xl border overflow-auto custom-scrollbar", maxHeightClassName, containerClassName)}>
            <Table className={cn("min-w-max border-collapse", compact && "text-[12px]")}>
                <TableHeader className="sticky top-0 z-30 border-b border-white/10 bg-background shadow-sm">
                    <TableRow className="hover:bg-transparent">
                        {activeCols.map((c, idx) => (
                            <TableHead
                                key={c.key}
                                className={cn(
                                    c.width,
                                    "text-[11px] font-black uppercase tracking-wider text-muted-foreground/70",
                                    idx === 0 && "sticky left-0 bg-background z-50 border-r border-white/5 shadow-[4px_0_8px_rgba(0,0,0,0.2)]",
                                    !isLocked && c.key === "price" && "cursor-pointer group select-none"
                                )}
                                onClick={() => {
                                    if (!isLocked && c.key === "price") {
                                        const newOrder = sortBy === "price" && sortOrder === "asc" ? "desc" : "asc";
                                        onSortChange("price", newOrder);
                                    }
                                }}
                            >
                                <div className="flex items-center gap-1.5">
                                    {c.label}
                                    {c.key === "price" && sortBy === "price" && (
                                        <span className="text-emerald-500 transition-transform shrink-0">
                                            {sortOrder === "desc" ? (
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
                                            )}
                                        </span>
                                    )}
                                </div>
                            </TableHead>
                        ))}
                        <TableHead className="sticky right-0 z-50 w-[40px] border-l border-white/5 bg-background p-0 shadow-[-4px_0_8px_rgba(0,0,0,0.2)]">
                            <Popover>
                                <PopoverTrigger
                                    className={cn("flex w-full items-center justify-center rounded-tr-md text-muted-foreground transition-all duration-300 hover:bg-black/[0.04] hover:text-foreground hover:backdrop-blur-md dark:hover:bg-white/[0.08]", compact ? "h-8" : "h-10")}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M6 9l6 6 6-6" />
                                    </svg>
                                </PopoverTrigger>
                                <PopoverContent 
                                    align="center" 
                                    sideOffset={8}
                                    className="w-48 p-1 bg-zinc-950/90 backdrop-blur-2xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] animate-in fade-in-0 zoom-in-95 duration-500 rounded-lg max-h-[280px] overflow-y-auto custom-scrollbar z-50"
                                >
                                    <p className="text-[9px] uppercase tracking-[0.2em] font-black text-white/30 mb-1.5 px-2 mt-1">Columns</p>
                                    <div className="space-y-0">
                                        {ALL_COLUMNS.map((c) => (
                                            <label
                                                key={c.key}
                                                className="flex items-center gap-2 px-2 py-1 hover:bg-white/[0.06] hover:backdrop-blur-md rounded-md cursor-pointer text-[12px] transition-all duration-300 group"
                                            >
                                                <div className="relative flex items-center justify-center shrink-0">
                                                    <input
                                                        type="checkbox"
                                                        checked={visibleCols.has(c.key)}
                                                        onChange={() => toggleCol(c.key)}
                                                        className="size-3 rounded-sm border-white/20 bg-white/5 text-emerald-500 focus:ring-0 focus:ring-offset-0 transition-all duration-300 checked:bg-emerald-500/80 checked:border-emerald-500 appearance-none border cursor-pointer"
                                                    />
                                                    {visibleCols.has(c.key) && (
                                                        <svg className="absolute size-2 text-white pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="6">
                                                            <path d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    )}
                                                </div>
                                                <span className={`transition-colors duration-300 truncate ${visibleCols.has(c.key) ? "text-white/90 font-medium" : "text-white/30 group-hover:text-white/60"}`}>
                                                    {c.label}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading ? (
                        <TableRow>
                            <TableCell colSpan={activeCols.length + 1} className="h-48 text-center">
                                <span className="text-muted-foreground">Loading...</span>
                            </TableCell>
                        </TableRow>
                    ) : laptops.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={activeCols.length + 1} className="h-48 text-center">
                                <span className="text-muted-foreground">No results</span>
                            </TableCell>
                        </TableRow>
                    ) : (
                        laptops.map((l) => (
                            <TableRow key={l.id} className={cn(l.is_sold && "opacity-50", "hover:bg-white/[0.02] transition-colors")}>
                                {activeCols.map((c, idx) => (
                                    <TableCell
                                        key={c.key}
                                        className={cn(
                                            compact && "px-2 py-1.5",
                                            idx === 0 && "sticky left-0 bg-background z-20 border-r border-white/5 shadow-[4px_0_8px_rgba(0,0,0,0.2)]",
                                        )}
                                    >
                                        {c.render(l)}
                                    </TableCell>
                                ))}
                                 <TableCell className="sticky right-0 z-20 w-[40px] border-l border-white/5 bg-background p-0 shadow-[-4px_0_8px_rgba(0,0,0,0.2)]">
                                     <div className={cn("flex items-center justify-center", compact ? "h-8" : "h-10")}>
                                         {RENDER_LINK(l)}
                                     </div>
                                 </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    );
});
