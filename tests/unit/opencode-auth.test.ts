/**
 * Tests for OpenCode OAuth Auth Helpers
 */

import { describe, it, expect } from 'bun:test';
import {
  isOpenCodeOAuthAuth,
  accessTokenExpired,
  accessTokenValid,
  parseQwenRefreshParts,
  formatQwenRefreshParts,
  createOpenCodeAuth,
  extractQwenCredentials,
  type OpenCodeOAuthAuth,
} from '../../src/plugin/opencode-auth.js';

describe('isOpenCodeOAuthAuth', () => {
  it('should return true for valid OpenCode OAuth auth', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: 'test-access-token',
      refresh: 'test-refresh-token',
      expires: Date.now() + 3600000,
    };
    expect(isOpenCodeOAuthAuth(auth)).toBe(true);
  });

  it('should return true for auth with only required fields', () => {
    const auth = {
      type: 'oauth',
      refresh: 'test-refresh-token',
    };
    expect(isOpenCodeOAuthAuth(auth)).toBe(true);
  });

  it('should return false for auth without type', () => {
    const auth = {
      access: 'test-access-token',
      refresh: 'test-refresh-token',
    };
    expect(isOpenCodeOAuthAuth(auth)).toBe(false);
  });

  it('should return false for auth with wrong type', () => {
    const auth = {
      type: 'api_key',
      access: 'test-access-token',
      refresh: 'test-refresh-token',
    };
    expect(isOpenCodeOAuthAuth(auth)).toBe(false);
  });

  it('should return false for auth without refresh', () => {
    const auth = {
      type: 'oauth',
      access: 'test-access-token',
    };
    expect(isOpenCodeOAuthAuth(auth)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isOpenCodeOAuthAuth(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isOpenCodeOAuthAuth(undefined)).toBe(false);
  });

  it('should return false for non-object', () => {
    expect(isOpenCodeOAuthAuth('string')).toBe(false);
    expect(isOpenCodeOAuthAuth(123)).toBe(false);
  });
});

describe('accessTokenExpired', () => {
  it('should return true for expired token', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: 'test-access-token',
      refresh: 'test-refresh-token',
      expires: Date.now() - 1000, // Expired 1 second ago
    };
    expect(accessTokenExpired(auth)).toBe(true);
  });

  it('should return true for token about to expire (within buffer)', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: 'test-access-token',
      refresh: 'test-refresh-token',
      expires: Date.now() + 10000, // Expires in 10 seconds (within 30s buffer)
    };
    expect(accessTokenExpired(auth)).toBe(true);
  });

  it('should return false for valid token', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: 'test-access-token',
      refresh: 'test-refresh-token',
      expires: Date.now() + 60000, // Expires in 60 seconds
    };
    expect(accessTokenExpired(auth)).toBe(false);
  });

  it('should return true for auth without expires', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: 'test-access-token',
      refresh: 'test-refresh-token',
    };
    expect(accessTokenExpired(auth)).toBe(true);
  });

  it('should respect custom buffer', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: 'test-access-token',
      refresh: 'test-refresh-token',
      expires: Date.now() + 5000, // Expires in 5 seconds
    };
    // With default 30s buffer, should be expired
    expect(accessTokenExpired(auth)).toBe(true);
    // With 1s buffer, should not be expired
    expect(accessTokenExpired(auth, 1000)).toBe(false);
  });
});

describe('accessTokenValid', () => {
  it('should return true for valid token', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: 'test-access-token',
      refresh: 'test-refresh-token',
      expires: Date.now() + 3600000,
    };
    expect(accessTokenValid(auth)).toBe(true);
  });

  it('should return false for token without access', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      refresh: 'test-refresh-token',
    };
    expect(accessTokenValid(auth)).toBe(false);
  });

  it('should return false for expired token', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: 'test-access-token',
      refresh: 'test-refresh-token',
      expires: Date.now() - 1000,
    };
    expect(accessTokenValid(auth)).toBe(false);
  });
});

