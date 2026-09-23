# GameVui compliance report

Subject: `examples/gamevui-compliance-demo` — _Hứng Sao (Star Catcher)_ 0.1.0, PixiJS, built
from this template's packages. Researched and validated 2026-09-23.

**Nothing here has been submitted to, reviewed by or approved by GameVui.** No claim in this
report is a GameVui approval.

Evidence for every GameVui claim: [docs/platforms/gamevui/source-matrix.md](../docs/platforms/gamevui/source-matrix.md).
What the template does about each: [docs/platforms/gamevui/platform-contract.md](../docs/platforms/gamevui/platform-contract.md).
The per-requirement registry: [examples/gamevui-compliance-demo/compliance/requirements.mjs](../examples/gamevui-compliance-demo/compliance/requirements.mjs).

## Summary

```text
SDK                       NONE PUBLIC (undocumented in-frame scripts observed — not used)
JavaScript API            NONE PUBLIC
Publishing API            NONE
Submission process        OFFICIAL: email dichvu@meta.vn (the contact form has no upload)
Build                     VERIFIED
Local compliance          VERIFIED against OFFICIAL, INFERRED and LOCAL requirements
GameVui requirements      13 UNKNOWN — GameVui publishes none on those points
Manual review             REQUIRED (8 items)
```

## Final status: `INSUFFICIENT_OFFICIAL_DOCUMENTATION`

Every automated check passes, but GameVui does not publish its submission format, technical
requirements, size or performance limits, metadata requirements, ad or monetisation terms,
or developer licence terms. The demo is as ready as it can be made from public information;
whether it meets GameVui's actual expectations is unknowable until the operator answers the
questions in the cover email. After an answer, the status can move to
`READY_WITH_MANUAL_CHECKS` at best — the content and rights checks are manual by nature.

## Official SDK

None public. No developer page, SDK, API reference or upload form is linked anywhere on
gamevui.vn; `dev.`, `developer.`, `sdk.` and `api.gamevui.vn` do not resolve.

GameVui does run its own undocumented code inside hosted games (INFERRED, observed):

- a central `https://gamevui.vn/games/services/score.min.js` defining `window.GV`
  (`saveScore`) and `window.GVAdBreak` (rewarded ad break via Google H5 Games Ads), which also
  injects ads, an in-frame menu, a viewport override and key handling;
- a per-game `gamevui-tool.js` defining `window.GameVuiTool`, seen next to one LayaAir build.

Neither is documented, versioned or offered to third parties. The demo does not call,
stub or detect them; the static audit fails the build if the bundle mentions them.

## Official API

No runtime JavaScript API and no publishing API are documented. `createPlatform("gamevui")`
still throws — an adapter has nothing to be written against.

## Submission process

