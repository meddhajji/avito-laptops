import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme";
import { Navbar } from "@/components/navbar";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hajji - portfolio",
  description: "Data projects portfolio",
  openGraph: {
    title: "Hajji - portfolio",
    description: "Data projects portfolio",
    type: "website",
    locale: "en_US",
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full dark">
      <body className={`${inter.variable} font-sans antialiased h-full`} suppressHydrationWarning>
        <ThemeProvider>
          <div className="flex flex-col h-full overflow-hidden">
            <Navbar />
            <main className="flex-1 overflow-hidden relative border-none outline-none">
              {children}
            </main>
          </div>
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
