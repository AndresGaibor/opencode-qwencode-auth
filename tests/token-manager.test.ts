/**
 * Tests for Token Manager
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { TokenManager } from '../src/plugin/token-manager.js';
import type { QwenCredentials } from '../src/types.js';

// Mock credentials for testing
const mockCredentials: QwenCredentials = {
  accessToken: 'mock_access_token_12345',
  tokenType: 'Bearer',
  refreshToken: 'mock_refresh_token_67890',
  resourceUrl: 'https://dashscope.aliyuncs.com',
  expiryDate: Date.now() + 3600000, // 1 hour from now
  scope: 'openid profile email model.completion',
};

const expiredCredentials: QwenCredentials = {
  ...mockCredentials,
  expiryDate: Date.now() - 3600000, // 1 hour ago
};

describe('TokenManager', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    tokenManager = new TokenManager();
  });

  afterEach(() => {
    tokenManager.clearCache();
  });

  describe('constructor', () => {
    it('should create instance with empty cache', () => {
      const creds = tokenManager.getCurrentCredentials();
      expect(creds).toBeNull();
    });
  });

  describe('updateCacheState', () => {
    it('should update cache with credentials', () => {
      tokenManager['updateCacheState'](mockCredentials);
      const creds = tokenManager.getCurrentCredentials();
      expect(creds).toEqual(mockCredentials);
    });

    it('should clear cache when credentials is null', () => {
      tokenManager['updateCacheState'](mockCredentials);
      tokenManager['updateCacheState'](null);
      const creds = tokenManager.getCurrentCredentials();
      expect(creds).toBeNull();
    });
  });

  describe('isTokenValid', () => {
    it('should return true for valid token (not expired)', () => {
      tokenManager['updateCacheState'](mockCredentials);
      const isValid = tokenManager['isTokenValid'](mockCredentials);
      expect(isValid).toBe(true);
    });

    it('should return false for expired token', () => {
      const isValid = tokenManager['isTokenValid'](expiredCredentials);
      expect(isValid).toBe(false);
    });

    it('should return false for token expiring within buffer (30s)', () => {
      const soonExpiring = {
        ...mockCredentials,
        expiryDate: Date.now() + 20000, // 20 seconds from now
      };
      const isValid = tokenManager['isTokenValid'](soonExpiring);
      expect(isValid).toBe(false);
    });

    it('should return false for token without expiry_date', () => {
      const invalid = { ...mockCredentials, expiryDate: undefined as any };
      const isValid = tokenManager['isTokenValid'](invalid);
      expect(isValid).toBe(false);
    });

    it('should return false for token without access_token', () => {
      const invalid = { ...mockCredentials, accessToken: undefined as any };
      const isValid = tokenManager['isTokenValid'](invalid);
      expect(isValid).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should clear credentials from cache', () => {
      tokenManager['updateCacheState'](mockCredentials);
      tokenManager.clearCache();
      const creds = tokenManager.getCurrentCredentials();
      expect(creds).toBeNull();
    });

    it('should reset lastFileCheck timestamp', () => {
      tokenManager.clearCache();
      expect(tokenManager['lastFileCheck']).toBe(0);
    });

    it('should reset refreshPromise', () => {
      // Simulate ongoing refresh
      tokenManager['refreshPromise'] = Promise.resolve(null);
      tokenManager.clearCache();
      expect(tokenManager['refreshPromise']).toBeNull();
    });
  });

  describe('getCredentialsPath', () => {
    it('should return path in home directory', () => {
      const path = tokenManager['getCredentialsPath']();
      expect(path).toContain('.qwen');
      expect(path).toContain('oauth_creds.json');
    });
  });

  describe('getLockPath', () => {
    it('should return lock path in home directory', () => {
      const path = tokenManager['getLockPath']();
      expect(path).toContain('.qwen');
      expect(path).toContain('oauth_creds.lock');
    });
  });

  describe('shouldRefreshToken', () => {
    it('should return true if no credentials', () => {
      const result = tokenManager['shouldRefreshToken'](null);
      expect(result).toBe(true);
    });

    it('should return true if token is invalid', () => {
      const result = tokenManager['shouldRefreshToken'](expiredCredentials);
      expect(result).toBe(true);
    });

    it('should return false if token is valid', () => {
      const result = tokenManager['shouldRefreshToken'](mockCredentials);
      expect(result).toBe(false);
    });

    it('should return true if forceRefresh is true', () => {
      const result = tokenManager['shouldRefreshToken'](mockCredentials, true);
      expect(result).toBe(true);
    });
  });

  describe('file lock timeout constants', () => {
    it('should have LOCK_TIMEOUT_MS of 5000ms', () => {
      expect(TokenManager['LOCK_TIMEOUT_MS']).toBe(5000);
    });

    it('should have LOCK_RETRY_INTERVAL_MS of 100ms', () => {
      expect(TokenManager['LOCK_RETRY_INTERVAL_MS']).toBe(100);
    });

    it('should have CACHE_CHECK_INTERVAL_MS of 5000ms', () => {
      expect(TokenManager['CACHE_CHECK_INTERVAL_MS']).toBe(5000);
    });

    it('should have TOKEN_REFRESH_BUFFER_MS of 30000ms', () => {
      expect(TokenManager['TOKEN_REFRESH_BUFFER_MS']).toBe(30000);
    });
  });
});

describe('TokenManager - Edge Cases', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    tokenManager = new TokenManager();
  });

  it('should handle credentials with missing fields gracefully', () => {
    const incomplete = {
      accessToken: 'token',
      // missing other fields
    } as QwenCredentials;
    
    tokenManager['updateCacheState'](incomplete);
    const creds = tokenManager.getCurrentCredentials();
    expect(creds?.accessToken).toBe('token');
  });

  it('should preserve lastFileCheck on credential update', () => {
    const beforeCheck = tokenManager['lastFileCheck'];
    tokenManager['updateCacheState'](mockCredentials);
    // lastFileCheck should not change on credential update
    expect(tokenManager['lastFileCheck']).toBe(beforeCheck);
  });
});
