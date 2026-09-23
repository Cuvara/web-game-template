// Every requirement this demo is checked against, and where each one comes from.
//
// `basis` is the source classification from docs/platforms/gamevui/source-matrix.md:
//
//   OFFICIAL — stated on gamevui.vn. Quoted in `evidence`.
//   INFERRED — observed on the live site, or derived from an official statement. Checked,
//              but a pass means "matches what we observed", not "meets a GameVui rule".
//   UNKNOWN  — no evidence. Always reported as UNKNOWN, whatever was measured.
//   LOCAL    — this repository's own rule, not a claim about GameVui (for example "call no
//              undocumented API"). Reported like any other check.
//
// `check.kind`:
//
//   auto     — decided by the probes listed in `check.probes`: static audit checks
//              (`static.<name>`, from scripts/audit.mjs), package checks (`package.<name>`,
//              from scripts/package-submission.mjs) and e2e tests (`e2e.<name>`, tagged
//              `[probe:<name>]` in their titles).
//   manual   — a person has to look. `check.instruction` says what at.
//   platform — GameVui does this itself, not the game.
//   measure  — nothing to pass or fail against; the value is recorded. Only used with
//              basis UNKNOWN.

const TERMS = "https://gamevui.vn/support/terms";
const PRIVACY = "https://gamevui.vn/support/privacy";
const CONTACT = "https://gamevui.vn/support/contact";
const ABOUT = "https://gamevui.vn/support/about";
const NOTICES = "https://gamevui.vn/support/thong-bao-game";
const MATRIX = "docs/platforms/gamevui/source-matrix.md";

export const BASES = ["OFFICIAL", "INFERRED", "UNKNOWN", "LOCAL"];

export const OFFICIAL_AGE_RATINGS = ["00+", "12+", "16+", "18+"];

