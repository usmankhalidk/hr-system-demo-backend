import { describe, it, expect } from 'vitest';
import { resolveStoredToken } from '../context/AuthContext';

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildUrlToken(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('resolveStoredToken', () => {
  it('returns null when both storages are empty', () => {
    expect(resolveStoredToken(null, null)).toBeNull();
  });

  it('returns local token when only local exists', () => {
    const token = buildUrlToken({ iat: 100 });
    expect(resolveStoredToken(token, null)).toBe(token);
  });

  it('returns session token when only session exists', () => {
    const token = buildUrlToken({ iat: 100 });
    expect(resolveStoredToken(null, token)).toBe(token);
  });

  it('prefers newer session token when both tokens have valid iat', () => {
    const localToken = buildUrlToken({ iat: 100 });
    const sessionToken = buildUrlToken({ iat: 200 });
    expect(resolveStoredToken(localToken, sessionToken)).toBe(sessionToken);
  });

  it('prefers newer local token when both tokens have valid iat', () => {
    const localToken = buildUrlToken({ iat: 300 });
    const sessionToken = buildUrlToken({ iat: 200 });
    expect(resolveStoredToken(localToken, sessionToken)).toBe(localToken);
  });

  it('prefers the token with valid iat when the other token is malformed', () => {
    const localToken = buildUrlToken({ iat: 250 });
    expect(resolveStoredToken(localToken, 'bad.token')).toBe(localToken);

    const sessionToken = buildUrlToken({ iat: 260 });
    expect(resolveStoredToken('bad.token', sessionToken)).toBe(sessionToken);
  });

  it('falls back to local precedence when iat is missing in both tokens', () => {
    const localToken = buildUrlToken({});
    const sessionToken = buildUrlToken({});
    expect(resolveStoredToken(localToken, sessionToken)).toBe(localToken);
  });

  it('prefers local token when both iat values are invalid/unparseable', () => {
    expect(resolveStoredToken('bad.token', 'also.bad')).toBe('bad.token');
  });
});

