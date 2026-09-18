import assert from "node:assert/strict";
import test from "node:test";
import { chunkWindowForCenter, chunkWindowSize, reconcilePendingChunks } from "../src/game/world/ChunkStreaming.ts";

test("chunk window uses a unique square around the player chunk", () => {
  const window = chunkWindowForCenter(0, 0, 2);
  assert.equal(window.length, 25);
  assert.equal(new Set(window.map((entry) => `${entry.cx}:${entry.cz}`)).size, 25);
  assert.deepEqual(window[0], { cx: 0, cz: 0, distanceSquared: 0, manhattanDistance: 0 });
  assert.equal(chunkWindowSize(6), 169);
});

test("pending chunk queue deduplicates and removes chunks outside the wanted window", () => {
  const pending = [{ cx: 0, cz: 1 }, { cx: 0, cz: 1 }, { cx: 5, cz: 5 }];
  const result = reconcilePendingChunks(pending, chunkWindowForCenter(0, 0, 1), new Set());
  assert.deepEqual(result.map((entry) => `${entry.cx}:${entry.cz}`), ["0:1"]);
});
