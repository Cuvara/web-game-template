// Page behaviour and focus signals, portal-agnostic.
//
// The Yandex requirements behind this file, in the order moderation most often rejects for
// them (https://yandex.com/dev/games/doc/en/concepts/moderation):
//   1.6.1.8 / 1.6.2.7 — a long press or right click opens no context menu, selects nothing
//   1.3               — sound stops when the game loses focus: tab switch, minimise
//   1.10.2            — the page does not scroll or pull to refresh
//
// The portal's own pause signal (game_api_pause) arrives through the Platform, not here.

export function lockPage(target: Document = document): () => void {
  const cancel = (event: Event): void => event.preventDefault();
  const options = { passive: false } as const;
  const types = ["contextmenu", "selectstart", "dragstart", "gesturestart"] as const;
  for (const type of types) target.addEventListener(type, cancel, options);
  // Pull-to-refresh and rubber-banding. touch-action: none covers most browsers; this
  // covers the ones that ignore it on the document.
  const onTouchMove = (event: TouchEvent): void => {
    if (event.cancelable) event.preventDefault();
  };
  target.addEventListener("touchmove", onTouchMove, options);
  return () => {
    for (const type of types) target.removeEventListener(type, cancel);
    target.removeEventListener("touchmove", onTouchMove);
  };
}

export interface FocusHandlers {
  /** The tab was hidden or shown. */
  readonly visibility: (visible: boolean) => void;
  /** The window lost or regained keyboard focus — inside a portal iframe, a click outside. */
  readonly focus: (focused: boolean) => void;
}

export function watchFocus(handlers: FocusHandlers): () => void {
  const onVisibility = (): void => handlers.visibility(document.visibilityState !== "hidden");
  const onBlur = (): void => handlers.focus(false);
  const onFocus = (): void => handlers.focus(true);
  // pagehide covers mobile Safari backgrounding a tab without a visibilitychange.
  const onPageHide = (): void => handlers.visibility(false);
  const onPageShow = (): void => handlers.visibility(document.visibilityState !== "hidden");

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
  };
}
