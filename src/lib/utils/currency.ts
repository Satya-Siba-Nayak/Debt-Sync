// Currency symbols map taken from user's Flux-Extension
export const CURRENCY_SYMBOLS: Record<string, string> = {
  inr: "₹",
  usd: "$",
  eur: "€",
  gbp: "£",
  jpy: "¥",
  cad: "C$",
  aud: "A$",
  chf: "CHF",
  cny: "CN¥",
  sgd: "S$",
  aed: "AED",
  rub: "₽",
  thb: "฿",
};

export const SUPPORTED_CURRENCIES = [
  { code: 'inr', name: 'Indian Rupee', symbol: '₹' },
  { code: 'usd', name: 'US Dollar', symbol: '$' },
  { code: 'eur', name: 'Euro', symbol: '€' },
  { code: 'gbp', name: 'British Pound', symbol: '£' },
  { code: 'jpy', name: 'Japanese Yen', symbol: '¥' },
  { code: 'cad', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'aud', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'sgd', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'aed', name: 'UAE Dirham', symbol: 'AED' },
];

function getApiUrls(baseCurrency: string): string[] {
  const base = baseCurrency.toLowerCase();
  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base}.json`,
    `https://latest.currency-api.pages.dev/v1/currencies/${base}.json`,
  ];
}

const ratesCache: Record<string, { timestamp: number; rates: Record<string, number> }> = {};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetches exchange rates for a given base currency with local caching.
 */
export async function fetchExchangeRates(baseCurrency: string = 'inr'): Promise<Record<string, number>> {
  const base = baseCurrency.toLowerCase();

  // Check in-memory cache
  if (ratesCache[base] && Date.now() - ratesCache[base].timestamp < CACHE_TTL_MS) {
    return ratesCache[base].rates;
  }

  // Check browser localStorage cache
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(`rates_${base}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
          ratesCache[base] = parsed;
          return parsed.rates;
        }
      }
    } catch {
      // ignore
    }
  }

  const urls = getApiUrls(base);
  let data: Record<string, unknown> | null = null;

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        data = await res.json();
        break;
      }
    } catch {
      // fallback to next URL
    }
  }

  if (data && typeof data[base] === 'object') {
    const rates = data[base] as Record<string, number>;
    ratesCache[base] = { timestamp: Date.now(), rates };
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`rates_${base}`, JSON.stringify(ratesCache[base]));
      } catch {
        // ignore
      }
    }
    return rates;
  }

  // Hardcoded approximate fallbacks if network fails
  const fallbackRates: Record<string, number> = {
    inr: 1,
    usd: 0.012,
    eur: 0.011,
    gbp: 0.0094,
    jpy: 1.82,
    cad: 0.016,
    aud: 0.018,
    sgd: 0.016,
  };

  return fallbackRates;
}

/**
 * Converts an amount from source currency to target currency.
 */
export function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  ratesFromBase?: Record<string, number>
): number {
  const from = fromCurrency.toLowerCase();
  const to = toCurrency.toLowerCase();
  if (from === to) return amount;

  if (ratesFromBase && ratesFromBase[to]) {
    return amount * ratesFromBase[to];
  }

  // If we don't have rates available synchronously, return amount
  return amount;
}

/**
 * Formats a currency value with appropriate symbol and commas (Indian grouping for INR, standard for others).
 */
export function formatCurrency(
  amount: number,
  currencyCode: string = 'inr',
  options: { includeSymbol?: boolean; showDecimals?: boolean } = {}
): string {
  const { includeSymbol = true, showDecimals = false } = options;
  const code = currencyCode.toLowerCase();
  const symbol = CURRENCY_SYMBOLS[code] || code.toUpperCase();

  const num = Number(amount) || 0;
  const formattedNumber = showDecimals
    ? num.toLocaleString(code === 'inr' ? 'en-IN' : 'en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : num.toLocaleString(code === 'inr' ? 'en-IN' : 'en-US', {
        maximumFractionDigits: 0,
      });

  return includeSymbol ? `${symbol}${formattedNumber}` : formattedNumber;
}
