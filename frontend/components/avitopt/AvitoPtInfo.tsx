import React from "react";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AvitoPtInfo() {
  const steps = [
    {
        step: "01",
        title: "Check",
        desc: "Every message is validated and rate-limited before any AI is involved. The server receives only your question and the filters of your previous search, never a transcript it would have to trust.",
    },
    {
        step: "02",
        title: "Interpret",
        desc: "A language model turns your message, in English, French, Arabic or Darija, into structured filters: keywords, city, budget, minimum specs, sorting. It can only fill in that form. It never writes a database query.",
    },
    {
        step: "03",
        title: "Query",
        desc: "The filters are sanitized, clamped and run as a parameterized query against the listings database. Duplicate posts and sold listings are left out unless you ask for them.",
    },
    {
        step: "04",
        title: "Answer",
        desc: "The matching rows go straight to the table. A model then writes a short summary from the statistics and a few example rows only. It never sees your original text, so there is nothing to type that makes it say something else.",
    },
    {
        step: "05",
        title: "Fall back",
        desc: "If a model is rate-limited or down, the next one takes over. If all of them are, you still get the table and a plain factual summary. Table columns adapt to what you asked about.",
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
