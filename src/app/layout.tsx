import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Chatbot from "@/components/Chatbot";

export const metadata: Metadata = {
  title: "HY-ARIA | Smart Growth Evolution",
  description: "AI-assisted aeroponic farming: live monitoring, automated misting, nutrient and pH control, and plant intelligence.",
};

export const viewport: Viewport = {
  themeColor: "#06090b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased min-h-screen flex flex-col">
        {/* ambient light: one leaf-green and one grow-light pool, very low intensity */}
        <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute -top-[20%] right-[-10%] w-[60vw] h-[60vw] rounded-full blur-[140px] opacity-60" style={{ background: "radial-gradient(circle, var(--c-glow-violet), transparent 65%)" }} />
          <div className="absolute bottom-[-25%] left-[-15%] w-[55vw] h-[55vw] rounded-full blur-[140px] opacity-60" style={{ background: "radial-gradient(circle, var(--c-glow-leaf), transparent 65%)" }} />
        </div>
        <Navbar />
        <main className="flex-grow">{children}</main>
        <Chatbot />
        <Footer />
      </body>
    </html>
  );
}
