import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const apiRoot = join(root, "libs/api-client");

function runTypings(script) {
  const result = spawnSync("yarn", ["workspace", "@xbto/api-client", script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `${script} failed:\n${result.stdout}\n${result.stderr}`,
  );
}

test("typings:dev and typings:prod regenerate divergent api clients", () => {
  runTypings("typings:dev");
  assert.equal(existsSync(join(apiRoot, "swagger.json")), true);
  assert.equal(existsSync(join(apiRoot, "swagger-curated.json")), true);
  const devApi = readFileSync(join(apiRoot, "src/api.js"), "utf8");
  assert.match(devApi, /v1-dev/);
  assert.match(devApi, /GetDevOnly/);
  assert.doesNotMatch(devApi, /GetProdOnly/);
  assert.doesNotMatch(devApi, /LegacyRemoved/);
  assert.doesNotMatch(devApi, /balanceDecimal/);

  runTypings("typings:prod");
  const prodApi = readFileSync(join(apiRoot, "src/api.js"), "utf8");
  assert.match(prodApi, /v1-prod/);
  assert.match(prodApi, /GetProdOnly/);
  assert.doesNotMatch(prodApi, /GetDevOnly/);

  assert.notEqual(devApi, prodApi);
});
