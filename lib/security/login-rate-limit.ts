const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_TRACKED_KEYS = 10_000;

type AttemptWindow = {
  count: number;
  resetAt: number;
};

const attempts = new Map<string, AttemptWindow>();

function pruneAttempts(now: number) {
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }

  while (attempts.size >= MAX_TRACKED_KEYS) {
    const oldestKey = attempts.keys().next().value;
    if (oldestKey === undefined) break;
    attempts.delete(oldestKey);
  }
}

function normalizePart(value: string) {
  return value.trim().toLowerCase().slice(0, 160);
}

export function loginAttemptKey(ipAddress: string, username: string) {
  return `${normalizePart(ipAddress) || 'unknown'}:${normalizePart(username) || 'unknown'}`;
}

export function isLoginRateLimited(key: string, now = Date.now()) {
  const entry = attempts.get(key);
  if (!entry) return false;

  if (entry.resetAt <= now) {
    attempts.delete(key);
    return false;
  }

  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedLogin(key: string, now = Date.now()) {
  pruneAttempts(now);
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  entry.count += 1;
}

export function clearFailedLogins(key: string) {
  attempts.delete(key);
}

export function resetLoginRateLimitForTests() {
  attempts.clear();
}

export function trackedLoginAttemptsForTests() {
  return attempts.size;
}
