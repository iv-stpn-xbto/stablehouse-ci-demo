#!/usr/bin/env node
/**
 * Demo typings pipeline mirroring libs/api-client in the front-end monorepo:
 * fetch swagger → curate (drop deprecated paths / *Decimal props) → generate src/api.js.
 *
 * Uses the same typings:dev / typings:prod URLs as production. When those hosts
 * are unreachable (local CI demo), falls back to committed fixtures under
 * fixtures/{dev,prod}/swagger.json so release sync still produces a real diff.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SWAGGER = join(root, "swagger.json");
const CURATED = join(root, "swagger-curated.json");
const API_OUT = join(root, "src", "api.js");

const FIXTURE_BY_URL = Object.freeze({
  "https://api.sbleho-dev.com/swagger/v1/swagger.json": join(
    root,
    "fixtures/dev/swagger.json",
  ),
  "https://api.maisonstable.io/swagger/v1/swagger.json": join(
    root,
    "fixtures/prod/swagger.json",
  ),
});

function parseArgs(argv) {
  let url;
  let skipFetchSwagger = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--url" || token === "-u") {
      url = argv[++i];
      continue;
    }
    if (token.startsWith("--url=")) {
      url = token.slice("--url=".length);
      continue;
    }
    if (token === "--skipFetchSwagger" || token === "-s") {
      const value = argv[i + 1];
      if (value && !value.startsWith("-")) {
        skipFetchSwagger = value !== "false";
        i += 1;
      } else {
        skipFetchSwagger = true;
      }
      continue;
    }
    if (token.startsWith("--skipFetchSwagger=")) {
      skipFetchSwagger = token.slice("--skipFetchSwagger=".length) !== "false";
      continue;
    }
    throw new TypeError(`Unknown argument: ${token}`);
  }
  if (!url) throw new TypeError("Usage: typings.mjs --url <swagger-url>");
  return { url, skipFetchSwagger };
}

function fetchSwagger(url) {
  const fixture = FIXTURE_BY_URL[url];
  // Demo fixtures win by default so release/backmerge produce a small, reliable
  // prod↔dev diff without committing the full Stablehouse OpenAPI document.
  // Set TYPINGS_FETCH=1 to curl the live URL instead (MISC-identical path).
  if (fixture && process.env.TYPINGS_FETCH !== "1") {
    console.info(
      `Using demo fixture for ${url} → ${fixture.replace(`${root}/`, "")}`,
    );
    copyFileSync(fixture, SWAGGER);
    return;
  }

  const curl = spawnSync("curl", ["-fsSL", url, "-o", SWAGGER], {
    encoding: "utf8",
  });
  if (curl.status === 0) {
    console.info(`Fetched swagger from ${url}`);
    return;
  }
  if (fixture) {
    console.info(
      `Fetch failed for ${url}; falling back to demo fixture ${fixture.replace(`${root}/`, "")}`,
    );
    copyFileSync(fixture, SWAGGER);
    return;
  }
  throw new Error(
    `Failed to fetch swagger from ${url}.\n${curl.stderr || curl.stdout || ""}`,
  );
}

function deleteDeprecationsInPaths(paths) {
  const result = {};
  for (const [path, methods] of Object.entries(paths ?? {})) {
    const kept = {};
    for (const [method, operation] of Object.entries(methods ?? {})) {
      if (operation?.deprecated === true) {
        console.info(`Removing > deprecated endpoint: ${path} ${method}`);
        continue;
      }
      kept[method] = operation;
    }
    if (Object.keys(kept).length > 0) result[path] = kept;
  }
  return result;
}

function curateSchemas(schemas) {
  const result = {};
  for (const [schemaKey, schemaValue] of Object.entries(schemas ?? {})) {
    if (!schemaValue?.properties) {
      result[schemaKey] = schemaValue;
      continue;
    }
    const properties = {};
    for (const [propName, propValue] of Object.entries(schemaValue.properties)) {
      if (propName.endsWith("Decimal")) {
        console.info(`Removing internal property: ${schemaKey} ${propName}`);
        continue;
      }
      if (propValue?.deprecated === true) {
        console.info(`Marking > deprecated property: ${schemaKey}.${propName}`);
        properties[`deprecated.${propName}`] = propValue;
        continue;
      }
      properties[propName] = propValue;
    }
    result[schemaKey] = { ...schemaValue, properties };
  }
  return result;
}

function curateSwagger(raw) {
  return {
    ...raw,
    paths: deleteDeprecationsInPaths(raw.paths),
    components: {
      ...(raw.components ?? {}),
      schemas: curateSchemas(raw.components?.schemas),
    },
  };
}

function generateApiJs(curated) {
  const version = curated.info?.version ?? "unknown";
  const title = curated.info?.title ?? "API";
  const operations = [];
  for (const [path, methods] of Object.entries(curated.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      operations.push({
        path,
        method: method.toUpperCase(),
        operationId: operation.operationId ?? `${method}_${path}`,
        summary: operation.summary ?? "",
      });
    }
  }
  operations.sort((a, b) => a.operationId.localeCompare(b.operationId));

  const methodLines = operations
    .map(
      (op) =>
        `  /** ${op.summary} */\n  ${op.operationId}() {\n    return this.request("${op.method}", "${op.path}");\n  }`,
    )
    .join("\n\n");

  const schemaNames = Object.keys(curated.components?.schemas ?? {}).sort();
  const schemaLines = schemaNames
    .map((name) => {
      const schema = curated.components.schemas[name];
      const props = Object.keys(schema.properties ?? {});
      const fields = props.map((prop) => {
        const optional = prop.startsWith("deprecated.");
        const field = optional ? prop.slice("deprecated.".length) : prop;
        return optional
          ? `  // @deprecated\n  ${JSON.stringify(field)}`
          : `  ${JSON.stringify(field)}`;
      });
      return `/** Schema: ${name} */\nexport const ${name}Fields = [\n${fields.join(",\n")}\n];`;
    })
    .join("\n\n");

  return `/* Auto-generated by scripts/typings.mjs — do not edit. */
/* Source: ${title} (${version}) */

export const API_INFO = {
  title: ${JSON.stringify(title)},
  version: ${JSON.stringify(version)},
  operationIds: ${JSON.stringify(operations.map((op) => op.operationId))},
};

export class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  request(method, path) {
    return fetch(new URL(path, this.baseUrl), { method }).then((r) => r.json());
  }

${methodLines}
}

${schemaLines}
`;
}

function main() {
  const { url, skipFetchSwagger } = parseArgs(process.argv.slice(2));
  console.info(
    `Typings info: url: ${url}, skipFetchSwagger: ${Boolean(skipFetchSwagger)}`,
  );

  if (!skipFetchSwagger) {
    fetchSwagger(url);
  }

  const raw = JSON.parse(readFileSync(SWAGGER, "utf8"));
  const curated = curateSwagger(raw);
  writeFileSync(CURATED, `${JSON.stringify(curated, null, 2)}\n`, "utf8");

  mkdirSync(dirname(API_OUT), { recursive: true });
  writeFileSync(API_OUT, generateApiJs(curated), "utf8");
  console.info("Task complete: api: typings");
}

try {
  main();
} catch (error) {
  console.error(error.message ?? error);
  process.exitCode = 1;
}
