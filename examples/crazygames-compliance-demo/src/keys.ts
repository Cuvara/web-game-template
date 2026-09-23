// On-screen labels for the movement keys.
//
// The bindings are physical key codes (KeyA/KeyD), which sit under Q and D on AZERTY. The
// hint must name the letters printed on the player's own keyboard — CrazyGames' guideline
// is to adapt to the layout — so they come from the Keyboard Map API. Where that is missing
// or refused (some iframes), only the arrows are shown: never a letter that may be wrong.

export interface LayoutMapSource {
  readonly keyboard?: { getLayoutMap(): Promise<{ get(code: string): string | undefined }> };
}

export async function keyLabels(source: LayoutMapSource): Promise<string> {
  try {
    const map = await source.keyboard?.getLayoutMap();
    const left = map?.get("KeyA");
    const right = map?.get("KeyD");
    if (left && right) return `← → / ${left.toUpperCase()} ${right.toUpperCase()}`;
  } catch {
    // Not allowed in this frame; arrows are always right.
  }
  return "← →";
}