OFFICIAL ([support/contact](https://gamevui.vn/support/contact)): "Mọi liên hệ, đóng góp
bài viết, game... vui lòng gửi về địa chỉ email: dichvu@meta.vn hoặc qua biểu mẫu". The form is
a Microsoft Forms page with Name, Email, Company Name, a topic choice ("Liên hệ hợp tác" fits),
Nội dung and Site — **no file upload** — so the package goes by email.

Package (deterministic; byte-identical across runs and time zones):

```text
release/gamevui/
  build/hung-sao-0.1.0.zip     dist/ contents, index.html at the root
  manifest/manifest.json       every entry, size, SHA-256
  manifest/checksums.txt
  submission-report.md         requirement results, manual checklist, vi/en cover email
```

No `screenshots/` or `metadata/` directory: GameVui documents neither. Format, size limit and
review time are `UNKNOWN`. GameVui releases games under Vietnamese G2–G4 notifications
([support/thong-bao-game](https://gamevui.vn/support/thong-bao-game)); what that needs from a
developer is `UNKNOWN` and is asked in the cover email.

## Technical requirements

None published. Built and checked against observed hosting (INFERRED):

| Check                                                                                                         | Result                                                       |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Boots in a browser, no errors (GV-TEC-01)                                                                     | PASSED — desktop, phone portrait, phone landscape, tablet    |
| Two iframes deep, no `allow`, sub-path `/web/2026/09/hung-sao/`, `?gid&returnurl&ratedages&token` (GV-TEC-02) | PASSED — all four projects                                   |
| Relative URLs only (GV-TEC-03)                                                                                | PASSED                                                       |
| No insecure requests (GV-TEC-04)                                                                              | PASSED                                                       |
| Survives the observed `score.min.js` viewport override and key swallowing (GV-TEC-06)                         | PASSED — desktop (simulated locally; no GameVui code loaded) |
| Supported browsers / resolutions / entry file (GV-TEC-05)                                                     | UNKNOWN                                                      |
| No undocumented GameVui global or ad SDK in the bundle (GV-LOC-01)                                            | PASSED                                                       |
| No request leaves the package origin (GV-LOC-02)                                                              | PASSED                                                       |

## UX requirements

- Health warning and under-18 playtime limits are **shown and enforced by GameVui**
  (OFFICIAL, terms Phần 2 §2) — `NOT_APPLICABLE` to the game.
- Developer UX guidelines: `UNKNOWN`.
- Loading feedback shown then cleared (GV-UX-04): PASSED.
- Desktop and phone control text in both locales and in the submission text (GV-UX-05):
  PASSED — mirrors the "Cách chơi game" lines every GameVui game page carries (INFERRED).

## Gameplay

Round starts, ends after three misses, restarts without reload (GV-GAM-01): PASSED. Hidden tab
pauses the loop and resumes it (GV-GAM-02): PASSED. Rules unit-tested for determinism,
catching, missing, clamping and rotation.

## Content

OFFICIAL rules in the terms are written for users; applying them to games is INFERRED.
Prohibited: pornography, depravity, violence, gambling, drugs, alcohol, false or defamatory
information, malware, a map of Vietnam that misstates sovereignty. Virtual items only in-game,
never cashed out or traded. The demo is abstract shapes and UI text, with no map, items,
purchases or ads — but that has to be confirmed by a person, not a test, and nobody has
signed it off yet (GV-CON-01/02/03/05: MANUAL_REQUIRED).
Every game carries an age rating of 00+, 12+, 16+ or 18+ (OFFICIAL); the demo proposes `00+`,
checked to be one of the four (GV-CON-04: PASSED). Who assigns the final rating is `UNKNOWN`.

## Ads

GameVui runs ads itself — around the game frame and, observed, inside it through
`score.min.js`, including a rewarded "watch an ad for a reward" system (OFFICIAL, terms Phần 2
§3/§5). There is no developer ad API, placement or frequency rule. **The demo implements no
ads** (`ads_requested = 0` in all four projects). Developer ads: `UNKNOWN`.

## Monetization

No revenue share, IAP or payment terms for developers are published: `UNKNOWN`. The
advertising price list on gamevui.vn is for advertisers buying PR placements, not for
developers.

## Mobile

Touch steering and layout in portrait and landscape (GV-MOB-01), tablet play (GV-MOB-02):
PASSED. Canvas fills the viewport, nothing scrolls, the Play button stays in view and ≥44 px
tall, and the game follows rotation. Chromium with device descriptors — a viewport and input
check, not a Safari or real-device check.

## Desktop

Mouse and keyboard steering (GV-DSK-01): PASSED.

## Performance

No GameVui limit is published, so all three are `UNKNOWN`, with measurements recorded:

| Measure                  | Value                                    |
| ------------------------ | ---------------------------------------- |
| Build size               | ~518 KiB in 13 files; zip ~156 KiB       |
| Time to interactive      | 0.4–0.7 s (final run; local preview)     |
| Frame rate while playing | 3.6–7.4 fps **on this host** (final run) |

The frame rate is not representative: headless Chromium rendered through software WebGL
while the host's load average was 40–120 on 12 cores from other worktrees' jobs. It is
recorded, not judged. Real-device and low-end Android testing is a manual follow-up.

## Metadata

Required metadata, screenshots and icon: `UNKNOWN`. What a GameVui game page shows —
Vietnamese title with English in parentheses, description, controls, age badge — is prepared
in vi and en (GV-MET-02: PASSED). Vietnamese ships and is the default (GV-MET-03: PASSED;
INFERRED — the site is Vietnamese-only). Developer name and email are left `null` on purpose
(GV-MET-04: MANUAL_REQUIRED).

## Copyright

GameVui's terms put IP in the service with "GameVui.vn và bên cấp phép" (its licensors);
the terms a developer licenses a game under are `UNKNOWN`. The package holds only HTML, JS and
JSON — every visual is drawn in code, no image/font/audio files (GV-CPY-02: PASSED). Code: own
(MIT) plus PixiJS (MIT). Rights confirmation: MANUAL_REQUIRED.

## Privacy

GameVui collects name, date of birth, Vietnamese phone number, IP and session data, keeps
servers in Vietnam and data for six months after an account ends, and lets advertisers set
cookies (OFFICIAL, privacy policy). Its policy is verified accounts only; enforcement was
observed to be partial. All of that is the platform's (`NOT_APPLICABLE`). What a submitted
game may collect is `UNKNOWN`. The demo sets no cookies, has no forms and stores only its best
score in `localStorage` (GV-PRV-03: PASSED).

## Automated tests

Final run by the main agent (`pnpm verify` in the demo, after every fix below):

| Suite                                                                  | Result                                                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root `pnpm lint` / `pnpm typecheck` / `pnpm test` (unit + integration) | pass / pass / 70 of 70                                                                                                                                    |
| Demo typecheck                                                         | pass                                                                                                                                                      |
| Demo unit (`vitest`)                                                   | 29 of 29 — rules, registry invariants (UNKNOWN never PASSED), audit, package determinism and entry modes, report                                          |
| Demo production build                                                  | pass — 13 files, relative URLs, no source maps                                                                                                            |
| Demo e2e (Playwright, Chromium)                                        | 60 tests: **47 passed, 0 failed, 13 skipped** — the skips are declared per device (mouse/keyboard on touch projects, touch on desktop, tablet-only probe) |
| Static audit                                                           | 7 of 7                                                                                                                                                    |
| Package                                                                | index at root, entry modes 0644, byte-identical rebuild; same SHA-256 under UTC and `Pacific/Kiritimati`                                                  |
| Compliance                                                             | 45 requirements: 20 PASSED, 0 FAILED, 0 NOT_RUN, 8 MANUAL_REQUIRED, 4 NOT_APPLICABLE, 13 UNKNOWN                                                          |

Independent validator (Claude, separate Orca terminal, `GV_DEMO_PORT=4190`):

| Item                                                                 | Status                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| install, lint, typecheck, unit, integration, build, production build | PASSED                                                                                                                                                                                                                                                                                                                                                                                      |
| Playwright; desktop, mobile, tablet viewports                        | PASSED — 47 passed, 0 failed, 13 skipped, first run                                                                                                                                                                                                                                                                                                                                         |
| network audit, asset audit                                           | PASSED                                                                                                                                                                                                                                                                                                                                                                                      |
| bundle audit                                                         | PASSED — measured only; no GameVui limit exists                                                                                                                                                                                                                                                                                                                                             |
| submission-package audit                                             | **FAILED, then PASSED after fix** — every zip entry had Unix mode 0000, so Info-ZIP extracted unreadable files. Cause: adm-zip shifts the attribute itself; a pre-shifted value was masked to 0. Fixed (`FILE_ATTR = 0o644`), a `package.entry_modes` check and a unit assertion added; validator re-ran: all entries `-rw-r--r--`, extracted files byte-identical to `dist/`, checksums OK |
| GitHub workflow                                                      | NOT_TESTABLE — `actionlint` clean; not executed                                                                                                                                                                                                                                                                                                                                             |
| official GameVui validation tools                                    | NOT_TESTABLE — none exist                                                                                                                                                                                                                                                                                                                                                                   |
| GameVui acceptance                                                   | MANUAL_REQUIRED / UNKNOWN                                                                                                                                                                                                                                                                                                                                                                   |

`prettier --check` at the root fails only on `.serena/*.yml`, untracked tool state that is not
part of this work and is not committed.

## CI

`.github/workflows/gamevui-demo.yml` runs typecheck, unit, build, e2e (Chromium), audit,
package and compliance for the demo, and uploads `release/gamevui/` and
`build/gamevui-demo/` as an artifact. It submits nothing. **Not run on GitHub** — pushing
was out of scope; every step it runs was run locally.

## Claude review

An independent Claude reviewer, in its own Orca terminal, researched GameVui before reading
the implementation, then reviewed it. It confirmed: no public SDK, JS API or publishing API;
email as the submission channel; the G2–G4 regime; platform-side health warning and playtime
limits; the four age ratings; the content, virtual-item, privacy and copyright clauses; that
the Factory profile is unverified; that no UNKNOWN is reported as passing; and that the demo
calls no GameVui global.

Disagreements were resolved against evidence, not averaged. Each was re-checked by the main
agent directly on gamevui.vn before changing anything:

| Reviewer finding                                                                                                 | Re-check                                                                                                     | Resolution                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `window.GV` and `GVAdBreak` come from central `score.min.js`, not the per-game tool                              | `score.min.js` source: `t.GV=function(){…}`, `window.GVAdBreak=function(n){a("reward",n)}`                   | Reviewer right; docs corrected                                                                                                   |
| The contact page's `@` is an image, not stripped                                                                 | Raw HTML: `dichvu<img … alt="@">meta.vn`                                                                     | Reviewer right; corrected                                                                                                        |
| Games are also hosted on `i.gamevui.vn`                                                                          | `xep-khoi-go` frame navigated to `https://i.gamevui.vn/web/2026/07/xep-khoi-go/`                             | Reviewer right; corrected                                                                                                        |
| The contact form has no file upload                                                                              | Form fields read: Name, Email, Company Name, topic, Nội dung, Site; 0 file inputs                            | Reviewer right; instructions now say email the zip                                                                               |
| "Platform gates play behind a verified account" overstated                                                       | `gamebox.noads.min.js`: gate only with `data-require-login`/`data-fileformat="iframe"`, weekdays 07:00–19:00 | Reviewer right; now "policy OFFICIAL, enforcement partial"                                                                       |
| Leaderboards are OFFICIAL for arena games                                                                        | support/help: "…ghi danh trên Bảng vàng đối với những game thuộc phần Đấu trường"                            | Reviewer right; profile `leaderboards: false` marked contradicted                                                                |
| GameVui ads run inside the game frame too                                                                        | `score.min.js` sets up `adBreak` unless `ads=0`                                                              | Reviewer right; GV-ADS-01 reworded                                                                                               |
| Iframe test granted `allow="autoplay; fullscreen"` and was one level deep                                        | `#giframe` has no `allow`, no `sandbox`; production nests two frames                                         | Reviewer right; test now two frames deep with no `allow`                                                                         |
| `score.min.js` behaviour (viewport override, key swallowing, fullscreen, menu, preroll) undocumented in the docs | Confirmed in source                                                                                          | Added to the matrix and as GV-TEC-06, tested by local simulation; the rest listed under Known risks and asked in the cover email |
| `.serena/` untracked                                                                                             | Present, created 11:50 by tooling outside this work                                                          | Left out of the commit                                                                                                           |

No disagreement was left unresolved.

## Unknown requirements

GV-SUB-03 submission format and files · GV-SUB-04 review process and time · GV-SDK-01 SDK /
JS API · GV-TEC-05 browsers, resolutions, entry file · GV-UX-01 UX guidelines · GV-ADS-02
developer ads · GV-MON-01 revenue / IAP · GV-PRF-01 size limit · GV-PRF-02 frame rate /
low-end · GV-PRF-03 load time · GV-MET-01 metadata, screenshots, icon · GV-PRV-02 data a game
may collect · GV-CPY-01 developer licence. None is reported as passing.

## Third-party assumptions

The Factory profile `gamevui@1.0.0` (`status: unverified`, no GameVui citation) is the source
of every GameVui figure the template carried before this work. Against the official pages:

| Profile field                                                                                                                               | Verdict                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `max_bundle_mb: 50` (blocking)                                                                                                              | UNKNOWN — no GameVui source                                                                  |
| `locales_required: [vi]` (blocking)                                                                                                         | INFERRED, not official                                                                       |
| `rewarded_available: false`, `gamevui_no_rewarded` (blocking)                                                                               | **Contradicted** — terms describe a rewarded-ad system; `GVAdBreak` requests `reward` breaks |
| `capabilities.leaderboards: false`                                                                                                          | **Contradicted** — support/help: arena games save to the Bảng vàng                           |
| `age_rating_required: false`                                                                                                                | **Contradicted** — every game carries 00+/12+/16+/18+                                        |
| `capabilities.auth: none`                                                                                                                   | True for the game; platform policy is login-gated                                            |
| `interstitial_min_interval_s: 120`, `screenshots_min: 2`, `icon_required`, `review.*`, `lowend_android_fps >= 30`, `analytics: self-hosted` | UNKNOWN                                                                                      |

Recommended for the Factory (this repository cannot change the profile): bump `gamevui` with
`profile_update: requirement-change`, drop or downgrade the blocking `gamevui_no_rewarded`
and `gamevui_bundle_size` assertions until GameVui confirms them, and set
`leaderboards`/`age_rating_required` from the official pages.

In this repository, README, `docs/architecture.md`, `docs/publishing.md`, `vite.config.ts`,
`create-renderer.ts` and `build.yml` stated the profile's 50 MB as GameVui's cap; they now call
it the profile's unverified figure.

Look-alike sites (gamevui.edu.vn, gamevui.org, gamevui.io, gamevui247.com, gamevui.blog) are
not GameVui; gamevui.vn calls itself the only official site.

## Manual checks

1. **GV-SUB-01** — email the zip (or a link) and the cover text to dichvu@meta.vn.
2. **GV-SUB-05** — ask what the G2–G4 release notification needs from the developer.
3. **GV-CON-01/02/03/05** — play every screen; confirm no prohibited content, no map, no
   malware (dependency list: PixiJS only), no virtual items.
4. **GV-MET-04** — fill `developer.name` / `developer.email` in `gamevui.submission.json`.
5. **GV-CPY-03** — confirm rights to everything in the package.
6. Ask the operator the six questions in the cover email: format and size; technical
   requirements; whether GameVui adds `score.min.js`/ads/menu to the build; whether
   `GV.saveScore`/`GVAdBreak` are open to third parties; G2–G4 inputs and age-rating
   assignment; licence and revenue terms.
7. Test on real phones, including a low-end Android device.

## Known risks

- **GameVui may wrap the build.** If it adds `score.min.js`, the game gets a viewport
  override (tested), swallowed ↑ ↓ Space Backspace (tested; the demo uses ← → and Enter), a
  fullscreen request on first tap, a preroll ad and an in-frame menu (not tested — they are
  GameVui's UI).
- **Requirements may exist privately.** A partner SDK or checklist could be shared on
  contact; public sources cannot rule it out.
- **Observed hosting can change** without notice (`e.` vs `i.gamevui.vn` already varies).
- **Frame rate unmeasured on real hardware** (see Performance).
- **Phone rounds are short** when idle — the basket covers ~26% of the narrow side, so three
  misses come fast. A design choice, not a defect, but a reviewer may notice.
- **The CI workflow has not run on GitHub.**

## Official sources

- https://gamevui.vn/support/about — operator, email, "only official site", browser + mobile play
- https://gamevui.vn/support/contact — submission by email or form
- https://gamevui.vn/support/terms — updated 28/05/2026: accounts, content, age ratings, virtual items, ads, IP
- https://gamevui.vn/support/privacy — data collected, retention, cookies
- https://gamevui.vn/support/help — arena leaderboards
- https://gamevui.vn/support/thong-bao-game — G2–G4 certificate and notifications
- https://gamevui.vn/support/bao-gia-quang-cao — advertiser price list (not developer terms)

All read on 2026-09-23 through headless Chromium; plain HTTP clients get a Cloudflare 403.
