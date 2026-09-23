// `{name}` placeholders on top of the template's key lookup.

import type { Translate } from "./ui.js";

/**
 * `fallback` answers when `lookup` does not know a key — a locale file that failed to load
 * would otherwise put raw keys like "over.revive" on screen, which 1.14 counts as technical
 * text shown to the player.
 */
export function formatter(
  lookup: (key: string) => string,
  fallback: Readonly<Record<string, string>> = {},
): Translate {
  return (key, values) => {
    const found = lookup(key);
    const text = found === key ? (fallback[key] ?? key) : found;
    if (!values) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match,
    );
  };
}
