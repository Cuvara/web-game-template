export type {
  AdKind,
  AdResult,
  AdSkipReason,
  AnalyticsMode,
  AuthMode,
  LoadingApiMode,
  Platform,
  PlatformCapabilities,
  PlatformEvents,
  PlatformStorage,
  RewardedResult,
} from "./types.js";
export { AdPolicy } from "./ad-policy.js";
export { UsageRecorder, type PlatformUsage } from "./usage.js";
export { LocalStorageBackend, MemoryStorageBackend } from "./storage.js";
export {
  GENERIC_WEB_CAPABILITIES,
  GenericWebPlatform,
  type GenericWebOptions,
} from "./adapters/generic-web.js";
export {
  KNOWN_PLATFORM_IDS,
  createPlatform,
  isPlatformId,
  type CreatePlatformOptions,
  type PlatformId,
} from "./registry.js";
