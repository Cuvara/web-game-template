// Strings, loaded from the package rather than compiled into it.
//
// Three platform profiles make a locale a BLOCKING assertion — Yandex needs ru, CrazyGames
// en, GameVui vi — and the thing release validation measures is whether the locale file is
// present in the built package. Bundling strings into the JavaScript would satisfy nobody:
// the fact would read as an empty locale list, and a reviewer could not see the translation
// either.
//
// So locales live as JSON under public/locales/, get copied into the build verbatim, and
// are fetched at boot. Adding a language is one new file.

export type LocaleTable = Readonly<Record<string, string>>;

export interface I18n {
  readonly locale: string;
  /** The string for `key`, or the key itself when it is missing. */
  t(key: string): string;
}

/** Order of preference: explicit choice, then the browser's languages, then the fallback. */
export function negotiateLocale(
  available: readonly string[],
  preferred: readonly string[],
  fallback: string,
): string {
  for (const candidate of preferred) {
    const base = candidate.toLowerCase().split("-")[0];
    const match = available.find((locale) => locale.toLowerCase() === base);
    if (match) return match;
  }
  return available.includes(fallback) ? fallback : (available[0] ?? fallback);
}

export interface LoadLocaleOptions {
  /** Locales the package ships. Must match the filenames under public/locales/. */
  readonly available: readonly string[];
  readonly fallback: string;
  /** Overrides browser preference. Portals sometimes pass a language in the URL. */
  readonly preferred?: readonly string[];
  readonly baseUrl?: string;
}

export async function loadLocale(options: LoadLocaleOptions): Promise<I18n> {
  const preferred = options.preferred ?? navigator.languages ?? [navigator.language];
  const locale = negotiateLocale(options.available, preferred, options.fallback);
  const base = options.baseUrl ?? "locales";

  let table: LocaleTable = {};
  try {
    const response = await fetch(`${base}/${locale}.json`);
    if (response.ok) table = (await response.json()) as LocaleTable;
  } catch {
    // A missing string table must not stop the game booting. Keys render as themselves,
    // which is ugly and obvious — the right failure mode for something a reviewer will see.
  }

  return {
    locale,
    t: (key) => table[key] ?? key,
  };
}
