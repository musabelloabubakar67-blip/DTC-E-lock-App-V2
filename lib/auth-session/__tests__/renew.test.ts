import { describe, expect, it } from 'vitest';
import { decode, encode } from 'next-auth/jwt';
import { SESSION_MAX_AGE_SECONDS, SESSION_RENEW_AFTER_SECONDS } from '../config';
import { renewSessionToken } from '../renew';

const secret = 'test-secret-at-least-thirty-two-characters';
const claims = { id: 'user-1', orgId: 'org-1', role: 'installer' as const, sessionVersion: 100, revoked: false };
const now = () => Math.floor(Date.now() / 1000);

describe('sliding session renewal', () => {
  it('leaves a token issued less than a day ago alone', async () => {
    const token = await encode({ token: claims, secret, maxAge: SESSION_MAX_AGE_SECONDS });
    expect(await renewSessionToken(token, secret)).toBeNull();
  });

  it('renews a day-old token with the same identity and a fresh 30-day expiry', async () => {
    const token = await encode({ token: claims, secret, maxAge: SESSION_MAX_AGE_SECONDS });
    const later = now() + SESSION_RENEW_AFTER_SECONDS + 60;

    const renewed = await renewSessionToken(token, secret, later);
    expect(renewed).toBeTruthy();

    const payload = await decode({ token: renewed!, secret });
    expect(payload).toMatchObject(claims);
    expect(payload!.exp).toBeGreaterThanOrEqual(now() + SESSION_MAX_AGE_SECONDS - 5);
  });

  it('never renews a missing, foreign, garbage or revoked token', async () => {
    const day = now() + SESSION_RENEW_AFTER_SECONDS + 60;
    expect(await renewSessionToken(undefined, secret, day)).toBeNull();
    expect(await renewSessionToken('not-a-jwt', secret, day)).toBeNull();

    const foreign = await encode({ token: claims, secret: 'another-secret-also-thirty-two-chars!!', maxAge: 60 });
    expect(await renewSessionToken(foreign, secret, day)).toBeNull();

    const revoked = await encode({ token: { ...claims, revoked: true }, secret, maxAge: SESSION_MAX_AGE_SECONDS });
    expect(await renewSessionToken(revoked, secret, day)).toBeNull();

    const token = await encode({ token: claims, secret, maxAge: SESSION_MAX_AGE_SECONDS });
    expect(await renewSessionToken(token, undefined, day)).toBeNull();
  });
});
