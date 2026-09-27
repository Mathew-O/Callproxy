export function BrandMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
      <rect width="36" height="36" rx="11" fill="var(--accent)" />
      {/* A phone handset turning into caption lines: calls you can read. */}
      <path
        d="M13.4 9.5c.5 0 1 .3 1.2.8l1.3 3.1c.2.5.1 1.1-.3 1.5l-1.4 1.3a12 12 0 0 0 5 5l1.3-1.4c.4-.4 1-.5 1.5-.3l3.1 1.3c.5.2.8.7.8 1.2v2.6c0 .8-.6 1.4-1.4 1.4A15.6 15.6 0 0 1 9.4 10.9c0-.8.6-1.4 1.4-1.4h2.6Z"
        fill="#fff"
      />
      <rect x="20.5" y="9" width="7" height="2.4" rx="1.2" fill="#fff" opacity=".95" />
      <rect x="22.5" y="13.2" width="5" height="2.4" rx="1.2" fill="#fff" opacity=".7" />
    </svg>
  );
}

export function Brand() {
  return (
    <a href="#/" className="inline-flex items-center gap-2.5 rounded-xl font-extrabold text-ink" aria-label="CallProxy home">
      <BrandMark />
      <span className="text-xl tracking-tight">CallProxy</span>
    </a>
  );
}
