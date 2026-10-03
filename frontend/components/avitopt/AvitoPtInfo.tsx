import React from "react";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AvitoPtInfo() {
  const steps = [
    {
        step: "01",
        title: "Understand",
        desc: "Before any AI is involved, your message is scanned for laptop-related intent using pattern matching across brands, specs, price keywords, and common follow-up phrases — in both French and English. If you're refining a previous search (\"cheaper\", \"same but 16GB RAM\"), your last set of filters is carried over automatically and merged with the new request.",
    },
    {
        step: "02",
        title: "Extract",
        desc: "Your query is passed to a language model equipped with a structured search tool. It reads your plain-text input and maps it to concrete parameters — keywords, price range, minimum RAM and storage, sort order, and result count. Phrases like \"cheapest\" or \"best gaming laptop\" are resolved into explicit sort and filter logic before the database is ever touched.",
    },
    {
        step: "03",
        title: "Query",
        desc: "The extracted parameters hit a PostgreSQL database of Avito laptop listings. Two queries run in parallel: one fetches the actual results, deduplicated by unique spec-and-price combination and capped to exclude sold items; the other computes aggregate stats — total match count, price range across all results, and the most represented city.",
    },
    {
        step: "04",
        title: "Stream",
        desc: "The full result set is pushed directly to the table as a real-time data stream, separate from the AI response. The model receives only a condensed summary of up to 5 listings — enough to write an accurate natural language reply without processing every row.",
    },
    {
        step: "05",
        title: "Display",
        desc: "The table columns adjust automatically to your query. If you asked about GPU, that column surfaces. If you filtered by city, location appears. Core columns — score, brand, model, price, and link — are always visible. Everything else is toggleable.",
    },
  ];

  return (
    <DialogContent className="sm:max-w-3xl bg-zinc-950/90 backdrop-blur-2xl border-white/10 text-white custom-scrollbar max-h-[80vh] overflow-y-auto top-[50%] translate-y-[-50%] pb-4">
        <DialogHeader className="pb-0">
            <DialogTitle className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">How AvitoPT works</DialogTitle>
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
