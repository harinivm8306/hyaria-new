import Link from "next/link";
import Logo from "@/components/Logo";

const cols = [
  { title: "Platform", links: [["Command Centre", "/dashboard"], ["Disease Lab", "/detector"], ["Architecture", "/architecture"], ["AI models", "/ai"]] },
  { title: "Project", links: [["Problem", "/problem"], ["Solution", "/solution"], ["Prototype", "/prototype"], ["Results", "/results"]] },
  { title: "Research", links: [["Papers", "/research"], ["Datasets", "/dataset"], ["SDG impact", "/impact"], ["Team", "/team"]] },
];

export default function Footer() {
  return (
    <footer className="border-t border-line mt-24">
      <div className="mx-auto max-w-6xl px-6 py-16 grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-4 max-w-sm">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo className="w-7 h-7" />
            <span className="font-display text-lg font-bold">HY·ARIA</span>
          </Link>
          <p className="text-sm text-text-muted leading-relaxed">
            Smart Growth Evolution. An AI-assisted aeroponic system that keeps roots misted, nutrients balanced and light on target, with every decision logged.
          </p>
          <p className="eyebrow">SDG 2 · 12 · 13</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h4 className="eyebrow mb-4">{c.title}</h4>
            <ul className="space-y-2.5 text-sm">
              {c.links.map(([name, href]) => (
                <li key={href}>
                  <Link href={href} className="text-text-muted hover:text-foreground transition-colors">{name}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-6xl px-6 pb-10 flex flex-col sm:flex-row justify-between gap-3 text-xs text-faint">
        <p>© 2026 HY-ARIA · Sri Sairam Engineering College, Department of Information Technology</p>
        <p className="num">Runs locally · no cloud required</p>
      </div>
    </footer>
  );
}
