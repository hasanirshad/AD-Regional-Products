// Country names from the browser's own list, so we never hard-code names.

let names: Intl.DisplayNames | null = null;

export function countryName(code: string): string {
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "DE, AT, CH (+2)" for table cells. */
export function summarizeCodes(codes: string[], show = 4): string {
  if (codes.length === 0) return "—";
  const head = codes.slice(0, show).join(", ");
  return codes.length > show ? `${head} (+${codes.length - show})` : head;
}

export type CountryOption = { code: string; name: string };

/** Unique countries from a list of codes, sorted by name. */
export function toOptions(codes: Iterable<string>, nameOf = countryName): CountryOption[] {
  const seen = new Set<string>();
  const out: CountryOption[] = [];
  for (const code of codes) {
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name: nameOf(code) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
