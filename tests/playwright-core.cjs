const path = require("node:path");

const candidates = [
  process.env.PLAYWRIGHT_CORE_PATH,
  path.join(process.cwd(), "node_modules", "playwright-core"),
  path.join(__dirname, "..", "node_modules", "playwright-core"),
].filter(Boolean);

let playwrightCore;
let lastError;
for (const candidate of candidates) {
  try {
    playwrightCore = require(candidate);
    break;
  } catch (error) {
    lastError = error;
  }
}

if (!playwrightCore) {
  throw new Error(
    "Playwright Core is not available. Install playwright-core or set PLAYWRIGHT_CORE_PATH before running browser acceptance scripts.",
    { cause: lastError },
  );
}

module.exports = playwrightCore;
