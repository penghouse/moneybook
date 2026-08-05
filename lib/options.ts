// Curated, not exhaustive — enough for a personal ledger without turning
// every currency/timezone picker into a 200-item dropdown.

export const CURRENCY_OPTIONS = [
  "KRW",
  "USD",
  "EUR",
  "JPY",
  "GBP",
  "CNY",
  "AUD",
  "CAD",
  "CHF",
  "HKD",
  "SGD",
  "THB",
  "VND",
] as const;

export const TIMEZONE_OPTIONS = [
  "Asia/Seoul",
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Ho_Chi_Minh",
  "Australia/Sydney",
] as const;
