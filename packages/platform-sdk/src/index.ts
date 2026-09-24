export type {
  AdAvailability,
  AdHooks,
  AdKind,
  AdResult,
  AdSkipReason,
  AnalyticsMode,
  AuthMode,
  DeviceType,
  LoadingApiMode,
  Platform,
  PlatformCapabilities,
  PlatformEnvironment,
  PlatformEvents,
  PlatformSettings,
  PlatformStorage,
  PlatformUser,
  RewardedResult,
  Unsubscribe,
} from "./types.js";
export { DEFAULT_SETTINGS, UNKNOWN_ENVIRONMENT, languageOf } from "./types.js";
export { AdPolicy } from "./ad-policy.js";
export { UsageRecorder, type PlatformUsage } from "./usage.js";
export { LocalStorageBackend, MemoryStorageBackend } from "./storage.js";
export {
  GENERIC_WEB_CAPABILITIES,
  GenericWebPlatform,
  NoSdkPlatform,
  type GenericWebOptions,
} from "./adapters/generic-web.js";
export { GAMEVUI_CAPABILITIES, GameVuiPlatform } from "./adapters/gamevui.js";
export {
  GAMEDISTRIBUTION_CAPABILITIES,
  GameDistributionPlatform,
  type GameDistributionConfig,
  type GameDistributionPlatformOptions,
  type GameDistributionSdkState,
} from "./adapters/gamedistribution/platform.js";
export {
  GAMEDISTRIBUTION_GAME_ID,
  GAMEDISTRIBUTION_PLACEHOLDER_GAME_ID,
  GAMEDISTRIBUTION_SCRIPT_ID,
  GAMEDISTRIBUTION_SDK_URL,
  isReferrerUrl,
  loadGameDistributionSdk,
  readHosting,
  type GameDistributionAdType,
  type GameDistributionEvent,
  type GameDistributionEventName,
  type GameDistributionHosting,
  type GameDistributionOptions,
  type GameDistributionReferrerState,
  type GameDistributionSdk,
  type GameDistributionSdkLoader,
} from "./adapters/gamedistribution/sdk.js";
export {
  CRAZYGAMES_CAPABILITIES,
  CrazyGamesPlatform,
  type CrazyGamesMode,
  type CrazyGamesOptions,
  type ObservedLaunchStage,
} from "./adapters/crazygames/platform.js";
export {
  CrazyGamesDataStorage,
  CRAZYGAMES_DATA_LIMIT_BYTES,
} from "./adapters/crazygames/storage.js";
export {
  CRAZYGAMES_SDK_URL,
  type CrazyGamesAdCallbacks,
  type CrazyGamesEnvironment,
  type CrazyGamesError,
  type CrazyGamesSdk,
  type CrazyGamesSettings,
  type CrazyGamesSystemInfo,
  type CrazyGamesUser,
} from "./adapters/crazygames/sdk.js";
export {
  POKI_CAPABILITIES,
  POKI_SDK_URL,
  PokiPlatform,
  loadPokiSdkScript,
  type PokiOptions,
  type PokiSdk,
  type PokiSdkCall,
  type PokiSdkLoader,
  type PokiSdkState,
} from "./adapters/poki.js";
export {
  GameplayLifecycle,
  type AdBreakDecision,
  type LifecycleCall,
  type LifecycleRejection,
  type RejectedCall,
} from "./lifecycle.js";
export {
  YANDEX_CAPABILITIES,
  YANDEX_SDK_URL,
  YandexPlatform,
  loadSdkScript,
  type YandexOptions,
} from "./adapters/yandex.js";
export {
  YANDEX_DATA_LIMIT_BYTES,
  YANDEX_MIN_WRITE_INTERVAL_MS,
  YandexStorage,
  type Timers,
  type YandexStorageOptions,
} from "./adapters/yandex-storage.js";
export type {
  YaGamesGlobal,
  YandexAdCallbacks,
  YandexPlayer,
  YandexRewardedCallbacks,
  YandexSdk,
} from "./adapters/yandex-sdk.js";
export {
  Y8_CAPABILITIES,
  Y8Platform,
  type Y8Mode,
  type Y8Options,
  type Y8Timers,
} from "./adapters/y8/platform.js";
export { validateY8Config, type Y8Config, type Y8ConfigResult } from "./adapters/y8/config.js";
export { Y8Storage, Y8StorageError, Y8_VALUE_LIMIT_BYTES } from "./adapters/y8/storage.js";
export {
  Y8_READY_EVENT,
  Y8_SAVE_REJECTED,
  Y8_SDK_URL,
  describeY8Error,
  loadY8Sdk,
  type LoadY8Options,
  type Y8AdConfig,
  type Y8AppConfig,
  type Y8BreakInfo,
  type Y8BreakStatus,
  type Y8Error,
  type Y8Global,
  type Y8LoaderEnvironment,
  type Y8Placement,
  type Y8Sdk,
  type Y8ShowAdOptions,
  type Y8User,
} from "./adapters/y8/sdk.js";
export { PlatformEmitter } from "./emitter.js";
export {
  KNOWN_PLATFORM_IDS,
  createPlatform,
  isPlatformId,
  type CreatePlatformOptions,
  type PlatformId,
} from "./registry.js";
