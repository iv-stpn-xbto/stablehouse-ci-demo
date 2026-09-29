import test from "node:test";
import assert from "node:assert/strict";
import { renderPage as renderWeb } from "../apps/web/src/render.js";

test("web app consumes the shared utility", () => {
  assert.match(renderWeb(), /Environment: Demo/);
  assert.match(renderWeb("production"), /Environment: Production/);
});
