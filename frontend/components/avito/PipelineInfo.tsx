import React from "react";
import {
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

export function ScraperInfo() {
  const steps = [
    {
        step: "01",
        title: "Crawl",
        desc: "Each night a scraper walks the whole laptop category on Avito.ma, retrying failed pages, and extracts listing data directly from the page source.",
    },
    {
        step: "02",
        title: "Diff",
        desc: "Every listing is compared to the database by its Avito ID. New listings go into a staging table, price changes are patched directly, and anything missing from two complete scrapes in a row gets marked as sold. A content hash detects when a listing is rewritten into a different item and forces a full re-parse.",
    },
    {
        step: "03",
        title: "Parse",
        desc: "Batches of 50 listings are sent to Gemini Flash with a strict output schema. It filters out non-laptop items — bags, stands, repair services — and extracts 13 structured fields from the raw seller text: brand, CPU, RAM, GPU, storage, screen size, condition, and more.",
    },
    {
        step: "04",
        title: "Score",
        desc: "Each laptop gets a composite score based on CPU benchmarks cross-referenced against a 6,000-entry benchmark list, plus GPU tier, RAM, storage, screen, and condition. Weighted across all components.",
    },
    {
        step: "05",
        title: "Serve",
        desc: "Results go into PostgreSQL, with every price change kept as history. The pipeline runs automatically every night via GitHub Actions.",
    },
  ];

  return (
    <DialogContent className="sm:max-w-3xl bg-zinc-950/90 backdrop-blur-2xl border-white/10 text-white custom-scrollbar max-h-[80vh] overflow-y-auto top-[50%] translate-y-[-50%] pb-4">
        <DialogHeader className="pb-0">
            <DialogTitle className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">How the scraper works</DialogTitle>
        </DialogHeader>
        <div className="py-2 grid grid-cols-2 gap-x-12 gap-y-3">
            {steps.map(({ step, title, desc }) => (
            <div key={step} className="flex gap-4 group">
                <span className="text-[14px] font-black text-white/20 group-hover:text-emerald-500/40 transition-colors pt-0.5 shrink-0 w-6">{step}</span>
                <div>
                    <p className="text-sm font-black text-white/90 mb-1">{title}</p>
                    <p className="text-[13px] leading-relaxed text-muted-foreground/80">{desc}</p>
                </div>
            </div>
            ))}
        </div>
    </DialogContent>
  );
}

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
                    Updated: {new Date(lastUpdate.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <span>Parsed with Gemini Flash</span>
            </div>
        ) : (
            <div className="text-[11px] text-muted-foreground flex items-center justify-between border-t border-border/50 pt-3 pb-3 mt-1 px-6">
                <span className="flex items-center gap-1.5 font-medium">
                    <span className="relative flex h-2 w-2">
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                    </span>
                    Statistics currently syncing...
                </span>
                <span>Parsed with Gemini Flash</span>
            </div>
        )}
    </DialogContent>
  );
}
