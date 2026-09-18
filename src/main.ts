import "./styles.css";
import { Game } from "./game/Game";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const hudRoot = document.querySelector<HTMLDivElement>("#hud-root");
const mainMenuRoot = document.querySelector<HTMLDivElement>("#main-menu-root");

if (!canvas || !hudRoot || !mainMenuRoot) {
  throw new Error("Game bootstrap failed: canvas, HUD root or main menu root is missing.");
}

const game = new Game(canvas, hudRoot, mainMenuRoot);
if (import.meta.env.DEV) {
  (window as Window & { __aiWorldDebug?: Game }).__aiWorldDebug = game;
}
void game.start();
