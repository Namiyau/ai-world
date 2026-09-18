import assert from "node:assert/strict";
import test from "node:test";
import { loadMainMenuSettings } from "../src/game/ui/MainMenu";

function storageWith(value: string | null): Storage {
  const values = new Map<string, string>();
  if (value !== null) values.set("ai-world-settings-v1", value);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, item) => values.set(key, item),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

test("main menu settings use safe defaults when storage is empty or malformed", () => {
  assert.deepEqual(loadMainMenuSettings(storageWith(null)), { reducedMotion: false, showHints: true });
  assert.deepEqual(loadMainMenuSettings(storageWith("not-json")), { reducedMotion: false, showHints: true });
});

test("main menu settings preserve explicit boolean preferences", () => {
  assert.deepEqual(loadMainMenuSettings(storageWith(JSON.stringify({ reducedMotion: true, showHints: false }))), {
    reducedMotion: true,
    showHints: false,
  });
});
