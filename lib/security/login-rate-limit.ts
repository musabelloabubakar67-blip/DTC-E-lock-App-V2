const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type AttemptWindow = {
  count: number;
  resetAt: number;
};

const attempts = new Map<string, AttemptWindow>();

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
