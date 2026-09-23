// Poki compliance demo — boot and flow.
//
//   loading -> title --first input--> playing <-> paused
//                                        |
//                                      death
//                                        v
//                                    game over --Play again--> commercial break -> playing
//                                              --🎬 Revive---> rewarded break --reward--> playing
//
// Each arrow that matters to Poki goes through GameSession, which is the only thing that
// talks to the platform. This file constructs the Poki adapter — it is the composition
// root of a Poki-only build — and from then on sees only the Platform interface; nothing
// in the demo calls the Poki SDK.
//
// Constructed directly rather than through createPlatform(id): the registry names every
// portal the template knows, and a Poki build must not carry other portals' names.
//
// The #hud element's data attributes mirror the state. The Playwright suite reads them —
// they are a few strings on an element that is already on screen, not a debug build.

// Pixi generates shader-sync code with `new Function` unless this is loaded. A portal
// iframe's Content-Security-Policy may forbid eval; this keeps rendering independent of it.
import "pixi.js/unsafe-eval";
import { Game } from "@wgf/game-core";
import { PixiRenderer } from "@wgf/pixi-framework";
import { PokiPlatform, type Platform } from "@wgf/platform-sdk";
import { Sound } from "./audio.js";
import { DodgeScene } from "./dodge-scene.js";
import { Controls, detectScheme } from "./input.js";
import { layoutFor, type WorldLayout } from "./layout.js";
import { loadSave, writeSave, type SaveData } from "./save.js";
import { GameSession } from "./session.js";

type State = "loading" | "title" | "playing" | "paused" | "gameover";

const GAME_ID = "poki-compliance-demo";

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html is missing #${id}`);
  return found as T;
}

const ui = {
  game: element("game"),
  hud: element("hud"),
  score: element("score"),
  best: element("best"),
  pauseButton: element<HTMLButtonElement>("pause-button"),
  touchControls: element("touch-controls"),
  touchLeft: element("touch-left"),
  touchRight: element("touch-right"),
  toast: element("toast"),
  loading: element("loading"),
  loadingBar: element("loading-bar").firstElementChild as HTMLElement,
  title: element("title"),
  controlsHint: element("controls-hint"),
  play: element<HTMLButtonElement>("play"),
  saveNotice: element("save-notice"),
  paused: element("paused"),
  resume: element<HTMLButtonElement>("resume"),
  gameover: element("gameover"),
  finalScore: element("final-score"),
  restart: element<HTMLButtonElement>("restart"),
  revive: element<HTMLButtonElement>("revive"),
};

/** Everything the player can interact with that belongs to the game rather than to Poki. */
const gameNodes = [ui.game, ui.hud, ui.touchControls, ui.loading, ui.title, ui.paused, ui.gameover];

