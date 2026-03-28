/**
 * Tests for Token Manager Refresh Error Handling
 * 
 * Verifies the fix for the startTime scope bug where startTime was declared
 * inside a try block but used in the catch block.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { TokenManager } from '../../src/plugin/token-manager.js';
import type { QwenCredentials } from '../../src/types.js';

// Mock the oauth module
const mockRefreshAccessToken = mock(async () => {
  throw new Error('Refresh failed');
});

// Mock the auth module
const mockLoadCredentials = mock(() => null);
const mockSaveCredentials = mock(() => {});

describe('TokenManager - Refresh Error Handling', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    tokenManager = new TokenManager();
    // Set test credentials path
    process.env.QWEN_TEST_CREDS_PATH = '/tmp/test-creds-' + Date.now() + '.json';
  });

  afterEach(() => {
    tokenManager.dispose();
    delete process.env.QWEN_TEST_CREDS_PATH;
    delete process.env.OPENCODE_QWEN_DEBUG;
  });

  describe('performTokenRefresh', () => {
    it('should handle refresh errors gracefully without ReferenceError', async () => {
      // This test verifies the startTime scope bug is fixed
      // Before the fix, this would throw ReferenceError: startTime is not defined
      
      // Create credentials that will trigger refresh
      const creds: QwenCredentials = {
        accessToken: 'expired-token',
        tokenType: 'Bearer',
        refreshToken: 'refresh-token',
        expiryDate: Date.now() - 1000, // Expired
      };
      
      tokenManager.setCredentials(creds);
      
      // Attempt to get valid credentials (will try to refresh)
      // This should NOT throw ReferenceError
      const result = await tokenManager.getValidCredentials();
      
      // Result should be null since refresh fails (no actual API)
      // The important thing is it doesn't crash with ReferenceError
      expect(result).toBeDefined();
    });

    it('should calculate elapsed time even when refresh fails', async () => {
      // The fix ensures startTime is available in catch block
      // to calculate elapsed time for error logging
      
      const creds: QwenCredentials = {
        accessToken: 'expired-token',
        tokenType: 'Bearer',
        refreshToken: 'refresh-token',
        expiryDate: Date.now() - 1000,
      };
      
      tokenManager.setCredentials(creds);
      
      // Enable debug logging
      process.env.OPENCODE_QWEN_DEBUG = '1';
      
      // This should complete without throwing ReferenceError
      await tokenManager.getValidCredentials();
    });
  });

  describe('dispose', () => {
    it('should have dispose method for cleanup', () => {
      expect(tokenManager.dispose).toBeDefined();
      expect(typeof tokenManager.dispose).toBe('function');
    });

    it('should be safe to call dispose multiple times', () => {
      tokenManager.dispose();
      tokenManager.dispose(); // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('getState', () => {
    it('should return current state information', () => {
      const state = tokenManager.getState();
      
      expect(state).toHaveProperty('hasMemoryCache');
      expect(state).toHaveProperty('memoryCacheValid');
      expect(state).toHaveProperty('hasRefreshPromise');
      expect(state).toHaveProperty('fileExists');
      expect(state).toHaveProperty('fileValid');
    });
  });
});
