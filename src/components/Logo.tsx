// HY-ARIA mark: a seedling whose roots hang in mist (aeroponics), drawn on one stroke grid.
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--c-card-2)" stroke="var(--c-line-strong)" />
      <path d="M16 15c0-4 2.5-6.5 6.5-6.5C22.5 12.5 20 15 16 15Z" fill="var(--c-leaf)" />
      <path d="M16 15c0-3.2-2-5.2-5.2-5.2 0 3.2 2 5.2 5.2 5.2Z" fill="var(--c-leaf)" opacity="0.7" />
      <path d="M8 16.5h16" stroke="var(--c-fg)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M16 16.5v6M13.5 16.5c0 2.5-1 4-2 5.5M18.5 16.5c0 2.5 1 4 2 5.5" stroke="var(--c-muted)" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="11" cy="25" r="0.9" fill="var(--c-mist)" />
      <circle cx="16" cy="25.5" r="0.9" fill="var(--c-mist)" />
      <circle cx="21" cy="25" r="0.9" fill="var(--c-mist)" />
    </svg>
  );
}
