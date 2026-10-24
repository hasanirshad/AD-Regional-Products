// Markets the app pretends do not exist: not listed, not counted, and their
// catalogues are ignored. Hard-coded on purpose. A market is hidden only when
// BOTH its name and its handle match.

export const HIDDEN_MARKETS: { name: string; handle: string }[] = [{ name: "Global", handle: "de" }];

export function isHiddenMarket(m: { name: string; handle?: string | null }): boolean {
  return HIDDEN_MARKETS.some((h) => h.name === m.name && h.handle === m.handle);
}
