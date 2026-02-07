"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { RefreshDialog } from "@/components/refresh-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Check, ChevronsUpDown, SlidersHorizontal, Search, Loader2, RefreshCw, TrendingUp, Sparkles, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = "http://localhost:8000";

// Types
interface EstimateResult {
  specs: Record<string, string | number | boolean>;
  scores: Record<string, number>;
  predicted_price: number;
  confidence: string;
  features_found: number;
}

interface Laptop {
  id?: number;
  title: string;
  brand: string;
  model: string;
  cpu: string;
  gpu: string;
  ram: string;
  ram_gb: number;
  storage: string;
  storage_gb: number;
  screen_size: number;
  refresh_rate: number;
  price: number;
  last_price?: number | null;
  city: string;
  link: string;
  is_new: boolean;
  is_sold?: boolean;
  is_new_listing?: boolean;
  laptop_score: number;
  match_score?: number;
}

interface FilterState {
  brand: string;
  city: string;
  cpu_family: string;
  gpu_type: string;
  is_new: boolean | null;
  is_ssd: boolean | null;
  price_min: string;
  price_max: string;
  ram_gb_min: string;
  ram_gb_max: string;
  storage_gb_min: string;
  storage_gb_max: string;
  include_zero_price: boolean;
}

// Spec Labels
const specLabels: Record<string, string> = {
  brand: "Brand",
  model: "Model",
  cpu: "Processor",
  cpu_family: "CPU Family",
  ram_gb: "RAM",
  storage_gb: "Storage",
  is_ssd: "SSD",
  gpu: "Graphics",
  gpu_vram: "VRAM",
  screen_size: "Screen",
  refresh_rate: "Refresh Rate",
  is_new: "Condition",
  is_touchscreen: "Touchscreen",
};

