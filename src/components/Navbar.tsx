"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, Moon, Sun, X } from "lucide-react";
import Logo from "@/components/Logo";

const primary = [
  { name: "Overview", href: "/" },
  { name: "Command Centre", href: "/dashboard" },
  { name: "Plants", href: "/plants" },
  { name: "Disease Lab", href: "/detector" },
  { name: "Architecture", href: "/architecture" },
  { name: "AI", href: "/ai" },
];

const more = [
  { name: "Problem", href: "/problem" },
  { name: "Solution", href: "/solution" },
  { name: "Features", href: "/features" },
  { name: "Prototype", href: "/prototype" },
  { name: "Results", href: "/results" },
  { name: "Research", href: "/research" },
  { name: "Dataset", href: "/dataset" },
  { name: "Impact", href: "/impact" },
  { name: "Team", href: "/team" },
  { name: "Contact", href: "/contact" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    let saved: string | null = null;
    try { saved = localStorage.getItem("hyaria-theme"); } catch { /* storage blocked */ }
    if (saved === "light") applyTheme(false);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  const applyTheme = (isDark: boolean) => {
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
    try { localStorage.setItem("hyaria-theme", isDark ? "dark" : "light"); } catch { /* ignore */ }
  };

  return (
    <header className="fixed top-0 inset-x-0 z-50 px-4 pt-3">
      <nav
        className={`mx-auto max-w-6xl flex items-center justify-between rounded-full pl-4 pr-2 py-2 transition-all duration-500 ${
          scrolled ? "glass shadow-[0_10px_40px_-15px_rgba(0,0,0,0.6)]" : "border border-transparent"
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5" aria-label="HY-ARIA home">
          <Logo className="w-7 h-7" />
          <span className="font-display text-[17px] font-bold tracking-tight">
            HY<span className="text-faint">·</span>ARIA
          </span>
        </Link>

        <div className="hidden lg:flex items-center gap-1">
          {primary.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname?.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative px-3.5 py-2 text-[13px] font-medium rounded-full transition-colors ${
                  active ? "text-foreground" : "text-text-muted hover:text-foreground"
                }`}
              >
                {active && (
                  <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-card-2 border border-line" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
                )}
                <span className="relative">{l.name}</span>
              </Link>
            );
          })}
          <button onClick={() => setOpen((v) => !v)} className="px-3.5 py-2 text-[13px] font-medium text-text-muted hover:text-foreground rounded-full">
            More
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => applyTheme(!dark)}
            className="w-9 h-9 grid place-items-center rounded-full text-text-muted hover:text-foreground hover:bg-card-2 transition-colors"
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link href="/dashboard" className="btn btn-primary hidden sm:inline-flex px-4 py-2 text-[13px]">
            Open console
          </Link>
          <button
            className="lg:hidden w-9 h-9 grid place-items-center rounded-full text-foreground"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="mx-auto max-w-6xl mt-2 glass rounded-3xl p-4 sm:p-6"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1">
              {[...primary.slice(0, 0), ...primary, ...more].map((l, i) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`px-3 py-2.5 rounded-xl text-sm hover:bg-card-2 transition-colors ${i < primary.length ? "lg:hidden text-foreground font-medium" : "text-text-muted hover:text-foreground"}`}
                >
                  {l.name}
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
