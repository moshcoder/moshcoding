// Every server-side call to CoinPay names this app, so CoinPay's logs and
// throttle can tell moshcoding.com apart from the other apps on the same host
// (they all used to arrive as `Bun/1.4.4`).
import pkg from "../package.json";

export const COINPAY_UA = `moshcoding.com/${pkg.version} (+https://moshcoding.com)`;

/** `fetch` with our User-Agent set, for the CoinPay clients' `fetch` hooks. */
export const coinpayFetch: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("user-agent", COINPAY_UA);
  return fetch(input, { ...init, headers });
};
