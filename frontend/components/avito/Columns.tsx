import React from "react";
import type { Laptop } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Play } from "lucide-react";

export interface ColDef {
    key: string;
    label: string;
    defaultOn: boolean;
    align?: "right" | "center";
    width?: string;
    render: (l: Laptop) => React.ReactNode;
}

export const SCORE_BADGE = (l: Laptop) => {
    const s = l.score ?? 0;
    const cls =
        s >= 700
            ? "bg-emerald-500/20 text-emerald-400"
            : s >= 400
                ? "bg-amber-500/20 text-amber-400"
                : "bg-zinc-500/20 text-zinc-400";
    return (
        <span
            className={`inline-flex items-center justify-center w-10 h-6 rounded text-xs font-bold ${cls}`}
        >
            {s}
        </span>
    );
};
 
export const RENDER_LINK = (l: Laptop) => l.link ? (
    <a href={l.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center p-1 hover:bg-blue-500/10 rounded-md transition-colors">
        <Play className="w-3.5 h-3.5 text-blue-500 fill-blue-500" />
    </a>
) : null;

const SUSPICIOUS_DEAL_PCT = -50;
const NOTABLE_DEAL_PCT = 15; // the price model's typical error; smaller gaps are noise

/** Asking price against the estimated market price for the same hardware. */
const RENDER_DEAL = (l: Laptop) => {
    if (l.deal_pct == null || !l.fair_price) return null;
    const estimate = `Similar laptops are listed around ${l.fair_price.toLocaleString("en-US")} DH`;

    if (l.deal_pct <= SUSPICIOUS_DEAL_PCT) {
        return (
            <span title={`${estimate}. A price this low is rarely real: it may be a deposit, a typo or a part.`} className="cursor-help text-[11px] font-semibold text-amber-400/80">
                check
            </span>
        );
    }
    if (l.deal_pct <= -NOTABLE_DEAL_PCT) {
        return <span title={estimate} className="cursor-help text-[11px] font-semibold text-emerald-400">{l.deal_pct}%</span>;
    }
    if (l.deal_pct >= NOTABLE_DEAL_PCT) {
        return <span title={estimate} className="cursor-help text-[11px] text-muted-foreground/50">+{l.deal_pct}%</span>;
    }
    return <span title={estimate} className="cursor-help text-[11px] text-muted-foreground/35">fair</span>;
};

/** Price with its distance from the market estimate beside it. */
const RENDER_PRICE = (l: Laptop) => {
    if (!l.price) return <span className="text-muted-foreground/40 italic">N/A</span>;
    return (
        <span className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="font-semibold text-foreground/90">{l.price.toLocaleString("en-US")} DH</span>
            {RENDER_DEAL(l)}
        </span>
    );
};

export const ALL_COLUMNS: ColDef[] = [
    { key: "score", label: "Score", defaultOn: true, width: "w-[65px]", render: SCORE_BADGE },
    { key: "brand", label: "Brand", defaultOn: true, width: "w-[80px]", render: (l) => <span className="font-medium">{l.brand || ""}</span> },
    { key: "model", label: "Model", defaultOn: true, width: "w-[160px]", render: (l) => <span className="truncate block">{l.model || ""}</span> },
    { key: "price", label: "Price", defaultOn: true, width: "w-[150px]", render: RENDER_PRICE },
    { key: "cpu", label: "CPU", defaultOn: true, width: "w-[120px]", render: (l) => <span className="truncate block">{l.cpu || ""}</span> },
    { key: "ram", label: "RAM", defaultOn: true, width: "w-[80px]", render: (l) => (l.ram != null ? `${l.ram} GB` : "") },
    { key: "storage", label: "Storage", defaultOn: true, width: "w-[100px]", render: (l) => {
        if (l.storage == null) return "";
        if (l.storage >= 1000) return `${l.storage / 1000} TB`;
        return `${l.storage} GB`;
    }},
    { key: "gpu", label: "GPU", defaultOn: true, width: "w-[130px]", render: (l) => <span className="truncate block">{l.gpu || ""}</span> },
    { key: "city", label: "City", defaultOn: true, width: "w-[120px]", render: (l) => <span className="truncate block text-muted-foreground">{l.city || ""}</span> },
    { key: "new", label: "Cond.", defaultOn: true, width: "w-[80px]", render: (l) => l.new === 1 ? <Badge variant="secondary" className="text-[10px] uppercase font-bold tracking-tight">New</Badge> : (l.new === 0 ? <span className="text-[10px] uppercase font-bold text-muted-foreground/60 tracking-tight">Used</span> : "") },
    { key: "gpu_type", label: "GPU type", defaultOn: false, render: (l) => l.gpu_type || "" },
    { key: "gpu_vram", label: "VRAM", defaultOn: false, render: (l) => (l.gpu_vram != null ? `${l.gpu_vram} GB` : "") },
    { key: "screen_size", label: "Screen", defaultOn: false, render: (l) => (l.screen_size != null ? `${l.screen_size}"` : "") },
    { key: "refresh_rate", label: "Hz", defaultOn: false, render: (l) => (l.refresh_rate != null ? `${l.refresh_rate} Hz` : "") },
    { key: "ssd", label: "SSD", defaultOn: false, width: "w-[50px]", render: (l) => (l.ssd === 1 ? "✓" : "") },
    { key: "touchscreen", label: "Touch", defaultOn: false, width: "w-[50px]", render: (l) => (l.touchscreen === 1 ? "✓" : "") },
    { key: "is_shop", label: "Shop", defaultOn: false, width: "w-[50px]", render: (l) => (l.is_shop ? "✓" : "") },

    { key: "description", label: "Description", defaultOn: false, render: (l) => <span className="max-w-[200px] truncate block text-xs">{l.description || ""}</span> },
    { key: "has_delivery", label: "Delivery", defaultOn: false, width: "w-[50px]", render: (l) => (l.has_delivery ? "✓" : "") },
    { key: "status", label: "Recency", defaultOn: false, width: "w-[70px]", render: (l) => {
        if (l.is_sold) return <Badge variant="destructive" className="text-[10px] uppercase font-bold tracking-wider opacity-80 py-0 leading-tight">Sold</Badge>;
        // When the seller posted it, not when the pipeline first stored it
        const listed = new Date(l.listed_at ?? l.created_at);
        const hoursAgo = (Date.now() - listed.getTime()) / (1000 * 60 * 60);
        if (hoursAgo < 48) return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] uppercase font-bold tracking-wider py-0 leading-tight">New</Badge>;
        return null;
    }},
];
