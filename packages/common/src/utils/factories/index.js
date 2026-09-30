/**
 * Env-stable factories (demo) — main / prod tip.
 *
 * Prod enrich factory comments out couponPercent, paymentFrequency, bidSpread,
 * askSpread (MISC #2439). Release restore pulls this tree from origin/main.
 */

export {
  ENV_STABLE_MARKER,
  mapTradableCurrenciesToEnrichedAccountDetailAssets,
} from "./enrich-trade-currency-to-account-detail-asset.js";
