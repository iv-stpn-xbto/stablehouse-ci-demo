/**
 * Env-stable demo factories — restored from the destination permanent branch
 * after API client swagger sync (see ENV_STABLE_PATHS in scripts/release/lib.mjs).
 */
export const ENV_STABLE_MARKER = "develop";

export function createDemoAccount(overrides = {}) {
  return {
    id: "acct_demo",
    environment: ENV_STABLE_MARKER,
    ...overrides,
  };
}