export default function Home() {
  const [activeTab, setActiveTab] = useState("estimate");

  // Estimate Tab State
  const [estimateQuery, setEstimateQuery] = useState("");
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateResult, setEstimateResult] = useState<EstimateResult | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  // Find Tab State (Semantic Search)
  const [findQuery, setFindQuery] = useState("");
  const [findLoading, setFindLoading] = useState(false);
  const [findResults, setFindResults] = useState<Laptop[]>([]);
  const [findShowMore, setFindShowMore] = useState(false);

  // Filter Tab State
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterResults, setFilterResults] = useState<Laptop[]>([]);
  const [filterOffset, setFilterOffset] = useState(0);
  const [filterTotal, setFilterTotal] = useState(0);
  const [filters, setFilters] = useState<FilterState>({
    brand: "",
    city: "",
    cpu_family: "",
    gpu_type: "",
    is_new: null,
    is_ssd: null,
    price_min: "",
    price_max: "",
    ram_gb_min: "",
    ram_gb_max: "",
    storage_gb_min: "",
    storage_gb_max: "",
    include_zero_price: false,
  });
  const [distinctValues, setDistinctValues] = useState<Record<string, string[]>>({});

  // Best Deals Tab State
  const [dealsLoading, setDealsLoading] = useState(false);
  const [dealsResults, setDealsResults] = useState<Laptop[]>([]);
  const [dealsOffset, setDealsOffset] = useState(0);
  const [dealsTotal, setDealsTotal] = useState(0);

  // Refresh & Listing Counts
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [listingCounts, setListingCounts] = useState({ new_listings: 0, sold_listings: 0, price_changed: 0 });

  // Find Tab infinite scroll state
  const [findOffset, setFindOffset] = useState(0);
  const [findTotal, setFindTotal] = useState(0);

  // Load initial filter data
  useEffect(() => {
    if (activeTab === "filter") {
      loadDistinctValues();
      applyFilters(true);
    }
  }, [activeTab]);

  const loadDistinctValues = async () => {
    const columns = ["brand", "city", "cpu_family", "gpu_type"];
    const values: Record<string, string[]> = {};
    for (const col of columns) {
      try {
        const res = await fetch(`${API_BASE}/api/filter/distinct/${col}`);
        const data = await res.json();
        values[col] = data.values || [];
      } catch {
        values[col] = [];
      }
    }
    setDistinctValues(values);
  };

  // Estimate Price Handler
  const handleEstimate = async () => {
    if (!estimateQuery.trim()) return;
    setEstimateLoading(true);
    setEstimateError(null);
    setEstimateResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/laptops/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: estimateQuery }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to estimate");
      }
      setEstimateResult(await res.json());
    } catch (e) {
      setEstimateError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setEstimateLoading(false);
    }
  };

  // Find a Laptop Handler (Semantic Search with infinite scroll)
  const handleFind = async (reset = true) => {
    if (!findQuery.trim()) return;
    setFindLoading(true);
    if (reset) setFindResults([]);
    const currentOffset = reset ? 0 : findOffset;

    try {
      const res = await fetch(
        `${API_BASE}/api/search/search?q=${encodeURIComponent(findQuery)}&limit=10&offset=${currentOffset}`
      );
      const data = await res.json();
      if (reset) {
        setFindResults(data.results || []);
        setFindOffset(10);
      } else {
        setFindResults((prev) => [...prev, ...(data.results || [])]);
        setFindOffset(currentOffset + 10);
      }
      setFindTotal(data.total || data.results?.length || 0);
    } catch {
      if (reset) setFindResults([]);
    } finally {
      setFindLoading(false);
    }
  };

  // Filter Search Handler
  const applyFilters = async (reset = false) => {
    setFilterLoading(true);
    const offset = reset ? 0 : filterOffset;

    const params = new URLSearchParams();
    params.append("limit", "10");
    params.append("offset", String(offset));

    if (filters.brand) params.append("brand", filters.brand);
    if (filters.city) params.append("city", filters.city);
    if (filters.cpu_family) params.append("cpu_family", filters.cpu_family);
    if (filters.gpu_type) params.append("gpu_type", filters.gpu_type);
    if (filters.is_new !== null) params.append("is_new", String(filters.is_new));
    if (filters.is_ssd !== null) params.append("is_ssd", String(filters.is_ssd));
    if (filters.price_min) params.append("price_min", filters.price_min);
    if (filters.price_max) params.append("price_max", filters.price_max);
    if (filters.ram_gb_min) params.append("ram_gb_min", filters.ram_gb_min);
    if (filters.ram_gb_max) params.append("ram_gb_max", filters.ram_gb_max);
    if (filters.storage_gb_min) params.append("storage_gb_min", filters.storage_gb_min);
    if (filters.storage_gb_max) params.append("storage_gb_max", filters.storage_gb_max);
    // Exclude zero prices by default
    if (!filters.include_zero_price) params.append("price_min", "1");

    try {
      const res = await fetch(`${API_BASE}/api/filter/search?${params}`);
      const data = await res.json();
      if (reset) {
        setFilterResults(data.results || []);
        setFilterOffset(10);
      } else {
        setFilterResults((prev) => [...prev, ...(data.results || [])]);
        setFilterOffset(offset + 10);
      }
      setFilterTotal(data.total || 0);
    } catch {
      // Handle error silently
    } finally {
      setFilterLoading(false);
      setFilterOpen(false);
    }
  };

  // Best Deals Handler (score/price ratio with score weighting)
  const applyDeals = async (reset = false) => {
    setDealsLoading(true);
    const offset = reset ? 0 : dealsOffset;

    try {
      const res = await fetch(
        `${API_BASE}/api/filter/search?limit=10&offset=${offset}&price_min=1&order_by=deal_score`
      );
      const data = await res.json();
      // Apply custom sorting: 0.5 * (score / (price/1000)) + 0.5 * score
      const sorted = (data.results || [])
        .filter((l: Laptop) => l.price > 0)
        .map((l: Laptop) => ({
          ...l,
          deal_score: l.laptop_score / l.price
        }))
        .sort((a: Laptop & { deal_score: number }, b: Laptop & { deal_score: number }) => b.deal_score - a.deal_score);

      if (reset) {
        setDealsResults(sorted);
        setDealsOffset(10);
      } else {
        setDealsResults((prev) => [...prev, ...sorted]);
        setDealsOffset(offset + 10);
      }
      setDealsTotal(data.total || 0);
    } catch {
      // Handle error silently
    } finally {
      setDealsLoading(false);
    }
  };

  // Refresh Handler replaced by Dialog component
  const handleRefreshComplete = async () => {
    await loadListingCounts();
    // Also re-fetch current tab data if needed
    if (activeTab === "deals") applyDeals(true);
  };

  // Load listing counts
  const loadListingCounts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/refresh/counts`);
      const data = await res.json();
      setListingCounts(data);
    } catch {
      // Handle error silently
    }
  };

  const formatValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  };

  // Combobox Component
  const ComboboxFilter = ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: string[];
    onChange: (val: string) => void;
  }) => {
    const [open, setOpen] = useState(false);
    return (
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">{label}</label>
        <Popover open={open} onOpenChange={setOpen} modal={true}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              className="w-full justify-between text-sm font-normal h-9"
            >
              {value || `Select ${label}...`}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <Command>
              <CommandInput placeholder={`Search ${label}...`} />
              <CommandList className="max-h-[300px] overflow-y-auto">
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      onChange("");
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                    Any
                  </CommandItem>
                  {options.map((opt) => (
                    <CommandItem
                      key={opt}
                      value={opt}
                      onSelect={() => {
                        onChange(opt);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn("mr-2 h-4 w-4", value === opt ? "opacity-100" : "opacity-0")}
                      />
                      {opt}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    );
  };

  // Normalize brand name (capitalize first letter of first word only)
  const normalizeBrand = (brand: string): string => {
    if (!brand) return "Unknown";
    const lower = brand.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };

  // Laptop Card Component
  const LaptopCard = ({ laptop, showScore = false, showDealScore = false }: { laptop: Laptop; showScore?: boolean; showDealScore?: boolean }) => {
    const hasPriceDrop = laptop.last_price && laptop.last_price > laptop.price;
    const priceReduction = hasPriceDrop ? Math.round(((laptop.last_price! - laptop.price) / laptop.last_price!) * 100) : 0;

    return (
      <Card className={cn(
        "hover:bg-muted/50 transition-colors",
        laptop.is_sold && "opacity-60"
      )}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h3 className="font-medium text-sm truncate">{laptop.title}</h3>
                {laptop.is_new_listing && (
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
                    NEW!
                  </span>
                )}
                {laptop.is_sold && (
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">
                    SOLD
                  </span>
                )}
                {showScore && laptop.match_score && (
                  <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {laptop.match_score}%
                  </span>
                )}
                {showDealScore && (
                  <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
                    <TrendingUp className="h-3 w-3 inline mr-0.5" />
                    Deal
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Brand</span>
                  <span>{normalizeBrand(laptop.brand)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">CPU</span>
                  <span className="truncate max-w-[100px]">{laptop.cpu}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">RAM</span>
                  <span>{laptop.ram_gb}GB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">GPU</span>
                  <span className="truncate max-w-[100px]">{laptop.gpu}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Storage</span>
                  <span>{laptop.storage_gb}GB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Screen</span>
                  <span>{laptop.screen_size}"</span>
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-semibold">{laptop.price.toLocaleString()} DH</p>
              {hasPriceDrop && (
                <div className="flex items-center justify-end gap-1">
                  <span className="text-xs text-muted-foreground line-through">{laptop.last_price!.toLocaleString()}</span>
                  <span className="text-[10px] px-1 rounded bg-emerald-500/20 text-emerald-400">-{priceReduction}%</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{laptop.is_new ? "New" : "Used"}</p>
              {laptop.link && (
                <a
                  href={laptop.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline mt-1 block"
                >
                  View →
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex h-14 items-center justify-between">
            <span className="font-semibold text-base">Avito Laptops</span>
            <div className="flex items-center gap-2">
              <RefreshDialog
                open={refreshOpen}
                onOpenChange={setRefreshOpen}
                onComplete={handleRefreshComplete}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRefreshOpen(true)}
                title="Refresh data from Avito"
              >
                <RefreshCw className="h-[1.2rem] w-[1.2rem]" />
              </Button>
              <ThemeToggle />
            </div>
          </div>
          {/* Tab Navigation */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="-mb-px">
            <TabsList className="h-10 bg-transparent border-none">
              <TabsTrigger value="estimate" className="data-[state=active]:border-b-2 data-[state=active]:border-foreground rounded-none">
                Estimate price
              </TabsTrigger>
              <TabsTrigger value="find" className="data-[state=active]:border-b-2 data-[state=active]:border-foreground rounded-none">
                Find a laptop
              </TabsTrigger>
              <TabsTrigger value="filter" className="data-[state=active]:border-b-2 data-[state=active]:border-foreground rounded-none">
                Search by filter
              </TabsTrigger>
              <TabsTrigger value="deals" className="data-[state=active]:border-b-2 data-[state=active]:border-foreground rounded-none">
                <TrendingUp className="h-3.5 w-3.5 mr-1.5" /> Best deals
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </nav>

      {/* Main Content */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {/* Estimate Price Tab */}
          <TabsContent value="estimate" className="mt-0">
            {/* Search Bar */}
            <div className="flex gap-2 mb-6">
              <Input
                placeholder="Describe a laptop (e.g., HP Pavilion i5 16GB RAM 512GB SSD)"
                value={estimateQuery}
                onChange={(e) => setEstimateQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleEstimate()}
                className="flex-1"
              />
              <Button onClick={handleEstimate} disabled={estimateLoading || !estimateQuery.trim()}>
                {estimateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {estimateError && (
              <div className="p-3 mb-4 rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-sm">
                {estimateError}
              </div>
            )}

            {estimateResult && (
              <div className="grid gap-4 md:grid-cols-2">
                {/* Price Card */}
                <Card className="md:col-span-2">
                  <CardContent className="py-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Estimated Price</p>
                        <p className="text-4xl font-bold tracking-tight">
                          {estimateResult.predicted_price.toLocaleString()} <span className="text-xl font-normal text-muted-foreground">DH</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Confidence</p>
                        <p className={cn("text-lg font-medium",
                          estimateResult.confidence === "HIGH" ? "text-green-500" :
                            estimateResult.confidence === "MEDIUM" ? "text-yellow-500" : "text-red-500"
                        )}>
                          {estimateResult.confidence}
                        </p>
                        <p className="text-xs text-muted-foreground">{estimateResult.features_found} features</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Specifications Card */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Specifications</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(specLabels).map(([key, label]) => {
                        const value = estimateResult.specs[key];
                        if (value === undefined || value === null || value === "") return null;
                        return (
                          <div key={key} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-medium">
                              {formatValue(key, value)}
                              {key === "ram_gb" && " GB"}
                              {key === "storage_gb" && " GB"}
                              {key === "screen_size" && '"'}
                              {key === "refresh_rate" && " Hz"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Performance Card */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Performance Scores</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {Object.entries(estimateResult.scores).map(([key, score]) => (
                        <div key={key} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground capitalize">
                              {key.replace("_score", "")}
                            </span>
                            <span className="font-medium">{(score / 100).toFixed(1)}/10</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-foreground"
                              style={{ width: `${Math.min(score / 10, 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* Find a Laptop Tab */}
          <TabsContent value="find" className="mt-0">
            <div className="flex gap-2 mb-6">
              <Input
                placeholder="Search laptops (e.g., gaming laptop RTX 3060)"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFind(true)}
                className="flex-1"
              />
              <Button onClick={() => handleFind(true)} disabled={findLoading || !findQuery.trim()}>
                {findLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            <div className="space-y-3">
              {findResults.map((laptop, index) => (
                <LaptopCard key={laptop.link || laptop.id || index} laptop={laptop} showScore />
              ))}
            </div>

            {findResults.length > 0 && findResults.length < findTotal && (
              <div className="flex justify-center mt-6">
                <Button
                  variant="ghost"
                  onClick={() => handleFind(false)}
                  disabled={findLoading}
                >
                  {findLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Load more
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Search by Filter Tab */}
          <TabsContent value="filter" className="mt-0">
            {/* Filter Button */}
            <div className="flex items-center justify-between mb-6">
              <p className="text-sm text-muted-foreground">
                {filterTotal > 0 ? `${filterTotal.toLocaleString()} laptops found` : "Browse all laptops"}
              </p>
              <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <SlidersHorizontal className="h-4 w-4 mr-2" />
                    Filters
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Filter Laptops</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    {/* Dropdown Filters */}
                    <div className="grid grid-cols-2 gap-4">
                      <ComboboxFilter
                        label="Brand"
                        value={filters.brand}
                        options={distinctValues.brand || []}
                        onChange={(v) => setFilters({ ...filters, brand: v })}
                      />
                      <ComboboxFilter
                        label="City"
                        value={filters.city}
                        options={distinctValues.city || []}
                        onChange={(v) => setFilters({ ...filters, city: v })}
                      />
                      <ComboboxFilter
                        label="Cpu family"
                        value={filters.cpu_family}
                        options={distinctValues.cpu_family || []}
                        onChange={(v) => setFilters({ ...filters, cpu_family: v })}
                      />
                      <ComboboxFilter
                        label="Gpu type"
                        value={filters.gpu_type}
                        options={distinctValues.gpu_type || []}
                        onChange={(v) => setFilters({ ...filters, gpu_type: v })}
                      />
                    </div>

                    {/* Numeric Range Filters */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm text-muted-foreground">Price range (DH)</label>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            placeholder="Min"
                            value={filters.price_min}
                            onChange={(e) => setFilters({ ...filters, price_min: e.target.value })}
                            className="h-9"
                          />
                          <Input
                            type="number"
                            placeholder="Max"
                            value={filters.price_max}
                            onChange={(e) => setFilters({ ...filters, price_max: e.target.value })}
                            className="h-9"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-muted-foreground">Ram (GB)</label>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            placeholder="Min"
                            value={filters.ram_gb_min}
                            onChange={(e) => setFilters({ ...filters, ram_gb_min: e.target.value })}
                            className="h-9"
                          />
                          <Input
                            type="number"
                            placeholder="Max"
                            value={filters.ram_gb_max}
                            onChange={(e) => setFilters({ ...filters, ram_gb_max: e.target.value })}
                            className="h-9"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-muted-foreground">Storage (GB)</label>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            placeholder="Min"
                            value={filters.storage_gb_min}
                            onChange={(e) => setFilters({ ...filters, storage_gb_min: e.target.value })}
                            className="h-9"
                          />
                          <Input
                            type="number"
                            placeholder="Max"
                            value={filters.storage_gb_max}
                            onChange={(e) => setFilters({ ...filters, storage_gb_max: e.target.value })}
                            className="h-9"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Boolean Filters */}
                    <div className="flex gap-6 pt-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={filters.is_new === true}
                          onCheckedChange={(v) => setFilters({ ...filters, is_new: v ? true : null })}
                        />
                        <label className="text-sm">New only</label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={filters.is_ssd === true}
                          onCheckedChange={(v) => setFilters({ ...filters, is_ssd: v ? true : null })}
                        />
                        <label className="text-sm">SSD only</label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={filters.include_zero_price}
                          onCheckedChange={(v) => setFilters({ ...filters, include_zero_price: v })}
                        />
                        <label className="text-sm">Include unknown prices</label>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setFilters({
                          brand: "",
                          city: "",
                          cpu_family: "",
                          gpu_type: "",
                          is_new: null,
                          is_ssd: null,
                          price_min: "",
                          price_max: "",
                          ram_gb_min: "",
                          ram_gb_max: "",
                          storage_gb_min: "",
                          storage_gb_max: "",
                          include_zero_price: false,
                        })
                      }
                    >
                      Clear
                    </Button>
                    <Button onClick={() => applyFilters(true)}>
                      {filterLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Apply Filters
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {/* Results */}
            <div className="space-y-3">
              {filterResults.map((laptop, index) => (
                <LaptopCard key={laptop.link || laptop.id || index} laptop={laptop} />
              ))}
            </div>

            {filterResults.length > 0 && filterResults.length < filterTotal && (
              <div className="flex justify-center mt-6">
                <Button
                  variant="ghost"
                  onClick={() => applyFilters(false)}
                  disabled={filterLoading}
                >
                  {filterLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Load more
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Best Deals Tab */}
          <TabsContent value="deals" className="mt-0">
            <div className="flex items-center justify-between mb-6">
              <p className="text-sm text-muted-foreground">
                Best value laptops ranked by quality-to-price ratio
              </p>
              <Button variant="outline" size="sm" onClick={() => applyDeals(true)} disabled={dealsLoading}>
                {dealsLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TrendingUp className="h-4 w-4 mr-2" />}
                Find Deals
              </Button>
            </div>

            <div className="space-y-3">
              {dealsResults.map((laptop, index) => (
                <LaptopCard key={laptop.link || laptop.id || index} laptop={laptop} showDealScore />
              ))}
            </div>

            {dealsResults.length > 0 && dealsResults.length < dealsTotal && (
              <div className="flex justify-center mt-6">
                <Button
                  variant="ghost"
                  onClick={() => applyDeals(false)}
                  disabled={dealsLoading}
                >
                  {dealsLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Load more
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
