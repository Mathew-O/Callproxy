export function currentCallId(): string | null {
  const match = location.hash.match(/^#\/call\/([\w-]+)/);
  return match ? match[1] : null;
}

export function goToCall(id: string, opts: { demo?: boolean } = {}) {
  location.hash = `#/call/${id}${opts.demo ? "?demo" : ""}`;
}

/** Autoplay demo: the call types itself (see useDemoDriver). */
export function isDemo(): boolean {
  return /[?&]demo\b/.test(location.hash);
}

export function goHome() {
  location.hash = "#/";
}
