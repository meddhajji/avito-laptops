import React from "react";
import {
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

export function PipelineStats({ lastUpdate, total }: { lastUpdate: { created_at: string } | null, total: number }) {
  return (
    <DialogContent className="sm:max-w-md [&>button]:top-4 [&>button]:right-4">
        <DialogHeader className="px-6 pt-3">
            <DialogTitle className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">TOTAL INVENTORY</DialogTitle>
        </DialogHeader>
        <div className="py-4 flex flex-col items-center justify-center">
            <div className="flex flex-col items-center">
                <p className="text-4xl font-black tracking-tight">{total.toLocaleString("en-US")}</p>
                <p className="text-sm text-muted-foreground font-medium mt-1">Laptops in database</p>
            </div>
        </div>
        
        {lastUpdate ? (
            <div className="text-[11px] text-muted-foreground flex items-center justify-between border-t border-border/50 pt-3 pb-3 mt-1 px-6">
                <span className="flex items-center gap-1.5 font-medium">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 [animation-duration:3s]"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Refreshed: {new Date(lastUpdate.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} UTC
                </span>
                <span>Parsed with Gemini Flash Lite</span>
            </div>
        ) : (
            <div className="text-[11px] text-muted-foreground flex items-center justify-between border-t border-border/50 pt-3 pb-3 mt-1 px-6">
                <span className="flex items-center gap-1.5 font-medium">
                    <span className="relative flex h-2 w-2">
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                    </span>
                    Statistics currently syncing...
                </span>
                <span>Parsed with Gemini Flash Lite</span>
            </div>
        )}
    </DialogContent>
  );
}
