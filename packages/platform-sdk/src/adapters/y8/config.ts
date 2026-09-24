// Y8 integration settings: the App ID and Game ID from the game's "SDK Initialization" tab
// in the Y8 Developer Portal (https://docs.y8.com/studio/sdk-initialization/).
//
//   App ID  — "Identifies your application. Always required."
//   Game ID — "Required for advertising; omit it if your game shows no ads."
//
// Neither is a secret — the portal's own snippet puts both in the page — but neither belongs
// in the repository either: they identify one title's account, and a template that ships
// someone's IDs sends every game built from it to that account. They arrive at build time
// (WGF_Y8_APP_ID / WGF_Y8_GAME_ID, see scripts/build/game-config-plugin.ts), not from
// game.config.yaml, whose schema the Factory owns and does not allow extra keys.
//
// The docs give no format for either ID, so validation checks only what any identifier must
// satisfy and rejects the docs' own placeholders ("<app id>"). It does not guess a pattern.

export interface Y8Config {
  readonly appId: string;
  /** Null when the title shows no ads. */
  readonly gameId: string | null;
}

export type Y8ConfigResult =
  | { readonly ok: true; readonly config: Y8Config; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly problem: string };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function checkId(name: string, value: unknown): string | null {
  if (typeof value !== "string") return `${name} must be a string, got ${typeof value}`;
  if (value.trim() === "") return `${name} is empty`;
  if (!IDENTIFIER.test(value)) {
    return `${name} "${value}" is not an identifier (letters, digits, . _ -; at most 128)`;
  }
  return null;
}

/**
 * `raw` is whatever the build injected: `{ appId, gameId? }`, or null/undefined when the
 * build had no Y8 settings. A missing or malformed App ID is fatal to the integration; a
 * malformed Game ID only disables ads, and is reported as a warning.
 */
export function validateY8Config(raw: unknown): Y8ConfigResult {
  if (raw === null || raw === undefined) {
    return { ok: false, problem: "no Y8 settings were provided (WGF_Y8_APP_ID is unset)" };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problem: "Y8 settings must be an object { appId, gameId? }" };
  }
  const { appId, gameId } = raw as { appId?: unknown; gameId?: unknown };
  const appProblem = checkId("appId", appId);
  if (appProblem) return { ok: false, problem: appProblem };

  const warnings: string[] = [];
  let validGameId: string | null = null;
  if (gameId !== undefined && gameId !== null && gameId !== "") {
    const gameProblem = checkId("gameId", gameId);
    if (gameProblem) warnings.push(`${gameProblem}; ads are disabled`);
    else validGameId = gameId as string;
  }
  return { ok: true, config: { appId: appId as string, gameId: validGameId }, warnings };
}
