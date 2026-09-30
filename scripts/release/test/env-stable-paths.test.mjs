import test from "node:test";
import assert from "node:assert/strict";
import {
  ENV_STABLE_PATHS,
  ENV_STABLE_SOURCE_REFS,
  assertEnvStablePaths,
  assertEnvStableSourceRef,
  envStableRestoreCommitMessage,
} from "../lib.mjs";

test("ENV_STABLE_PATHS includes factories", () => {
  assert.ok(
    ENV_STABLE_PATHS.includes("packages/common/src/utils/factories"),
  );
  assert.equal(assertEnvStablePaths(), ENV_STABLE_PATHS);
});

test("assertEnvStableSourceRef allowlists only origin/main and origin/develop", () => {
  assert.deepEqual([...ENV_STABLE_SOURCE_REFS], [
    "origin/main",
    "origin/develop",
  ]);
  assert.equal(assertEnvStableSourceRef("origin/main"), "origin/main");
  assert.equal(assertEnvStableSourceRef("origin/develop"), "origin/develop");
  assert.throws(
    () => assertEnvStableSourceRef("origin/feature/x"),
    /origin\/main or origin\/develop/,
  );
  assert.throws(
    () => assertEnvStableSourceRef("main"),
    /origin\/main or origin\/develop/,
  );
  assert.throws(
    () => assertEnvStableSourceRef("../evil"),
    /origin\/main or origin\/develop/,
  );
  assert.throws(
    () => assertEnvStableSourceRef("origin/main\n"),
    /origin\/main or origin\/develop/,
  );
  assert.throws(
    () => assertEnvStableSourceRef(""),
    /origin\/main or origin\/develop/,
  );
  assert.throws(
    () => assertEnvStableSourceRef(undefined),
    /origin\/main or origin\/develop/,
  );
});

test("assertEnvStablePaths rejects absolute, empty, and parent segments", () => {
  assert.throws(() => assertEnvStablePaths([]), /non-empty/);
  assert.throws(() => assertEnvStablePaths(["/abs/path"]), /relative/);
  assert.throws(() => assertEnvStablePaths(["../evil"]), /relative/);
  assert.throws(() => assertEnvStablePaths(["foo/../bar"]), /relative/);
  assert.throws(() => assertEnvStablePaths(["foo//bar"]), /relative/);
  assert.throws(() => assertEnvStablePaths([""]), /non-empty string/);
  assert.throws(() => assertEnvStablePaths(["ok\\win"]), /relative/);
  assert.deepEqual(assertEnvStablePaths(["a/b", "c"]), ["a/b", "c"]);
});

test("envStableRestoreCommitMessage derives branch name from source ref", () => {
  assert.equal(
    envStableRestoreCommitMessage("origin/main"),
    "Restore env-stable paths from main",
  );
  assert.equal(
    envStableRestoreCommitMessage("origin/develop"),
    "Restore env-stable paths from develop",
  );
  assert.throws(
    () => envStableRestoreCommitMessage("origin/other"),
    /origin\/main or origin\/develop/,
  );
});
