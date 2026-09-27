const btnBase =
  "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 py-2.5 text-base font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-55";

export const btn = {
  primary: `${btnBase} bg-accent text-on-accent shadow-sm hover:bg-accent-hover`,
  secondary: `${btnBase} border-2 border-line-strong/60 bg-surface text-ink hover:border-line-strong hover:bg-surface-2`,
  danger: `${btnBase} bg-bad text-on-accent hover:bg-bad-hover`,
  ghost: `${btnBase} px-3 text-ink-2 hover:bg-surface-2 hover:text-ink`,
};

export const input =
  "block w-full min-h-12 rounded-xl border-2 border-line-strong bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-3 hover:border-ink-2 focus:border-accent aria-[invalid=true]:border-bad";

export const card = "rounded-3xl border border-line bg-surface shadow-card";

export const label = "mb-1.5 block text-base font-bold text-ink";

export const eyebrow = "text-sm font-bold tracking-wide text-accent-ink uppercase";
