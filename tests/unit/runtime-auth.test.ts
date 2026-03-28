/**
 * Tests for Runtime Auth Resolution
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import {
  resolveRuntimeAuth,
  needsRefresh,
  hasValidAccessToken,
  type GetAuthFn,
  type TokenManagerLike,
} from '../../src/plugin/runtime-auth.js';
import type { OpenCodeOAuthAuth, RuntimeAuth, QwenCredentials } from '../../src/types.js';

describe('resolveRuntimeAuth', () => {
  let mockTokenManager: TokenManagerLike;
  let mockGetAuth: GetAuthFn | undefined;

  beforeEach(() => {
    mockTokenManager = {
      getValidCredentials: mock(async () => null),
    };
    mockGetAuth = undefined;
  });

  describe('OpenCode native auth priority', () => {
    it('should use OpenCode auth when available and valid', async () => {
      const openCodeAuth: OpenCodeOAuthAuth = {
        type: 'oauth',
        access: 'opencode-access',
        refresh: 'opencode-refresh|https://portal.qwen.ai',
        expires: Date.now() + 3600000,
      };

      mockGetAuth = mock(async () => openCodeAuth);
      mockTokenManager.getValidCredentials = mock(async () => ({
        accessToken: 'local-access',
        refreshToken: 'local-refresh',
        expiryDate: Date.now() + 3600000,
      }));

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      expect(result.source).toBe('opencode');
      expect(result.auth?.access).toBe('opencode-access');
      expect(result.auth?.refresh).toBe('opencode-refresh');
      expect(result.auth?.resourceUrl).toBe('https://portal.qwen.ai');
    });

    it('should parse resourceUrl from refresh field', async () => {
      const openCodeAuth: OpenCodeOAuthAuth = {
        type: 'oauth',
        access: 'opencode-access',
        refresh: 'refresh-token|https://custom.qwen.ai',
        expires: Date.now() + 3600000,
      };

      mockGetAuth = mock(async () => openCodeAuth);

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      expect(result.auth?.resourceUrl).toBe('https://custom.qwen.ai');
    });

    it('should handle OpenCode auth without resourceUrl', async () => {
      const openCodeAuth: OpenCodeOAuthAuth = {
        type: 'oauth',
        access: 'opencode-access',
        refresh: 'refresh-token',
        expires: Date.now() + 3600000,
      };

      mockGetAuth = mock(async () => openCodeAuth);

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      expect(result.auth?.resourceUrl).toBeUndefined();
    });
  });

  describe('Local credentials fallback', () => {
    it('should fallback to local credentials when OpenCode auth unavailable', async () => {
      mockGetAuth = mock(async () => null);
      mockTokenManager.getValidCredentials = mock(async () => ({
        accessToken: 'local-access',
        refreshToken: 'local-refresh',
        expiryDate: Date.now() + 3600000,
        resourceUrl: 'https://portal.qwen.ai',
      }));

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      expect(result.source).toBe('local');
      expect(result.auth?.access).toBe('local-access');
      expect(result.auth?.refresh).toBe('local-refresh');
      expect(result.auth?.resourceUrl).toBe('https://portal.qwen.ai');
    });

    it('should fallback to local when getAuth is not a function', async () => {
      mockGetAuth = undefined as any;
      mockTokenManager.getValidCredentials = mock(async () => ({
        accessToken: 'local-access',
        refreshToken: 'local-refresh',
        expiryDate: Date.now() + 3600000,
      }));

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      expect(result.source).toBe('local');
      expect(result.auth?.access).toBe('local-access');
    });

    it('should fallback to local when OpenCode auth has wrong shape', async () => {
      mockGetAuth = mock(async () => ({
        accessToken: 'wrong-field', // Should be 'access', not 'accessToken'
        refreshToken: 'wrong-refresh',
      }) as any);

      mockTokenManager.getValidCredentials = mock(async () => ({
        accessToken: 'local-access',
        refreshToken: 'local-refresh',
        expiryDate: Date.now() + 3600000,
      }));

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      expect(result.source).toBe('local');
    });

    it('should fallback to local when OpenCode auth throws', async () => {
      mockGetAuth = mock(async () => {
        throw new Error('OpenCode auth error');
      });

      mockTokenManager.getValidCredentials = mock(async () => ({
        accessToken: 'local-access',
        refreshToken: 'local-refresh',
        expiryDate: Date.now() + 3600000,
      }));

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      expect(result.source).toBe('local');
      expect(result.auth?.access).toBe('local-access');
    });
  });

  describe('No auth available', () => {
    it('should return none when no auth available', async () => {
      mockGetAuth = mock(async () => null);
      mockTokenManager.getValidCredentials = mock(async () => null);

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      expect(result.source).toBe('none');
      expect(result.auth).toBeNull();
    });

    it('should return none when OpenCode auth has no access and local unavailable', async () => {
      const openCodeAuth: OpenCodeOAuthAuth = {
        type: 'oauth',
        refresh: 'refresh-only',
      };

      mockGetAuth = mock(async () => openCodeAuth);
      mockTokenManager.getValidCredentials = mock(async () => null);

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      expect(result.source).toBe('none');
      expect(result.auth).toBeNull();
    });
  });

  describe('Expired token handling', () => {
    it('should fallback to local when OpenCode auth is expired', async () => {
      const openCodeAuth: OpenCodeOAuthAuth = {
        type: 'oauth',
        access: 'expired-access',
        refresh: 'refresh-token',
        expires: Date.now() - 1000, // Expired
      };

      mockGetAuth = mock(async () => openCodeAuth);
      mockTokenManager.getValidCredentials = mock(async () => ({
        accessToken: 'local-access',
        refreshToken: 'local-refresh',
        expiryDate: Date.now() + 3600000,
      }));

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      // Should fallback to local since OpenCode auth is expired
      expect(result.source).toBe('local');
      expect(result.auth?.access).toBe('local-access');
    });

    it('should return none if OpenCode auth expired and local unavailable', async () => {
      const openCodeAuth: OpenCodeOAuthAuth = {
        type: 'oauth',
        access: 'expired-access',
        refresh: 'refresh-token',
        expires: Date.now() - 1000, // Expired
      };

      mockGetAuth = mock(async () => openCodeAuth);
      mockTokenManager.getValidCredentials = mock(async () => null);

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      // No valid auth available
      expect(result.source).toBe('none');
      expect(result.auth).toBeNull();
    });

    it('should return local if OpenCode auth expired and no access', async () => {
      const openCodeAuth: OpenCodeOAuthAuth = {
        type: 'oauth',
        refresh: 'refresh-only', // No access
        expires: Date.now() - 1000,
      };

      mockGetAuth = mock(async () => openCodeAuth);
      mockTokenManager.getValidCredentials = mock(async () => ({
        accessToken: 'local-access',
        refreshToken: 'local-refresh',
        expiryDate: Date.now() + 3600000,
      }));

      const result = await resolveRuntimeAuth(mockGetAuth, mockTokenManager);

      expect(result.source).toBe('local');
    });
  });
});

describe('needsRefresh', () => {
  it('should return true when token is about to expire', () => {
    const auth: RuntimeAuth = {
      source: 'opencode',
      access: 'access',
      refresh: 'refresh',
      expires: Date.now() + 20000, // 20 seconds
    };
    expect(needsRefresh(auth)).toBe(true);
  });

  it('should return false when token has plenty of time', () => {
    const auth: RuntimeAuth = {
      source: 'opencode',
      access: 'access',
      refresh: 'refresh',
      expires: Date.now() + 3600000, // 1 hour
    };
    expect(needsRefresh(auth)).toBe(false);
  });

  it('should return false when no expires', () => {
    const auth: RuntimeAuth = {
      source: 'opencode',
      access: 'access',
      refresh: 'refresh',
    };
    expect(needsRefresh(auth)).toBe(false);
  });

  it('should respect custom buffer', () => {
    const auth: RuntimeAuth = {
      source: 'opencode',
      access: 'access',
      refresh: 'refresh',
      expires: Date.now() + 20000,
    };
    // Default 30s buffer -> needs refresh
    expect(needsRefresh(auth)).toBe(true);
    // 10s buffer -> doesn't need refresh yet
    expect(needsRefresh(auth, 10000)).toBe(false);
  });
});

describe('hasValidAccessToken', () => {
  it('should return true for valid token', () => {
    const auth: RuntimeAuth = {
      source: 'opencode',
      access: 'access',
      expires: Date.now() + 3600000,
    };
    expect(hasValidAccessToken(auth)).toBe(true);
  });

  it('should return false for null auth', () => {
    expect(hasValidAccessToken(null)).toBe(false);
  });

  it('should return false for auth without access', () => {
    const auth: RuntimeAuth = {
      source: 'opencode',
      access: '',
      refresh: 'refresh',
    };
    expect(hasValidAccessToken(auth)).toBe(false);
  });

  it('should return false for expired token', () => {
    const auth: RuntimeAuth = {
      source: 'opencode',
      access: 'access',
      expires: Date.now() - 1000,
    };
    expect(hasValidAccessToken(auth)).toBe(false);
  });

  it('should return true when no expires (assume valid)', () => {
    const auth: RuntimeAuth = {
      source: 'opencode',
      access: 'access',
    };
    expect(hasValidAccessToken(auth)).toBe(true);
  });
});
