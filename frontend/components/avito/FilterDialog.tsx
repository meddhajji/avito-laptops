import React from "react";
import {
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

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

interface Props {
    filters: Filters;
    setFilters: (f: Filters) => void;
    gpuTypes: string[];
    applyFilters: () => void;
    clearFilters: () => void;
}

export function FilterDialog({ filters, setFilters, gpuTypes, applyFilters, clearFilters }: Props) {
    return (
        <DialogContent className="sm:max-w-[395px]">
            <DialogHeader>
                <DialogTitle className="text-xl font-black">Filters</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); applyFilters(); }}>
                <div className="grid gap-2.5 py-2">
                    {/* row 1: core info */}
                    <div className="grid grid-cols-3 gap-3 w-full" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Brand</label>
                            <Input placeholder="e.g. Lenovo" value={filters.brand} onChange={(e) => setFilters({ ...filters, brand: e.target.value })} className="h-9 text-sm placeholder:text-[11px] !w-full" />
                        </div>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">City</label>
                            <Input placeholder="e.g. Casablanca" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} className="h-9 text-sm placeholder:text-[11px] !w-full" />
                        </div>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">GPU Type</label>
                            <div className="flex w-full [&>*]:w-full [&>*]:flex-1">
                                <Select value={filters.gpu_type} onValueChange={(v) => setFilters({ ...filters, gpu_type: String(v) })}>
                                    <SelectTrigger className="data-[size=default]:h-9 text-sm !w-full" style={{ width: '100%' }}>
                                        <SelectValue placeholder="Any" />
                                    </SelectTrigger>
                                    <SelectContent alignItemWithTrigger={false} sideOffset={4} className="pt-1.5 pb-0 px-0 rounded-xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50 overflow-hidden">
                                        <p className="px-3 pt-1 pb-2 text-[10px] font-semibold tracking-widest uppercase text-zinc-500 select-none">Types</p>
                                        <SelectItem value="Any" className="rounded-none px-3 py-2 text-sm font-medium text-zinc-300 cursor-pointer transition-all duration-150 focus:bg-white/[0.08] focus:text-white">Any</SelectItem>
                                        {gpuTypes.map(t => (
                                            <SelectItem key={t} value={t} className="rounded-none px-3 py-2 text-sm font-medium text-zinc-300 cursor-pointer transition-all duration-150 focus:bg-white/[0.08] focus:text-white">{t}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    {/* row 2: pricing & ram */}
                    <div className="grid grid-cols-3 gap-3 w-full" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Min Price</label>
                            <Input type="number" placeholder="e.g. 3000" value={filters.price_min} onChange={(e) => setFilters({ ...filters, price_min: e.target.value })} className="h-9 text-sm placeholder:text-[11px] !w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        </div>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Max Price</label>
                            <Input type="number" placeholder="e.g. 7000" value={filters.price_max} onChange={(e) => setFilters({ ...filters, price_max: e.target.value })} className="h-9 text-sm placeholder:text-[11px] !w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        </div>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Min RAM (GB)</label>
                            <Input type="number" placeholder="e.g. 16" value={filters.ram_min} onChange={(e) => setFilters({ ...filters, ram_min: e.target.value })} className="h-9 text-sm placeholder:text-[11px] !w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        </div>
                    </div>

                    {/* row 3: storage & vram & screen */}
                    <div className="grid grid-cols-3 gap-3 w-full" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Min Storage</label>
                            <Input type="number" placeholder="e.g. 512" value={filters.storage_min} onChange={(e) => setFilters({ ...filters, storage_min: e.target.value })} className="h-9 text-sm placeholder:text-[11px] !w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        </div>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Min GPU VRAM</label>
                            <Input type="number" placeholder="e.g. 4" value={filters.gpu_vram_min} onChange={(e) => setFilters({ ...filters, gpu_vram_min: e.target.value })} className="h-9 text-sm placeholder:text-[11px] !w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        </div>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Min Screen (&quot;)</label>
                            <Input type="number" placeholder="e.g. 15.6" value={filters.screen_size_min} onChange={(e) => setFilters({ ...filters, screen_size_min: e.target.value })} className="h-9 text-sm placeholder:text-[11px] !w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        </div>
                    </div>

                    {/* row 4: specs & time */}
                    <div className="grid grid-cols-3 gap-3 w-full" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Min Refresh (Hz)</label>
                            <Input type="number" placeholder="e.g. 144" value={filters.refresh_rate_min} onChange={(e) => setFilters({ ...filters, refresh_rate_min: e.target.value })} className="h-9 text-sm placeholder:text-[11px] !w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        </div>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">GPU Model</label>
                            <Input
                                placeholder="e.g. RTX 4060"
                                value={filters.gpu === "Any" ? "" : filters.gpu}
                                onChange={(e) => setFilters({ ...filters, gpu: e.target.value || "Any" })}
                                className="h-9 text-sm placeholder:text-[11px] !w-full"
                            />
                        </div>
                        <div className="space-y-1 min-w-0">
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Upload Date</label>
                            <div className="flex w-full [&>*]:w-full [&>*]:flex-1">
                                <Select
                                    value={filters.upload_date}
                                    onValueChange={(v) => setFilters({ ...filters, upload_date: String(v) })}
                                >
                                    <SelectTrigger className="data-[size=default]:h-9 text-sm !w-full" style={{ width: '100%' }}>
                                        <SelectValue placeholder="Any" />
                                    </SelectTrigger>
                                    <SelectContent
                                        alignItemWithTrigger={false}
                                        sideOffset={4}
                                        className="pt-1.5 pb-0 px-0 rounded-xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50 overflow-hidden"
                                    >
                                        <p className="px-3 pt-1 pb-2 text-[10px] font-semibold tracking-widest uppercase text-zinc-500 select-none">
                                            Timeframe
                                        </p>
                                        <SelectItem value="Any" className="rounded-none px-3 py-2 text-sm font-medium text-zinc-300 cursor-pointer transition-all duration-150 focus:bg-white/[0.08] focus:text-white">Any</SelectItem>
                                        <SelectItem value="24h" className="rounded-none px-3 py-2 text-sm font-medium text-zinc-300 cursor-pointer transition-all duration-150 focus:bg-white/[0.08] focus:text-white">Last 24h</SelectItem>
                                        <SelectItem value="3d" className="rounded-none px-3 py-2 text-sm font-medium text-zinc-300 cursor-pointer transition-all duration-150 focus:bg-white/[0.08] focus:text-white">Last 3 days</SelectItem>
                                        <SelectItem value="1w" className="rounded-none px-3 py-2 text-sm font-medium text-zinc-300 cursor-pointer transition-all duration-150 focus:bg-white/[0.08] focus:text-white">Last week</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    {/* boolean filters */}
                    <div className="flex flex-wrap gap-x-6 gap-y-3 pt-1">
                        <div className="flex items-center gap-2">
                            <Switch checked={filters.ssd === true} onCheckedChange={(v) => setFilters({ ...filters, ssd: v ? true : null })} />
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">SSD</label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch checked={filters.touchscreen === true} onCheckedChange={(v) => setFilters({ ...filters, touchscreen: v ? true : null })} />
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Touchscreen</label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch checked={filters.is_shop === true} onCheckedChange={(v) => setFilters({ ...filters, is_shop: v ? true : null })} />
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Shop</label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch checked={filters.delivery_only === true} onCheckedChange={(v) => setFilters({ ...filters, delivery_only: v })} />
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Delivery Only</label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch checked={filters.is_new === true} onCheckedChange={(v) => setFilters({ ...filters, is_new: v ? true : null })} />
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Condition: New</label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch checked={filters.hide_unknown_prices === true} onCheckedChange={(v) => setFilters({ ...filters, hide_unknown_prices: v })} />
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Hide unknown prices</label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch checked={filters.show_sold === true} onCheckedChange={(v) => setFilters({ ...filters, show_sold: v })} />
                            <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">Show sold items</label>
                        </div>
                    </div>

                    {/* actions */}
                    <div className="flex gap-2 pt-2">
                        <Button type="submit" className="flex-1">Apply</Button>
                        <Button type="button" variant="outline" onClick={clearFilters} className="flex-1">Clear</Button>
                    </div>
                </div>
            </form>
        </DialogContent>
    );
}
