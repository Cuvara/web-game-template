// The build target's adapter.
//
// W1 replaces: TEMPORARY SHIM. The contract-2 version constructs only the build target's
// adapter through a build-time virtual module, so a build for one portal bundles no other
// portal's SDK. Until that lands this goes through the SDK's registry, and fills in the Y8
// config the build injects when the caller's options do not carry it.

import { createPlatform, type CreatePlatformOptions, type Platform } from "@wgf/platform-sdk";
import platformConfig from "virtual:platform-config";
import { primaryPlatform } from "../core/config.js";

export function createTargetPlatform(options: CreatePlatformOptions): Platform {
  return createPlatform(primaryPlatform().id, { y8: platformConfig.y8, ...options });
}
