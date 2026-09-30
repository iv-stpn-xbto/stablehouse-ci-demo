import test from "node:test";
import assert from "node:assert/strict";
import {
  ENV_STABLE_MARKER,
  mapTradableCurrenciesToEnrichedAccountDetailAssets,
} from "../packages/common/src/utils/factories/index.js";

const sample = [
  {
    code: "BTC",
    name: "Bitcoin",
    availableSupply: "21e6",
    couponFee: "0",
    couponPercent: "5.5",
    paymentFrequency: "Monthly",
    bidSpread: "0.01",
    askSpread: "0.02",
    decimals: 8,
  },
];

test("develop factories expose coupon/spread fields from dev swagger", () => {
  assert.equal(ENV_STABLE_MARKER, "develop");
  const [asset] = mapTradableCurrenciesToEnrichedAccountDetailAssets(sample);
  assert.equal(asset.currency.couponPercent, "5.5");
  assert.equal(asset.currency.paymentFrequency, "Monthly");
  assert.equal(asset.currency.bidSpread, "0.01");
  assert.equal(asset.currency.askSpread, "0.02");
  assert.equal(asset.currency.couponFee, "0");
});
