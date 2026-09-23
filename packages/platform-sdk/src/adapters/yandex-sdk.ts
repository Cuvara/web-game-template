// The part of the Yandex Games SDK this adapter calls, typed from the official docs.
//
// Deliberately a subset. Every member here is one the adapter uses and one the docs
// describe; nothing is typed "just in case", because an API that is typed but never called
// is an API nobody checked against the current documentation. Where a member comes from:
//
//   YaGames.init()                      https://yandex.com/dev/games/doc/en/sdk/sdk-about
//   environment.i18n.lang               https://yandex.com/dev/games/doc/en/sdk/sdk-environment
//   features.LoadingAPI / GameplayAPI   https://yandex.com/dev/games/doc/en/sdk/sdk-game-events
//   on / off, game_api_pause|resume     https://yandex.com/dev/games/doc/en/sdk/sdk-events
//   adv.showFullscreenAdv / Rewarded    https://yandex.com/dev/games/doc/en/sdk/sdk-adv
//   getPlayer, getData, setData         https://yandex.com/dev/games/doc/en/sdk/sdk-player
//
// Not here, on purpose: `onOffline` (no longer in the ad callbacks), `getPlayer({ scopes })`
// (no longer an option) and `player.getMode()` (deprecated in favour of isAuthorized()).

export interface YandexAdCallbacks {
  onOpen?(): void;
  /** Also called after an error, and when the portal refused an ad called too often. */
  onClose?(wasShown: boolean): void;
  onError?(error: unknown): void;
}

export interface YandexRewardedCallbacks extends YandexAdCallbacks {
  /** The only signal that a reward was earned. */
  onRewarded?(): void;
}

export interface YandexPlayer {
  isAuthorized(): boolean;
  /** Up to 200 KB per player; 100 requests per 5 minutes. */
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  /** `flush: true` sends now rather than queueing. Same limits as getData. */
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
}

export type YandexEventName = "game_api_pause" | "game_api_resume";

export interface YandexSdk {
  readonly environment: {
    readonly app: { readonly id: string };
    /** ISO 639-1. Requirement 2.14: the game detects its language from this. */
    readonly i18n: { readonly lang: string };
  };
  readonly features: {
    readonly LoadingAPI?: { ready(): void };
    readonly GameplayAPI?: { start(): void; stop(): void };
  };
  readonly adv: {
    showFullscreenAdv(options: { callbacks: YandexAdCallbacks }): void;
    showRewardedVideo(options: { callbacks: YandexRewardedCallbacks }): void;
  };
  /**
   * Named events. Only the account-selection pair is used, and only by name through this
   * object, as the docs show: ysdk.on(ysdk.EVENTS.ACCOUNT_SELECTION_DIALOG_OPENED, ...).
   */
  readonly EVENTS?: {
    readonly ACCOUNT_SELECTION_DIALOG_OPENED?: string;
    readonly ACCOUNT_SELECTION_DIALOG_CLOSED?: string;
  };
  /** 20 requests per 5 minutes. */
  getPlayer(): Promise<YandexPlayer>;
  on(event: YandexEventName | string, listener: () => void): unknown;
  off(event: YandexEventName | string, listener: () => void): void;
}

/** The global the `/sdk.js` script defines. */
export interface YaGamesGlobal {
  init(): Promise<YandexSdk>;
}
