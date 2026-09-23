# Orb Catcher — CrazyGames compliance demo

The smallest game that exercises the CrazyGames integration end to end:

```
Boot → SDK init → Loading → First gameplay → Gameplay state → Ad → Resume → Save
```

Catch falling orbs with the paddle (mouse, touch, or ← → / A D). Each level ends at a
natural break where a midgame ad may play; every third break offers an optional rewarded
ad (or a coin purchase) to double the level's coins. Progress is saved through the
platform's storage — the CrazyGames Data module when the SDK is present.

It talks only to `@wgf/platform-sdk`. Nothing here touches `window.CrazyGames`.

```bash
pnpm build:crazygames-demo            # from the repository root
pnpm test:crazygames                  # desktop, mobile, tablet — mocked SDK
CG_LIVE_SDK=1 pnpm test:crazygames tests/crazygames/live-sdk.spec.ts --project desktop
pnpm audit:crazygames --dir examples/crazygames-compliance-demo/dist
pnpm --filter @wgf/example-crazygames-compliance-demo dev   # http://localhost:5173
```

On `localhost` the real SDK runs in its `local` environment: ads are an overlay, and the
console shows the SDK's calls. `?useLocalSdk=true` forces that mode on another host.

The demo is not a game submitted anywhere, and a green run is not CrazyGames approval. See
[the requirements](../../docs/platforms/crazygames/requirements.md) and
[the compliance report](../../compliance/crazygames-compliance-report.md).
