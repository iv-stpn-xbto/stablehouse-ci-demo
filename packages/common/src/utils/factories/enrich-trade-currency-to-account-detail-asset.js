/**
 * Demo extract of MISC `enrich-trade-currency-to-account-detail-asset`.
 *
 * Real history (SHF / #2439 — "fix production types in store"):
 * - develop (before prod backmerge): couponPercent, paymentFrequency, bidSpread,
 *   askSpread are mapped from the currency swagger shape.
 * - main / prod: those fields are commented out because prod swagger / generated
 *   types do not include them.
 *
 * Release CI restores this tree from the destination permanent branch after
 * API client sync (`ENV_STABLE_PATHS` → `restoreEnvStablePaths`).
 *
 * Source: packages/common/src/utils/factories/enrich-trade-currency-to-account-detail-asset.tsx
 * Pre-fix tip: e09784a4f^  |  Prod fix: e09784a4f
 */

/** @typedef {{ code?: string, name?: string, availableSupply?: unknown, couponFee?: unknown, couponPercent?: unknown, paymentFrequency?: unknown, bidSpread?: unknown, askSpread?: unknown, decimals?: number, pricePrecision?: number, displayCode?: string, blockchain?: unknown, underlyingCurrencyCode?: string, underlyingCurrencyName?: string, explorerUrl?: string, blockchainAssetId?: string, type?: string, isStablecoin?: boolean }} DemoCurrency */

/**
 * Map tradable currencies into the enriched account-detail asset currency bag.
 * Prod/main shape — coupon/spread fields omitted to match prod swagger types.
 *
 * @param {DemoCurrency[]} ccys
 * @returns {Array<{ currency: Record<string, unknown> }>}
 */
export function mapTradableCurrenciesToEnrichedAccountDetailAssets(ccys) {
  return (ccys ?? [])
    .filter((ccy) => ccy?.code && ccy?.name)
    .map((ccy) => ({
      currency: {
        withdrawalsAllowed: false,
        depositsAllowed: false,
        tradingAllowed: true,
        apy: 0,
        isDefaultFiatConversion: false,
        allowFiatConversion: false,
        availableSupply: ccy.availableSupply ?? null,
        couponFee: ccy.couponFee ?? null,
        // couponPercent: ccy.couponPercent ?? null,
        // paymentFrequency: ccy.paymentFrequency ?? null,
        // bidSpread: ccy.bidSpread ?? null,
        // askSpread: ccy.askSpread ?? null,
        hidden: false,
        showInMarkets: false,
        showInTopGainersOrLosers: false,
        name: ccy.name,
        decimals: ccy.decimals,
        pricePrecision: ccy.pricePrecision,
        code: ccy.code,
        displayCode: ccy.displayCode ?? ccy.code,
        blockchain: ccy.blockchain,
        underlyingCurrencyCode: ccy.underlyingCurrencyCode,
        underlyingCurrencyName: ccy.underlyingCurrencyName,
        explorerUrl: ccy.explorerUrl,
        blockchainAssetId: ccy.blockchainAssetId,
        type: ccy.type,
        isStablecoin: ccy.isStablecoin,
        network: null,
      },
    }));
}

/** Marker for tests / CI demos — main / prod tip after #2439-style fix. */
export const ENV_STABLE_MARKER = "main";