export const REQUIREMENTS = [
  // --- Submission ---------------------------------------------------------------------
  {
    id: "GV-SUB-01",
    category: "Submission",
    requirement:
      "Games are contributed by email to the operator or through the site's contact form.",
    basis: "OFFICIAL",
    evidence: `${CONTACT} — "Mọi liên hệ, đóng góp bài viết, game... vui lòng gửi về địa chỉ email … hoặc qua biểu mẫu dưới đây"; address dichvu@meta.vn per ${ABOUT}; the form (Microsoft Forms) has no file upload`,
    check: {
      kind: "manual",
      instruction:
        'A person emails release/gamevui/build/*.zip (or a download link) and the cover text from submission-report.md to dichvu@meta.vn. The contact form at https://gamevui.vn/support/contact has no file upload — use it only to open contact (category "Liên hệ hợp tác"). Nothing in this repository sends anything.',
    },
  },
  {
    id: "GV-SUB-02",
    category: "Submission",
    requirement:
      "The package is a zip of the web build with index.html at the archive root, and extracts to readable files.",
    basis: "INFERRED",
    evidence: `Hosted games are served as a folder with an entry page at https://{e,i}.gamevui.vn/web/<yyyy>/<mm>/<slug>/ (observed 2026-09-23, ${MATRIX})`,
    check: {
      kind: "auto",
      probes: ["package.index_at_root", "package.entry_modes", "package.deterministic_layout"],
    },
  },
  {
    id: "GV-SUB-03",
    category: "Submission",
    requirement: "Required submission format and required files.",
    basis: "UNKNOWN",
    evidence: "Not published.",
    check: { kind: "measure", measures: ["package.zip_bytes", "package.entries"] },
  },
  {
    id: "GV-SUB-04",
    category: "Submission",
    requirement: "Review process and review time.",
    basis: "UNKNOWN",
    evidence: "Not published.",
    check: { kind: "measure", measures: [] },
  },
  {
    id: "GV-SUB-05",
    category: "Submission",
    requirement:
      "GameVui releases games under Vietnamese G2–G4 release notifications; ask the operator what it needs from the developer for that dossier.",
    basis: "OFFICIAL",
    evidence: `${NOTICES} — certificate 05/GCN-PTTH&TTĐT and 19 "Giấy xác nhận Thông báo cung cấp dịch vụ trò chơi điện tử G2, G3, G4"`,
    check: {
      kind: "manual",
      instruction:
        "Ask in the submission email what the G2–G4 notification requires from the developer.",
    },
  },

  // --- SDK / API (local rules) --------------------------------------------------------
  {
    id: "GV-SDK-01",
    category: "Technical",
    requirement: "Official GameVui SDK / JavaScript API.",
    basis: "UNKNOWN",
    evidence: `None published (${MATRIX}, "SDK", "API").`,
    check: { kind: "measure", measures: [] },
  },
  {
    id: "GV-LOC-01",
    category: "Technical",
    requirement:
      "The build references no undocumented GameVui global or script (GV, GameVuiTool, GVAdBreak, gamevui-tool.js) and no ad SDK.",
    basis: "LOCAL",
    evidence: "platform-contract.md — do not invent GameVui APIs.",
    check: { kind: "auto", probes: ["static.no_portal_globals"] },
  },
  {
    id: "GV-LOC-02",
    category: "Technical",
    requirement:
      "No request leaves the package's own origin (no portal script, ad network, analytics or CDN).",
    basis: "LOCAL",
    evidence: "platform-contract.md — platform-neutral build.",
    check: { kind: "auto", probes: ["e2e.network_same_origin"] },
  },

  // --- Technical ----------------------------------------------------------------------
  {
    id: "GV-TEC-01",
    category: "Technical",
    requirement: "Plays directly in the browser with nothing to install.",
    basis: "INFERRED",
    evidence: `${ABOUT} — "chơi game trực tiếp trên trình duyệt mà không cần cài đặt" (a description of the service)`,
    check: { kind: "auto", probes: ["e2e.boots"] },
  },
  {
    id: "GV-TEC-02",
    category: "Technical",
    requirement:
      "Boots two iframes deep with no extra frame permissions, from a sub-folder, with GameVui-style query parameters (gid, returnurl, ratedages, token).",
    basis: "INFERRED",
    evidence: `Observed: game page → iframe #giframe (gamevui.vn/account/app, no allow/sandbox attribute) → https://e.gamevui.vn or i.gamevui.vn/web/<yyyy>/<mm>/<slug>/?gid=…&token=… (${MATRIX}, "Technical — hosting")`,
    check: { kind: "auto", probes: ["e2e.iframe_subpath"] },
  },
  {
    id: "GV-TEC-03",
    category: "Technical",
    requirement:
      "Every URL in the build is relative; nothing depends on being served from a domain root.",
    basis: "INFERRED",
    evidence: "Follows from GV-TEC-02.",
    check: { kind: "auto", probes: ["static.relative_urls"] },
  },
  {
    id: "GV-TEC-04",
    category: "Technical",
    requirement: "No insecure (http://) requests.",
    basis: "INFERRED",
    evidence:
      "gamevui.vn and e.gamevui.vn are served over HTTPS (observed); mixed content would be blocked.",
    check: { kind: "auto", probes: ["e2e.no_insecure"] },
  },
  {
    id: "GV-TEC-05",
    category: "Technical",
    requirement: "Supported browsers, engines, resolutions, entry-file name.",
    basis: "UNKNOWN",
    evidence: "Not published.",
    check: { kind: "measure", measures: [] },
  },

  {
    id: "GV-TEC-06",
    category: "Technical",
    requirement:
      "Still boots and steers if GameVui adds its own in-frame script: viewport meta overwritten, Up/Down/Space/Backspace keydowns default-prevented.",
    basis: "INFERRED",
    evidence: `Observed in https://gamevui.vn/games/services/score.min.js, loaded into every hosted game inspected (${MATRIX}, "Platform script behaviour"). Whether it is added to a submission is UNKNOWN.`,
    check: { kind: "auto", probes: ["e2e.wrapper_tolerance"] },
    note: "Simulates the observed behaviour locally. Loads no GameVui code.",
  },

  // --- Gameplay -----------------------------------------------------------------------
  {
    id: "GV-GAM-01",
    category: "Gameplay",
    requirement: "A round can be started, played to its end and restarted without reloading.",
    basis: "LOCAL",
    evidence: "Basic completeness; a portal reviewer sees a dead end otherwise.",
    check: { kind: "auto", probes: ["e2e.round_cycle"] },
  },
  {
    id: "GV-GAM-02",
    category: "Gameplay",
    requirement: "The game pauses while the tab is hidden and resumes where it was.",
    basis: "LOCAL",
    evidence: "Template rule (packages/game-core pause reasons).",
    check: { kind: "auto", probes: ["e2e.pause_hidden"] },
  },

  // --- UX -----------------------------------------------------------------------------
  {
    id: "GV-UX-01",
    category: "UX",
    requirement: "Developer-facing UX guidelines.",
    basis: "UNKNOWN",
    evidence: "Not published.",
    check: { kind: "measure", measures: [] },
  },
  {
    id: "GV-UX-02",
    category: "UX",
    requirement:
      'Health warning "Chơi quá 180 phút một ngày sẽ ảnh hưởng xấu đến sức khỏe" under every game frame.',
    basis: "OFFICIAL",
    evidence: `${TERMS} Phần 2 §2 — "Hệ thống sẽ hiển thị thông tin khuyến cáo … dưới mỗi khung hình chơi game"`,
    check: { kind: "platform" },
  },
  {
    id: "GV-UX-03",
    category: "UX",
    requirement: "Players under 18: at most 60 minutes per game and 180 minutes per day.",
    basis: "OFFICIAL",
    evidence: `${TERMS} Phần 2 §2; ${PRIVACY} §2 — "Hệ thống tự động quản lý thời gian chơi"`,
    check: { kind: "platform" },
  },
  {
    id: "GV-UX-04",
    category: "UX",
    requirement: "Visible loading feedback, cleared once the game is interactive.",
    basis: "INFERRED",
    evidence:
      "No loading API exists; a blank frame during load is what a player would otherwise see.",
    check: { kind: "auto", probes: ["e2e.loading_screen"] },
  },
  {
    id: "GV-UX-05",
    category: "UX",
    requirement:
      "Control instructions for computer and phone, in the game and in the submission text.",
    basis: "INFERRED",
    evidence: `Observed: each game page carries "Trên máy tính sử dụng … / Trên điện thoại chạm …" (${MATRIX}, "UX — control instructions")`,
    check: { kind: "auto", probes: ["static.controls_text"] },
  },

  // --- Content ------------------------------------------------------------------------
  {
    id: "GV-CON-01",
    category: "Content",
    requirement:
      "No pornographic, depraved, violent, gambling, drug or alcohol content; no false or defamatory information.",
    basis: "OFFICIAL",
    evidence: `${TERMS} Phần 1 §4 — "Truyền bá hình ảnh khiêu dâm, đồi trụy, bạo lực, cờ bạc, hoặc sử dụng ma túy, rượu bia" (written for users; applying it to games is inferred)`,
    check: {
      kind: "manual",
      instruction:
        "Play a full round and look at every screen. The demo is abstract shapes and UI text only.",
    },
  },
  {
    id: "GV-CON-02",
    category: "Content",
    requirement: "Any map of Vietnam shows national sovereignty correctly.",
    basis: "OFFICIAL",
    evidence: `${TERMS} Phần 1 §4 — "bản đồ Việt Nam không thể hiện hoặc thể hiện không đúng chủ quyền quốc gia"`,
    check: { kind: "manual", instruction: "Confirm the game shows no map. The demo has none." },
  },
  {
    id: "GV-CON-03",
    category: "Content",
    requirement: "No malware or code that damages or restricts software or hardware.",
    basis: "OFFICIAL",
    evidence: `${TERMS} Phần 1 §4 — "Tải lên, phát tán phần mềm độc hại, virus"`,
    check: {
      kind: "manual",
      instruction:
        "Review the dependency list (PixiJS only) and the e2e network audit. Absence of malware cannot be proven by a test.",
    },
  },
  {
    id: "GV-CON-04",
    category: "Content",
    requirement: "Every game carries an age rating of 00+, 12+, 16+ or 18+.",
    basis: "OFFICIAL",
    evidence: `${TERMS} Phần 2 §2 — "phân loại theo độ tuổi (00+, 12+, 16+, 18+)"`,
    check: { kind: "auto", probes: ["static.age_rating_valid"] },
    note: "Checks the demo's PROPOSED rating is one of the four. Who assigns the final rating is UNKNOWN.",
  },
  {
    id: "GV-CON-05",
    category: "Content",
    requirement:
      "Virtual items and points exist only inside the game, are never convertible to cash or goods, and are never traded between players.",
    basis: "OFFICIAL",
    evidence: `${TERMS} Phần 2 §3`,
    check: {
      kind: "manual",
      instruction: "Confirm the game has no virtual items. The demo has a score only.",
    },
  },

  // --- Ads & monetisation -------------------------------------------------------------
  {
    id: "GV-ADS-01",
    category: "Ads",
    requirement:
      "GameVui runs third-party ads, including a watch-an-ad-for-a-reward system — on its pages and, observed, inside hosted game frames through its own script.",
    basis: "OFFICIAL",
    evidence: `${TERMS} Phần 2 §5 — "bao gồm cả hệ thống xem quảng cáo nhận thưởng"`,
    check: { kind: "platform" },
  },
  {
    id: "GV-ADS-02",
    category: "Ads",
    requirement: "A developer-facing ad API, ad placement or frequency rules.",
    basis: "UNKNOWN",
    evidence: "Not published. The demo requests no ads.",
    check: { kind: "measure", measures: ["e2e.ads_requested"] },
  },
  {
    id: "GV-MON-01",
    category: "Monetization",
    requirement: "Revenue share, payment or IAP terms for developers.",
    basis: "UNKNOWN",
    evidence:
      "Not published. The advertising price list (support/bao-gia-quang-cao) is for advertisers, not developers.",
    check: { kind: "measure", measures: [] },
  },

  // --- Mobile / desktop ---------------------------------------------------------------
  {
    id: "GV-MOB-01",
    category: "Mobile",
    requirement: "Playable on a phone: touch steers, layout fits portrait and landscape.",
    basis: "INFERRED",
    evidence: `${ABOUT} — "hỗ trợ chơi game dễ dàng cả trên máy tính lẫn thiết bị di động" (a description of the service)`,
    check: { kind: "auto", probes: ["e2e.touch_steer", "e2e.layout_fits"] },
  },
  {
    id: "GV-MOB-02",
    category: "Mobile",
    requirement: "Playable on a tablet.",
    basis: "INFERRED",
    evidence: "As GV-MOB-01.",
    check: { kind: "auto", probes: ["e2e.tablet"] },
  },
  {
    id: "GV-DSK-01",
    category: "Desktop",
    requirement: "Playable on a computer with mouse and with keyboard.",
    basis: "INFERRED",
    evidence: "As GV-MOB-01.",
    check: { kind: "auto", probes: ["e2e.mouse_steer", "e2e.keyboard_steer"] },
  },

  // --- Performance --------------------------------------------------------------------
  {
    id: "GV-PRF-01",
    category: "Performance",
    requirement: "Maximum package size.",
    basis: "UNKNOWN",
    evidence: "Not published. The Factory profile's 50 MB has no GameVui source.",
    check: { kind: "measure", measures: ["static.size_bytes", "package.zip_bytes"] },
  },
  {
    id: "GV-PRF-02",
    category: "Performance",
    requirement: "Minimum frame rate / low-end device support.",
    basis: "UNKNOWN",
    evidence:
      "Not published. The Factory profile's 30 fps on low-end Android has no GameVui source.",
    check: { kind: "measure", measures: ["e2e.fps"] },
  },
  {
    id: "GV-PRF-03",
    category: "Performance",
    requirement: "Maximum load time.",
    basis: "UNKNOWN",
    evidence: "Not published.",
    check: { kind: "measure", measures: ["e2e.time_to_interactive_ms"] },
  },

  // --- Metadata -----------------------------------------------------------------------
  {
    id: "GV-MET-01",
    category: "Metadata",
    requirement: "Required metadata, screenshots, icon.",
    basis: "UNKNOWN",
    evidence:
      "Not published. No screenshots or icon are packaged because none is documented as required.",
    check: { kind: "measure", measures: [] },
  },
  {
    id: "GV-MET-02",
    category: "Metadata",
    requirement:
      "Vietnamese and English title, description and control text prepared for the submission email.",
    basis: "INFERRED",
    evidence: `Observed: a game page shows a Vietnamese title with the English one in parentheses, a description and controls (${MATRIX})`,
    check: { kind: "auto", probes: ["static.metadata_complete"] },
  },
  {
    id: "GV-MET-03",
    category: "Metadata",
    requirement: "Vietnamese strings ship in the package and are the default.",
    basis: "INFERRED",
    evidence: "gamevui.vn is Vietnamese-only (observed). No published language rule.",
    check: { kind: "auto", probes: ["static.locales", "e2e.vi_default"] },
  },
  {
    id: "GV-MET-04",
    category: "Metadata",
    requirement: "Developer name and contact email filled in for the submission.",
    basis: "INFERRED",
    evidence: "The operator can only answer a submission it can reply to.",
    check: {
      kind: "manual",
      instruction:
        "Fill developer.name and developer.email in gamevui.submission.json before sending. Left null in the repository on purpose.",
    },
  },

  // --- Privacy ------------------------------------------------------------------------
  {
    id: "GV-PRV-01",
    category: "Privacy",
    requirement:
      "Account verification (name, date of birth, Vietnamese mobile number), data retention and third-party ad cookies are handled by GameVui.",
    basis: "OFFICIAL",
    evidence: `${PRIVACY} §1, §5, §6; ${TERMS} Phần 1 §1`,
    check: { kind: "platform" },
  },
  {
    id: "GV-PRV-02",
    category: "Privacy",
    requirement: "What data a submitted game may collect.",
    basis: "UNKNOWN",
    evidence: "Not published.",
    check: { kind: "measure", measures: [] },
  },
  {
    id: "GV-PRV-03",
    category: "Privacy",
    requirement:
      "The game collects no personal data, sets no cookies, and stores only its best score locally.",
    basis: "LOCAL",
    evidence: "gamevui.submission.json content_declaration.",
    check: { kind: "auto", probes: ["e2e.no_personal_data"] },
  },

  // --- Copyright ----------------------------------------------------------------------
  {
    id: "GV-CPY-01",
    category: "Copyright",
    requirement: "Licence terms a developer grants GameVui for a submitted game.",
    basis: "UNKNOWN",
    evidence: `Not published. ${TERMS} Phần 2 §4 covers IP in the service itself, not developer licensing.`,
    check: { kind: "measure", measures: [] },
  },
  {
    id: "GV-CPY-02",
    category: "Copyright",
    requirement:
      "The package contains no image, font, audio or video files whose origin would need vouching for.",
    basis: "LOCAL",
    evidence: "gamevui.submission.json rights.",
    check: { kind: "auto", probes: ["static.asset_inventory"] },
  },
  {
    id: "GV-CPY-03",
    category: "Copyright",
    requirement: "The submitter holds the rights to everything in the package.",
    basis: "INFERRED",
    evidence: `${TERMS} Phần 2 §4 — IP in the service belongs to "GameVui.vn và bên cấp phép" (its licensors), which a submitter becomes.`,
    check: {
      kind: "manual",
      instruction: "Confirm ownership / licences. The demo: own code (MIT) plus PixiJS (MIT).",
    },
  },
];