async function main(): Promise<void> {
  const poki = new PokiPlatform({ namespace: GAME_ID });
  const platform: Platform = poki;
  const progress = (fraction: number): void => {
    platform.reportLoadingProgress(fraction);
    ui.loadingBar.style.width = `${Math.round(fraction * 100)}%`;
  };

  // The SDK connects while the game loads, not before it: waiting on it first would put
  // the whole SDK deadline in front of the loading work when an ad blocker stalls it.
  const initializing = platform.initialize();

  let save: SaveData = await loadSave(platform.storage);
  ui.hud.dataset["persistent"] = String(platform.storage.persistent !== false);
  ui.saveNotice.hidden = platform.storage.persistent !== false;
  progress(0.5);

  const renderer = new PixiRenderer();
  await renderer.init({
    container: ui.game,
    width: ui.game.clientWidth || window.innerWidth,
    height: ui.game.clientHeight || window.innerHeight,
    background: 0x14161f,
  });
  progress(0.8);

  const game = new Game();
  const sound = new Sound();
  let state: State = "loading";
  let revivedThisRun = false;
  let layout: WorldLayout = layoutFor(ui.game.clientWidth, ui.game.clientHeight);

  const setState = (next: State): void => {
    state = next;
    ui.hud.dataset["state"] = next;
    ui.loading.dataset["open"] = String(next === "loading");
    ui.title.dataset["open"] = String(next === "title");
    ui.paused.dataset["open"] = String(next === "paused");
    ui.gameover.dataset["open"] = String(next === "gameover");
    ui.pauseButton.hidden = next !== "playing";
    if (next !== "playing") controls.release();
  };

  const reflectAudio = (): void => {
    ui.hud.dataset["audio"] = sound.state;
  };

  const session = new GameSession(game, platform, {
    mute: () => {
      sound.mute();
      reflectAudio();
    },
    unmute: () => {
      sound.unmute();
      reflectAudio();
    },
    onAdChange: (kind) => {
      ui.hud.dataset["ad"] = kind;
      // Nothing of the game's can be pressed while an ad runs. Only the game's own nodes
      // go inert, never <body>: Poki's SDK draws its ad inside this document, and its
      // controls — tap to play, close, the rewarded continue — must stay usable.
      for (const node of gameNodes) node.inert = kind !== "none";
    },
  });

  const controls = new Controls({
    enabled: () => session.inputEnabled,
    onPause: () => {
      if (state === "playing") pause();
      else if (state === "paused") void resume();
    },
  });

  const scene = new DodgeScene({
    stage: renderer.stage,
    input: () => ({
      axis: controls.axis,
      targetX:
        controls.pointerX === null ? null : (controls.pointerX - layout.offsetX) / layout.scale,
    }),
    onScore: (score) => {
      ui.score.textContent = String(score);
      ui.hud.dataset["score"] = String(score);
      if (score > 0 && score % 10 === 0) sound.blip(880);
    },
    onDeath: (score) => void die(score),
    onMove: (x) => (ui.hud.dataset["playerX"] = String(x)),
  });

  const saveProgress = async (score: number): Promise<void> => {
    save = { version: 1, best: Math.max(save.best, score), runs: save.runs + 1 };
    ui.best.textContent = String(save.best);
    ui.hud.dataset["best"] = String(save.best);
    ui.hud.dataset["runs"] = String(save.runs);
    await writeSave(platform.storage, save);
  };

  const toast = (text: string): void => {
    ui.toast.textContent = text;
    ui.toast.dataset["visible"] = "true";
    setTimeout(() => (ui.toast.dataset["visible"] = "false"), 1500);
  };

  // Startup: gameLoadingFinished -> (first input) -> gameplayStart.
  const play = (): void => {
    if (state !== "title") return;
    sound.unlock();
    reflectAudio();
    revivedThisRun = false;
    scene.reset();
    setState("playing");
    session.startGameplay();
  };

  const pause = (): void => {
    if (state !== "playing") return;
    setState("paused");
    game.pause("manual");
    session.stopGameplay();
  };

  // Pause/unpause: gameplayStop -> commercialBreak -> gameplayStart.
  const resume = async (): Promise<void> => {
    if (state !== "paused" || !session.inputEnabled) return;
    await session.commercialBreakThen(() => {
      game.resume("manual");
      setState("playing");
    });
  };

  const die = async (score: number): Promise<void> => {
    session.stopGameplay();
    sound.blip(160, 0.3);
    ui.finalScore.textContent = String(score);
    ui.revive.hidden = revivedThisRun;
    setState("gameover");
    await saveProgress(score);
  };

  // Death/restart: gameplayStop -> commercialBreak -> gameplayStart.
  const restart = async (): Promise<void> => {
    if (state !== "gameover" || !session.inputEnabled) return;
    await session.commercialBreakThen(() => {
      revivedThisRun = false;
      scene.reset();
      setState("playing");
    });
  };

  // Revive: gameplayStop -> rewardedBreak -> gameplayStart, and only on Poki's reward.
  const revive = async (): Promise<void> => {
    if (state !== "gameover" || revivedThisRun || !session.inputEnabled) return;
    const rewarded = await session.rewardedBreak();
    if (!rewarded) {
      // No reward, no revive. Poki handles ad-blocker messaging itself, so the game says
      // nothing about why; the offer is simply withdrawn and Play again remains.
      ui.revive.hidden = true;
      return;
    }
    revivedThisRun = true;
    ui.hud.dataset["revives"] = String(Number(ui.hud.dataset["revives"] ?? "0") + 1);
    scene.revive();
    setState("playing");
    session.startGameplay();
    sound.blip(660, 0.2);
    toast("Revived!");
  };

  ui.play.addEventListener("click", play);
  ui.resume.addEventListener("click", () => void resume());
  ui.pauseButton.addEventListener("click", pause);
  ui.restart.addEventListener("click", () => void restart());
  ui.revive.addEventListener("click", () => void revive());
  // Any first key starts the game from the title too — Poki wants players in fast.
  window.addEventListener("keydown", (event) => {
    if (state === "title" && (event.key === "Enter" || event.key === " ")) play();
  });

  // A hidden tab pauses like Esc does, and returning leaves the player on the pause panel
  // rather than dropping them back into a run they cannot see starting.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      pause();
      game.pause("hidden");
      sound.mute();
    } else {
      game.resume("hidden");
      sound.unmute();
    }
    reflectAudio();
  });

  const scheme = detectScheme();
  ui.hud.dataset["scheme"] = scheme;
  ui.touchControls.dataset["visible"] = String(scheme === "touch");
  ui.controlsHint.textContent =
    scheme === "touch" ? "Hold ◀ ▶ or drag to move." : "Move with ← → or A D. Esc to pause.";
  controls.attach(ui.game, ui.touchLeft, ui.touchRight);

  const fit = (): void => {
    const width = ui.game.clientWidth || window.innerWidth;
    const height = ui.game.clientHeight || window.innerHeight;
    renderer.resize(width, height);
    layout = layoutFor(width, height);
    scene.resize(layout);
    ui.hud.dataset["world"] = `${layout.width}x${layout.height}`;
    ui.hud.dataset["viewport"] = `${width}x${height}`;
  };
  new ResizeObserver(fit).observe(ui.game);
  window.addEventListener("orientationchange", fit);

  await game.changeScene(scene);
  fit();
  ui.best.textContent = String(save.best);
  ui.hud.dataset["best"] = String(save.best);
  ui.hud.dataset["runs"] = String(save.runs);
  ui.hud.dataset["ad"] = "none";
  reflectAudio();

  await initializing;
  ui.hud.dataset["sdk"] = poki.sdkState;
  progress(1);
  await platform.signalReady(); // gameLoadingFinished
  game.start();
  setState("title");
  ui.play.focus();
}

void main().catch((error: unknown) => {
  // A visible failure beats a black screen for a reviewer and a player alike.
  ui.hud.dataset["state"] = "error";
  ui.loading.dataset["open"] = "true";
  const message = document.createElement("p");
  message.textContent = "Something went wrong. Please reload.";
  ui.loading.querySelector(".panel")?.appendChild(message);
  console.error(error);
});
