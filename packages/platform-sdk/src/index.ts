export type {
  AdAvailability,
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
  PlatformEventSource,
  PlatformEvents,
  PlatformSettings,
  PlatformStorage,
  PlatformUser,
  RewardedResult,
  Unsubscribe,
} from "./types.js";
export { PlatformEmitter } from "./emitter.js";
export { AdPolicy } from "./ad-policy.js";
export { UsageRecorder, type PlatformUsage } from "./usage.js";
export { LocalStorageBackend, MemoryStorageBackend } from "./storage.js";
export {
  GENERIC_WEB_CAPABILITIES,
  GenericWebPlatform,
  type GenericWebOptions,
} from "./adapters/generic-web.js";
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
  KNOWN_PLATFORM_IDS,
  createPlatform,
  isPlatformId,
  type CreatePlatformOptions,
  type PlatformId,
} from "./registry.js";