/**
 * Turn a requirement and what the probes found into a status.
 *
 * This is where "never convert UNKNOWN into PASS" is enforced: a requirement with basis
 * UNKNOWN is UNKNOWN whatever its probes say, and a measure is never a verdict.
 *
 * @param {(typeof REQUIREMENTS)[number]} requirement
 * @param {Record<string, { ok: boolean }>} probes
 * @returns {"PASSED"|"FAILED"|"NOT_RUN"|"MANUAL_REQUIRED"|"NOT_APPLICABLE"|"UNKNOWN"}
 */
export function resolveStatus(requirement, probes) {
  if (requirement.basis === "UNKNOWN") return "UNKNOWN";
  const { check } = requirement;
  switch (check.kind) {
    case "platform":
      return "NOT_APPLICABLE";
    case "manual":
      return "MANUAL_REQUIRED";
    case "measure":
      // A measure with a known basis is a contradiction; refuse to turn it into a verdict.
      return "UNKNOWN";
    case "auto": {
      const results = check.probes.map((name) => probes[name]);
      if (results.some((result) => result === undefined)) return "NOT_RUN";
      return results.every((result) => result.ok) ? "PASSED" : "FAILED";
    }
    default:
      throw new Error(`${requirement.id}: unknown check kind ${String(check.kind)}`);
  }
}
