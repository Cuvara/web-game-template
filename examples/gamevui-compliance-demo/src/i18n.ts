// Strings, shipped as JSON files beside the build.
//
// Vietnamese is the default. GameVui does not publish a language requirement; the site is
// Vietnamese-only (source-matrix.md, "Metadata — observed"), so vi first is an inferred
// choice, not a documented rule. `?lang=en` switches to English.

export const SHIPPED_LOCALES = ["vi", "en"] as const;
export const DEFAULT_LOCALE = "vi";

export type Translate = (key: string) => string;

export function pickLocale(requested: string | null, available: readonly string[]): string {
  const base = requested?.toLowerCase().split("-")[0];
  return base && available.includes(base) ? base : DEFAULT_LOCALE;
}

export async function loadStrings(locale: string): Promise<Translate> {
  let table: Record<string, string> = {};
  try {
    // Relative, so the build works from whatever folder the portal serves it under.
    const response = await fetch(`locales/${locale}.json`);
    if (response.ok) table = (await response.json()) as Record<string, string>;
  } catch {
    // Keys render as themselves: ugly and obvious, and the game still boots.
  }
  return (key) => table[key] ?? key;
}
