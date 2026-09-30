import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const apiRoot = join(root, "libs/api-client");
const swaggerPath = join(apiRoot, "swagger.json");

function runTypings(args) {
  const result = spawnSync(
    "yarn",
    ["workspace", "@xbto/api-client", "typings", ...args],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    `typings failed:\n${result.stdout}\n${result.stderr}`,
  );
}

test("typings regenerates in-place from committed swagger (no fixture folders)", () => {
  const previous = readFileSync(swaggerPath, "utf8");
  try {
    writeFileSync(
      swaggerPath,
      `${JSON.stringify(
        {
          openapi: "3.0.1",
          info: { title: "Stablehouse Public", version: "v1-test" },
          paths: {
            "/v1/account/tag/get": {
              get: {
                operationId: "GetTag",
                summary: "Get account tag",
                responses: { 200: { description: "OK" } },
              },
            },
            "/v1/legacy/removed": {
              get: {
                operationId: "LegacyRemoved",
                deprecated: true,
                responses: { 200: { description: "OK" } },
              },
            },
          },
          components: {
            schemas: {
              AccountTag: {
                type: "object",
                properties: {
                  tag: { type: "string" },
                  balanceDecimal: { type: "string" },
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    runTypings([
      "--url=https://api.sbleho-dev.com/swagger/v1/swagger.json",
      "--skipFetchSwagger=true",
    ]);

    assert.equal(existsSync(join(apiRoot, "swagger-curated.json")), true);
    assert.equal(existsSync(join(apiRoot, "src/api.js")), true);
    assert.equal(existsSync(join(apiRoot, "fixtures")), false);

    const api = readFileSync(join(apiRoot, "src/api.js"), "utf8");
    assert.match(api, /v1-test/);
    assert.match(api, /GetTag/);
    assert.doesNotMatch(api, /LegacyRemoved/);
    assert.doesNotMatch(api, /balanceDecimal/);

    const curated = JSON.parse(
      readFileSync(join(apiRoot, "swagger-curated.json"), "utf8"),
    );
    assert.equal(curated.paths["/v1/legacy/removed"], undefined);
  } finally {
    writeFileSync(swaggerPath, previous, "utf8");
    runTypings([
      "--url=https://api.sbleho-dev.com/swagger/v1/swagger.json",
      "--skipFetchSwagger=true",
    ]);
  }
});
