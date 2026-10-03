"use client";

import { createContext, useContext } from "react";

const ThemeContext = createContext<{
    theme: "dark";
}>({ theme: "dark" });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    return (
        <ThemeContext.Provider value={{ theme: "dark" }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
