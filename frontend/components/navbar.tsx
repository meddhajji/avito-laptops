"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Github, Mail, Phone, Check, Linkedin } from "lucide-react";

export function Navbar() {
    const pathname = usePathname();
    const [copied, setCopied] = useState(false);
    // We read these from session storage dynamically so the links update 
    // when filters are changed in the dashboards.
    const getStoredParams = (key: string) => {
        if (typeof window === "undefined") return "";
        const saved = sessionStorage.getItem(key);
        return saved ? "?" + saved : "";
    };

    const avitoParams = getStoredParams("avito_dashboard_params");


    const handleCopyPhone = () => {
        navigator.clipboard.writeText("+212 XXXXXXXXX");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const links = [
        { href: "/avito" + (pathname !== "/avito" ? avitoParams : ""), label: "Avito" },
        { href: "/avitopt", label: "AvitoPT" },
    ];

    return (
        <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-1">
                        {links.map((link) => (
                            <Link
                                key={link.label}
                                href={link.href}
                                suppressHydrationWarning
                                className={cn(
                                    "rounded-md px-3 py-1.5 text-sm transition-all duration-300 border border-transparent",
                                    pathname === link.href
                                        ? "bg-zinc-900/10 dark:bg-white/15 text-zinc-900 dark:text-zinc-100 font-medium shadow-sm backdrop-blur-md border-black/5 dark:border-white/10"
                                        : "text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.08] hover:backdrop-blur-md hover:border-black/5 dark:hover:border-white/10"
                                )}
                            >
                                {link.label}
                            </Link>
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                    <a href="https://github.com/meddhajji/avito-laptop-tracker" target="_blank" rel="noopener noreferrer" className="p-2 hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.08] hover:backdrop-blur-md border border-transparent hover:border-black/5 dark:hover:border-white/10 transition-all duration-300">
                        <Github className="size-4" />
                    </a>
                    <a href="https://www.linkedin.com/in/mohamed-hajji-301330282" target="_blank" rel="noopener noreferrer" className="p-2 hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.08] hover:backdrop-blur-md border border-transparent hover:border-black/5 dark:hover:border-white/10 transition-all duration-300">
                        <Linkedin className="size-4" />
                    </a>
                    <a href="mailto:Mohamed.hajji@emines.um6p.ma" className="p-2 hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.08] hover:backdrop-blur-md border border-transparent hover:border-black/5 dark:hover:border-white/10 transition-all duration-300">
                        <Mail className="size-4" />
                    </a>
                    <button 
                        onClick={handleCopyPhone}
                        className="group relative p-2 hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.08] hover:backdrop-blur-md border border-transparent hover:border-black/5 dark:hover:border-white/10 transition-all duration-300"
                    >
                        {copied ? <Check className="size-4 text-emerald-500" /> : <Phone className="size-4" />}
                        <span className="absolute -bottom-8 right-0 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-100 dark:text-zinc-900 pointer-events-none">
                            {copied ? "Copied!" : "+212 XXXXXXXXX"}
                        </span>
                    </button>
                </div>
            </nav>
        </header>
    );
}
