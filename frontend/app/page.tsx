import Link from "next/link";

export default function Home() {
  return (
    <div className="h-full bg-background text-foreground flex items-start justify-center pt-8 overflow-y-auto custom-scrollbar">
      <main className="mx-auto max-w-[1100px] px-6 w-full grid grid-cols-1 md:grid-cols-[auto_1fr] gap-x-12 gap-y-12 items-start pt-4 pb-12">

        {/* Left Column: Bio */}
        <section className="flex flex-col pt-6">
          <div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground whitespace-nowrap leading-[0.9] mb-6">
              Mohamed Hajji
            </h1>

            <div className="max-w-xl text-base md:text-lg leading-snug text-muted-foreground space-y-4 font-light">
              <p>
                Engineering student at EMINES UM6P. I build automated systems that collect real data, process it, and serve it through custom interfaces — without supervision.
              </p>
              <p>
                 Two projects live here: a daily autonomous pipeline tracking the Moroccan laptop market, and an AI shopping assistant built on top of it.
              </p>
            </div>
          </div>
        </section>


        {/* Right Column: Projects */}
        <section className="flex flex-col">
          <div className="focus:outline-none space-y-1">
            {/* Avito Laptops */}
            <Link href="/avito" className="group relative -mx-4 px-4 py-4 rounded-xl transition-all duration-300 border border-transparent hover:bg-white/5 hover:backdrop-blur-md block">
              <div className="absolute inset-0 rounded-xl border border-transparent group-hover:border-t-white/15 group-hover:border-l-white/15 [mask-image:linear-gradient(to_bottom_right,black_10%,transparent_50%)] pointer-events-none" />
              <div className="space-y-1.5 transition-transform duration-300 group-hover:translate-x-1">
                <h3 className="text-2xl font-extrabold tracking-tight text-foreground transition-colors group-hover:text-foreground/80">
                  Avito Laptops
                </h3>
                <p className="text-[13px] leading-snug text-muted-foreground font-light max-w-lg">
                  Daily pipeline tracking the Moroccan laptop market. Scrapes Avito, extracts hardware specs from raw listings using Gemini, scores them against real benchmarks, and serves the results through a filterable dashboard.
                </p>
              </div>
            </Link>

            {/* AvitoPT */}
            <Link href="/avitopt" className="group relative -mx-4 px-4 py-4 rounded-xl transition-all duration-300 border border-transparent hover:bg-white/5 hover:backdrop-blur-md block">
              <div className="absolute inset-0 rounded-xl border border-transparent group-hover:border-t-white/15 group-hover:border-l-white/15 [mask-image:linear-gradient(to_bottom_right,black_10%,transparent_50%)] pointer-events-none" />
              <div className="space-y-1.5 transition-transform duration-300 group-hover:translate-x-1">
                <h3 className="text-2xl font-extrabold tracking-tight text-foreground transition-colors group-hover:text-foreground/80">
                  AvitoPT
                </h3>
                <p className="text-[13px] leading-snug text-muted-foreground font-light max-w-lg">
                  Conversational assistant built on top of the Avito database. Describe what you need in plain language — it queries live listings and returns the best available matches.
                </p>
              </div>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
