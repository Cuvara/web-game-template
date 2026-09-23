import { describe, expect, it } from "vitest";
import { AdPolicy, type PlatformCapabilities } from "@wgf/platform-sdk";

function capabilities(overrides: Partial<PlatformCapabilities> = {}): PlatformCapabilities {
  return {
    ads: ["interstitial", "rewarded"],
    iap: false,
    cloudSaves: false,
    leaderboards: false,
    achievements: false,
    auth: "none",
    analytics: "none",
    loadingApi: "required",
    interstitialMinIntervalS: 60,
    gameplayStopOnHidden: true,
    ...overrides,
  };
}

describe("AdPolicy", () => {
  it("refuses an ad kind the platform does not offer", () => {
    // GameVui's profile has no rewarded video, and asserts uses_rewarded_ads == false.
    const policy = new AdPolicy(capabilities({ ads: ["interstitial", "banner"] }));
    expect(policy.check("rewarded")).toBe("unsupported");
  });

  it("allows the first interstitial", () => {
    const policy = new AdPolicy(capabilities());
    expect(policy.check("interstitial")).toBeNull();
  });

  it("refuses an interstitial inside the profile's minimum interval", () => {
    let now = 0;
    const policy = new AdPolicy(capabilities({ interstitialMinIntervalS: 60 }), () => now);

    policy.record("interstitial");
    now = 59_000;
    expect(policy.check("interstitial")).toBe("too-soon");
    expect(policy.secondsUntilInterstitial()).toBeCloseTo(1);

    now = 60_000;
    expect(policy.check("interstitial")).toBeNull();
    expect(policy.secondsUntilInterstitial()).toBe(0);
  });

  it("does not throttle rewarded video", () => {
    let now = 0;
    const policy = new AdPolicy(capabilities(), () => now);
    policy.record("interstitial");
    now = 1_000;
    expect(policy.check("rewarded")).toBeNull();
  });

  it("imposes no interval where the profile sets none", () => {
    const policy = new AdPolicy(capabilities({ interstitialMinIntervalS: null }));
    policy.record("interstitial");
    expect(policy.check("interstitial")).toBeNull();
  });
});
