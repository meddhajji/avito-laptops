import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import { fetchLaptops, fetchLastUpdate, type LaptopSearchParams } from "@/lib/laptops";
import AvitoDashboard from "./AvitoDashboard";

type SearchParams = Promise<LaptopSearchParams>;

const getCachedLaptops = unstable_cache(
    async (params: LaptopSearchParams) => fetchLaptops(params),
    ["laptops-default"],
    { revalidate: 120 } // 2 min
);

const getCachedStats = unstable_cache(
    fetchLastUpdate,
    ["pipeline-last-update"],
    { revalidate: 120 }
);

function isDefaultQuery(params: LaptopSearchParams) {
    const keys = Object.keys(params);
    if (keys.length === 0) return true;
    
    const allowed = ['page', 'sortBy', 'sortOrder', 'hide_sold'];
    for (const key of keys) {
        if (!allowed.includes(key)) return false;
    }
    
    if (params.page && params.page !== "0") return false;
    if (params.sortBy && params.sortBy !== "value") return false;
    if (params.sortOrder && params.sortOrder !== "desc") return false;
    if (params.hide_sold && params.hide_sold !== "true") return false;
    
    return true;
}

function LaptopsSkeleton() {
    return (
        <div className="h-full overflow-y-auto custom-scrollbar border-none outline-none">
            <div className="mx-auto max-w-[1100px] px-6 pt-3 pb-8">
                <div className="flex items-baseline justify-between mb-[14px]">
                    <h1 className="text-2xl font-black tracking-tight">Avito Laptops</h1>
                    <div className="flex items-center gap-3">
                        <div className="h-5 w-32 bg-black/5 dark:bg-white/5 rounded animate-pulse"></div>
                    </div>
                </div>
                <div className="flex gap-2 items-center w-full mb-5">
                    <div className="h-10 flex-1 bg-black/5 dark:bg-white/5 rounded animate-pulse"></div>
                    <div className="h-10 w-[87px] bg-black/5 dark:bg-white/5 rounded animate-pulse"></div>
                    <div className="h-10 w-[87px] bg-black/5 dark:bg-white/5 rounded animate-pulse"></div>
                    <div className="h-10 w-[87px] bg-black/5 dark:bg-white/5 rounded animate-pulse"></div>
                </div>
                <div className="h-[560px] bg-black/5 dark:bg-white/5 rounded-2xl border border-white/10 animate-pulse"></div>
            </div>
        </div>
    );
}

export default async function AvitoPage(props: { searchParams: SearchParams }) {
    const searchParams = await props.searchParams;

    const dataPromise = isDefaultQuery(searchParams) 
        ? getCachedLaptops(searchParams) 
        : fetchLaptops(searchParams);

    const statsPromise = getCachedStats();

    return (
        <Suspense fallback={<LaptopsSkeleton />}>
            <AvitoDashboard dataPromise={dataPromise} statsPromise={statsPromise} />
        </Suspense>
    );
}

