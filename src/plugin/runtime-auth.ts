/**
 * Runtime Auth Resolution
 *
 * Handles resolving authentication from multiple sources with proper priority:
 * 1. OpenCode native auth (from getAuth()) - highest priority
 * 2. Local credentials file (~/.qwen/oauth_creds.json) - fallback
 *
 * This module ensures that OpenCode's auth is the source of truth when available,
 * while maintaining backward compatibility with the local credentials file.
 */

import type { RuntimeAuth, OpenCodeOAuthAuth } from '../types.js';
import type { QwenCredentials } from '../types.js';
import { isOpenCodeOAuthAuth, accessTokenValid, parseQwenRefreshParts } from './opencode-auth.js';
import { createDebugLogger } from '../utils/debug-logger.js';

const debugLogger = createDebugLogger('RUNTIME_AUTH');

/**
 * GetAuth function type - what OpenCode passes to the loader
 */
export type GetAuthFn = () => Promise<OpenCodeOAuthAuth | null | undefined>;

/**
 * Token manager interface - minimal subset needed for auth resolution
 */
export interface TokenManagerLike {
  getValidCredentials(forceRefresh?: boolean): Promise<QwenCredentials | null>;
}

/**
 * Result of auth resolution
 */
export interface AuthResolutionResult {
  auth: RuntimeAuth | null;
  source: 'opencode' | 'local' | 'none';
  error?: Error;
}

/**
 * Resolve authentication from OpenCode native auth
 * Uses correct field names: access, refresh, expires (not accessToken, refreshToken, expiryDate)
 */
async function resolveOpenCodeAuth(getAuth: GetAuthFn): Promise<RuntimeAuth | null> {
  try {
    const openCodeAuth = await getAuth();
    
    if (!openCodeAuth) {
      debugLogger.debug('OpenCode getAuth() returned null/undefined');
      return null;
    }
    
    // Validate it's the correct shape
    if (!isOpenCodeOAuthAuth(openCodeAuth)) {
      debugLogger.warn('OpenCode auth has unexpected shape', {
        hasType: 'type' in openCodeAuth,
        type: (openCodeAuth as any).type,
        hasAccess: 'access' in openCodeAuth,
        hasRefresh: 'refresh' in openCodeAuth,
      });
      return null;
    }
    
    // Check if token is valid
    if (!accessTokenValid(openCodeAuth)) {
      debugLogger.debug('OpenCode access token is expired or missing', {
        hasAccess: !!openCodeAuth.access,
        expires: openCodeAuth.expires ? new Date(openCodeAuth.expires).toISOString() : 'N/A',
      });
      // Still return it - might be refreshable
      // The refresh logic will handle this
    }
    
    // Extract Qwen-specific metadata from refresh field
    const parts = parseQwenRefreshParts(openCodeAuth.refresh);
    
    const runtimeAuth: RuntimeAuth = {
      source: 'opencode',
      access: openCodeAuth.access || '',
      refresh: parts.refreshToken,
      expires: openCodeAuth.expires,
      resourceUrl: parts.resourceUrl,
    };
    
    debugLogger.info('Resolved OpenCode native auth', {
      hasAccess: !!runtimeAuth.access,
      hasRefresh: !!runtimeAuth.refresh,
      hasResourceUrl: !!runtimeAuth.resourceUrl,
      expires: runtimeAuth.expires ? new Date(runtimeAuth.expires).toISOString() : 'N/A',
    });
    
    return runtimeAuth;
  } catch (error) {
    debugLogger.error('Failed to resolve OpenCode auth', error);
    return null;
  }
}

/**
 * Resolve authentication from local token manager
 */
async function resolveLocalAuth(tokenManager: TokenManagerLike): Promise<RuntimeAuth | null> {
  try {
    const localCreds = await tokenManager.getValidCredentials();
    
    if (!localCreds?.accessToken) {
      debugLogger.debug('No valid local credentials available');
      return null;
    }
    
    const runtimeAuth: RuntimeAuth = {
      source: 'local',
      access: localCreds.accessToken,
      refresh: localCreds.refreshToken,
      expires: localCreds.expiryDate,
      resourceUrl: localCreds.resourceUrl,
    };
    
    debugLogger.info('Resolved local credentials', {
      hasAccess: !!runtimeAuth.access,
      hasRefresh: !!runtimeAuth.refresh,
      hasResourceUrl: !!runtimeAuth.resourceUrl,
      expires: runtimeAuth.expires ? new Date(runtimeAuth.expires).toISOString() : 'N/A',
    });
    
    return runtimeAuth;
  } catch (error) {
    debugLogger.error('Failed to resolve local auth', error);
    return null;
  }
}

/**
 * Resolve authentication from all available sources with proper priority
 * 
 * Priority order:
 * 1. OpenCode native auth (if available and VALID - not expired)
 * 2. Local credentials file (fallback, can be refreshed by token manager)
 * 
 * Important: We only use OpenCode auth if the access token is valid.
 * If it's expired, we fall back to local credentials which can be refreshed.
 * The 401 recovery in fetch will handle refreshing OpenCode auth if needed.
 * 
 * @param getAuth - Function to get OpenCode native auth (may be undefined if not available)
 * @param tokenManager - Token manager for local credentials
 * @returns Runtime auth with source information, or null if no auth available
 */
export async function resolveRuntimeAuth(
  getAuth: GetAuthFn | undefined,
  tokenManager: TokenManagerLike
): Promise<AuthResolutionResult> {
  debugLogger.debug('Resolving runtime auth...');
  
  // 1. Try OpenCode native auth first (if available AND valid)
  if (typeof getAuth === 'function') {
    const openCodeAuth = await resolveOpenCodeAuth(getAuth);
    
    // Only use OpenCode auth if the access token is valid (not expired)
    if (openCodeAuth && hasValidAccessToken(openCodeAuth)) {
      debugLogger.info('Using valid OpenCode native auth');
      return {
        auth: openCodeAuth,
        source: 'opencode',
      };
    }
    
    // OpenCode auth exists but is expired or invalid
    // Fall through to local credentials
    if (openCodeAuth) {
      debugLogger.info('OpenCode auth exists but token expired, falling back to local');
    }
  } else {
    debugLogger.debug('getAuth not available, skipping OpenCode native auth');
  }
  
  // 2. Fallback to local credentials (token manager handles refresh)
  const localAuth = await resolveLocalAuth(tokenManager);
  
  if (localAuth) {
    return {
      auth: localAuth,
      source: 'local',
    };
  }
  
  // 3. No auth available
  debugLogger.warn('No authentication available from any source');
  return {
    auth: null,
    source: 'none',
  };
}

/**
 * Check if a runtime auth needs refresh
 */
export function needsRefresh(auth: RuntimeAuth, bufferMs = 30000): boolean {
  if (!auth.expires) return false; // Can't determine, assume okay
  return Date.now() >= auth.expires - bufferMs;
}

/**
 * Check if auth has a valid access token for immediate use
 */
export function hasValidAccessToken(auth: RuntimeAuth | null): boolean {
  if (!auth?.access) return false;
  if (!auth.expires) return true; // No expiry info, assume valid
  return Date.now() < auth.expires - 30000;
}
