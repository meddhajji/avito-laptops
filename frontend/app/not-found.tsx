import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-6 text-center">
      <div className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">404 — page not found</h1>
        <p className="text-muted-foreground font-light max-w-sm mx-auto leading-relaxed">
          The link you followed might be broken, or the page may have been removed.
        </p>
        <div className="pt-4">
          <Link 
            href="/avito" 
            className="text-xs font-bold tracking-widest uppercase text-foreground hover:text-muted-foreground transition-colors px-6 py-2.5 rounded-full border border-white/10 bg-white/5"
          >
            Back to listings
          </Link>
        </div>
      </div>
    </div>
  );
}
