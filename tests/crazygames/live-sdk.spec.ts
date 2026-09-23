// Against the real script from sdk.crazygames.com, on localhost — where the SDK runs in its
// documented `local` environment: ads are replaced by an overlay and other calls log to the
// console. Opt-in (CG_LIVE_SDK=1) because it needs the network and depends on a script the
// repository does not control.
//
// What it proves that the mock cannot: the adapter's typing matches the SDK actually being
// served today — init resolves, the environment is `local`, and the lifecycle calls are
// accepted without throwing.

import { LIVE_SDK, boot, expect, snapshot, test } from "./fixtures.js";

test.skip(!LIVE_SDK, "set CG_LIVE_SDK=1 to run against the live SDK");

test("the live v3 SDK initialises in local mode and the demo reaches gameplay", async ({
  page,
}) => {
  const logs: string[] = [];
  page.on("console", (message) => logs.push(message.text()));
  await boot(page);

  const state = await snapshot(page);
  expect(state.sdkMode).toBe("sdk");
  const environment = await page.evaluate(
    () =>
      (window as never as { CrazyGames: { SDK: { environment: string } } }).CrazyGames.SDK
        .environment,
  );
  expect(environment).toBe("local");
  expect(state.usage.gameplayStartCalls).toBe(1);
  expect(logs.join("\n")).toMatch(/CrazyGames/);
});
