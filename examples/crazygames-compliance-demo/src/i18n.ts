// Strings, chosen by the portal's locale.
//
// CrazyGames: "The game should use the user's language based on `locale` info provided
// through the system info method ... and if not available/set fallback to English." The
// portal locale comes through the platform contract, never from the SDK directly.
//
// Only English ships. A translation that is not accurate is itself a rejection cause, so a
// language is added when a real translation exists — as one more file in public/locales/.

export const SHIPPED_LOCALES = ["en"] as const;

export interface Strings {
  readonly locale: string;
  t(key: string, values?: Readonly<Record<string, string | number>>): string;
}

export function pickLocale(portalLocale: string | null, browser: readonly string[]): string {
  for (const candidate of [portalLocale, ...browser]) {
    if (!candidate) continue;
    const base = candidate.toLowerCase().split("-")[0];
    const match = SHIPPED_LOCALES.find((locale) => locale === base);
    if (match) return match;
  }
  return "en";
}

export async function loadStrings(locale: string): Promise<Strings> {
  let table: Record<string, string> = {};
  try {
    const response = await fetch(`locales/${locale}.json`);
    if (response.ok) table = (await response.json()) as Record<string, string>;
  } catch {
    // Keys render as themselves — visible and obvious rather than a boot failure.
  }
  return {
    locale,
    t: (key, values) =>
      (table[key] ?? key).replace(/\{(\w+)\}/g, (whole, name: string) =>
        values && name in values ? String(values[name]) : whole,
      ),
  };
}
