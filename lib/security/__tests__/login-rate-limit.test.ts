import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFailedLogins,
  isLoginRateLimited,
  loginAttemptKey,
  recordFailedLogin,
  resetLoginRateLimitForTests,
} from '../login-rate-limit';

describe('login rate limiting', () => {
  beforeEach(() => resetLoginRateLimitForTests());

  it('locks a username and IP pair after five failures', () => {
    const key = loginAttemptKey('203.0.113.8', 'Supervisor');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordFailedLogin(key, 1_000);
    }

    expect(isLoginRateLimited(key, 2_000)).toBe(true);
  });

  it('expires failure windows and clears them after success', () => {
    const key = loginAttemptKey('203.0.113.8', 'supervisor');
    recordFailedLogin(key, 1_000);
    clearFailedLogins(key);
    expect(isLoginRateLimited(key, 2_000)).toBe(false);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordFailedLogin(key, 1_000);
    }
    expect(isLoginRateLimited(key, 15 * 60 * 1000 + 1_001)).toBe(false);
  });

  it('normalizes usernames without merging different addresses', () => {
    expect(loginAttemptKey('10.0.0.1', ' Musa ')).toBe('10.0.0.1:musa');
    expect(loginAttemptKey('10.0.0.2', 'MUSA')).not.toBe(loginAttemptKey('10.0.0.1', 'MUSA'));
  });
});
