const WINDOW_MS = 60_000;

const ROUTE_LIMITS: Record<string, number> = {
  scan: 15,
  token: 15,
  trace: 15,
  expand: 30,
  poll: 60,
  trending: 30,
  blacklist: 20,
  'wallet-profile': 30,
  'wallet-history': 30,
  'cross-token': 10,
  'token-history': 40,
  'prices-stream': 20,
  gate: 20,
  explain: 10,
  watchlist: 30,
  default: 30,
};

interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, WindowEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.windowStart > WINDOW_MS) store.delete(key);
  }
}, 5 * 60_000);

export function checkRateLimit(ip: string, route?: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const maxRequests = ROUTE_LIMITS[route ?? 'default'] ?? ROUTE_LIMITS.default;
  const key = route ? `${ip}:${route}` : ip;
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= maxRequests) {
    const retryAfterMs = WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }

  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}