describe('parseQwenRefreshParts', () => {
  it('should parse refresh token with resourceUrl', () => {
    const result = parseQwenRefreshParts('refresh123|https://portal.qwen.ai');
    expect(result.refreshToken).toBe('refresh123');
    expect(result.resourceUrl).toBe('https://portal.qwen.ai');
  });

  it('should parse refresh token without resourceUrl', () => {
    const result = parseQwenRefreshParts('refresh123');
    expect(result.refreshToken).toBe('refresh123');
    expect(result.resourceUrl).toBeUndefined();
  });

  it('should handle empty resourceUrl after pipe', () => {
    const result = parseQwenRefreshParts('refresh123|');
    expect(result.refreshToken).toBe('refresh123');
    expect(result.resourceUrl).toBeUndefined();
  });

  it('should handle multiple pipes (only first is delimiter)', () => {
    const result = parseQwenRefreshParts('refresh123|https://example.com|extra');
    expect(result.refreshToken).toBe('refresh123');
    expect(result.resourceUrl).toBe('https://example.com|extra');
  });
});

describe('formatQwenRefreshParts', () => {
  it('should format with both parts', () => {
    const result = formatQwenRefreshParts({
      refreshToken: 'refresh123',
      resourceUrl: 'https://portal.qwen.ai',
    });
    expect(result).toBe('refresh123|https://portal.qwen.ai');
  });

  it('should format with only refresh token', () => {
    const result = formatQwenRefreshParts({
      refreshToken: 'refresh123',
    });
    expect(result).toBe('refresh123');
  });

  it('should handle undefined resourceUrl', () => {
    const result = formatQwenRefreshParts({
      refreshToken: 'refresh123',
      resourceUrl: undefined,
    });
    expect(result).toBe('refresh123');
  });
});

describe('createOpenCodeAuth', () => {
  it('should create OpenCode auth from Qwen credentials', () => {
    const result = createOpenCodeAuth({
      accessToken: 'access123',
      refreshToken: 'refresh456',
      expiryDate: 1234567890000,
      resourceUrl: 'https://portal.qwen.ai',
    });

    expect(result.type).toBe('oauth');
    expect(result.access).toBe('access123');
    expect(result.refresh).toBe('refresh456|https://portal.qwen.ai');
    expect(result.expires).toBe(1234567890000);
  });

  it('should handle missing refresh token', () => {
    const result = createOpenCodeAuth({
      accessToken: 'access123',
      expiryDate: 1234567890000,
    });

    expect(result.type).toBe('oauth');
    expect(result.access).toBe('access123');
    expect(result.refresh).toBe('');
    expect(result.expires).toBe(1234567890000);
  });

  it('should handle missing resourceUrl', () => {
    const result = createOpenCodeAuth({
      accessToken: 'access123',
      refreshToken: 'refresh456',
      expiryDate: 1234567890000,
    });

    expect(result.refresh).toBe('refresh456');
  });
});

describe('extractQwenCredentials', () => {
  it('should extract Qwen credentials from OpenCode auth', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: 'access123',
      refresh: 'refresh456|https://portal.qwen.ai',
      expires: 1234567890000,
    };

    const result = extractQwenCredentials(auth);

    expect(result.accessToken).toBe('access123');
    expect(result.refreshToken).toBe('refresh456');
    expect(result.resourceUrl).toBe('https://portal.qwen.ai');
    expect(result.expiryDate).toBe(1234567890000);
  });

  it('should handle auth without access', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      refresh: 'refresh456',
    };

    const result = extractQwenCredentials(auth);

    expect(result.accessToken).toBeUndefined();
    expect(result.refreshToken).toBe('refresh456');
  });

  it('should handle auth without expires', () => {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: 'access123',
      refresh: 'refresh456',
    };

    const result = extractQwenCredentials(auth);

    expect(result.expiryDate).toBeUndefined();
  });
});

describe('roundtrip: formatQwenRefreshParts <-> parseQwenRefreshParts', () => {
  it('should roundtrip correctly with resourceUrl', () => {
    const original = {
      refreshToken: 'refresh123',
      resourceUrl: 'https://portal.qwen.ai',
    };
    const formatted = formatQwenRefreshParts(original);
    const parsed = parseQwenRefreshParts(formatted);
    expect(parsed.refreshToken).toBe(original.refreshToken);
    expect(parsed.resourceUrl).toBe(original.resourceUrl);
  });

  it('should roundtrip correctly without resourceUrl', () => {
    const original = {
      refreshToken: 'refresh123',
    };
    const formatted = formatQwenRefreshParts(original);
    const parsed = parseQwenRefreshParts(formatted);
    expect(parsed.refreshToken).toBe(original.refreshToken);
    expect(parsed.resourceUrl).toBeUndefined();
  });
});
