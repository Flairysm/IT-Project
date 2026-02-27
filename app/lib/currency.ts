export const CURRENCIES = [
  { code: "MYR", label: "Malaysia", symbol: "RM", flag: "🇲🇾" },
  { code: "SGD", label: "Singapore", symbol: "S$", flag: "🇸🇬" },
  { code: "IDR", label: "Indonesia", symbol: "Rp", flag: "🇮🇩" },
  { code: "USD", label: "United States", symbol: "$", flag: "🇺🇸" },
  { code: "CNY", label: "China", symbol: "¥", flag: "🇨🇳" },
  { code: "JPY", label: "Japan", symbol: "¥", flag: "🇯🇵" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

const byCode = Object.fromEntries(CURRENCIES.map((c) => [c.code, c]));

export function getCurrency(code: string | null | undefined) {
  const c = byCode[code ?? "MYR"];
  return c ?? byCode["MYR"];
}

export function formatAmount(amount: string | number, code: string | null | undefined): string {
  const { symbol } = getCurrency(code);
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  const value = Number.isFinite(n) ? n.toFixed(2) : "0.00";
  return `${symbol}${value}`;
}
