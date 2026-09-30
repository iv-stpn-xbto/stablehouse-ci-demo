/**
 * Env-stable factories (demo).
 *
 * This directory is listed in `ENV_STABLE_PATHS`. After swagger typings sync,
 * release CI restores it from `origin/main` (release) or `origin/develop`
 * (backmerge) so env-specific enrich adaptations are not wiped.
 *
 * Showcase file: `enrich-trade-currency-to-account-detail-asset.js`
 * — develop maps couponPercent / paymentFrequency / bidSpread / askSpread
 * — main comments those out (prod types, MISC #2439)
 */

export {
  ENV_STABLE_MARKER,
  mapTradableCurrenciesToEnrichedAccountDetailAssets,
} from "./enrich-trade-currency-to-account-detail-asset.js";
