"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-6 text-center">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">The listings could not be loaded</h1>
        <p className="text-muted-foreground font-light max-w-sm mx-auto leading-relaxed">
          The database did not answer. This is usually temporary.
        </p>
        <div className="pt-4">
          <button
            onClick={reset}
            className="text-xs font-bold tracking-widest uppercase text-foreground hover:text-muted-foreground transition-colors px-6 py-2.5 rounded-full border border-white/10 bg-white/5 cursor-pointer"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
