// The template's default integration plan: no placements.
//
// The Factory's `sdk` workflow step regenerates THIS FILE ONLY, from the title's game-design
// (placements, their moments, per-portal adapter substitutes). It is data: main.ts, the
// gameplay layer and the game read it, and nothing in the template has to change when it
// does. With no placements every rewarded offer is hidden and every natural break is a
// no-op, except where a target asks for an opportunity before each continue.

import type { IntegrationPlan } from "./gameplay.js";

export const INTEGRATION_PLAN: IntegrationPlan = {
  titleId: "web-game-template",
  placements: [],
  adapterSubstitutes: {},
  breakOnContinue: [],
};
