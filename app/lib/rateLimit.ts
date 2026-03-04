const lastCall: Record<string, number> = {};

/**
 * Returns true if the action is allowed (enough time since last call), false if rate limited.
 * On allowed call, records current time for the key.
 */
export function checkRateLimit(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const last = lastCall[key] ?? 0;
  if (now - last < cooldownMs) return false;
  lastCall[key] = now;
  return true;
}

/** Cooldowns in ms */
export const RATE_LIMIT = {
  scan: 8000,
  remind: 5000,
  submitProof: 5000,
} as const;
