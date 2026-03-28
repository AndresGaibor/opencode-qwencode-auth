/**
 * OpenCode Token Refresh and Sync
 *
 * Handles:
 * - Refreshing tokens when they expire
 * - Updating OpenCode's native auth via client.auth.set()
 * - Syncing to local credentials file for qwen-code compatibility
 */

import type { OpenCodeOAuthAuth, RuntimeAuth } from '../types.js';
import type { QwenCredentials } from '../types.js';
import { refreshAccessToken } from '../qwen/oauth.js';
import { saveCredentials } from './auth.js';
import { parseQwenRefreshParts, formatQwenRefreshParts } from './opencode-auth.js';
import { createDebugLogger } from '../utils/debug-logger.js';
import { CredentialsClearRequiredError } from '../errors.js';

const debugLogger = createDebugLogger('OPENCODE_TOKEN');

/**
 * OpenCode client interface - minimal subset needed for auth updates
 */
export interface OpenCodeClient {
  auth: {
    set(params: {
      path: { id: string };
      body: OpenCodeOAuthAuth;
    }): Promise<void>;
  };
}

/**
 * Token refresh options
 */
export interface RefreshOptions {
  client: OpenCodeClient;
  providerId: string;
  syncToLocal?: boolean; // Default: true
}

/**
 * Result of token refresh
 */
export interface RefreshResult {
  success: boolean;
  auth?: OpenCodeOAuthAuth;
  error?: Error;
}

/**
 * Refresh an OpenCode OAuth token and update both OpenCode and local storage
 * 
 * @param currentAuth - Current OpenCode auth (from getAuth())
 * @param options - Refresh options including client and provider ID
 * @returns Refresh result with new auth or error
 */
export async function refreshOpenCodeToken(
  currentAuth: OpenCodeOAuthAuth,
  options: RefreshOptions
): Promise<RefreshResult> {
  const { client, providerId, syncToLocal = true } = options;
  
  debugLogger.info('Starting OpenCode token refresh', {
    hasRefreshToken: !!currentAuth.refresh,
    providerId,
  });
  
  // Parse refresh token from the packed format
  const parts = parseQwenRefreshParts(currentAuth.refresh);
  
  if (!parts.refreshToken) {
    debugLogger.error('No refresh token available in OpenCode auth');
    return {
      success: false,
      error: new Error('No refresh token available'),
    };
  }
  
  try {
    // Call Qwen API to refresh the token
    const refreshedCreds = await refreshAccessToken(parts.refreshToken);
    
    debugLogger.info('Token refresh API successful', {
      hasAccessToken: !!refreshedCreds.accessToken,
      hasRefreshToken: !!refreshedCreds.refreshToken,
      expiryDate: refreshedCreds.expiryDate ? new Date(refreshedCreds.expiryDate).toISOString() : 'N/A',
    });
    
    // Preserve resourceUrl from original auth if not returned
    const resourceUrl = refreshedCreds.resourceUrl || parts.resourceUrl;
    
    // Create new OpenCode auth object
    const newAuth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: refreshedCreds.accessToken,
      refresh: formatQwenRefreshParts({
        refreshToken: refreshedCreds.refreshToken || parts.refreshToken,
        resourceUrl,
      }),
      expires: refreshedCreds.expiryDate,
    };
    
    // Update OpenCode's native auth
    try {
      await client.auth.set({
        path: { id: providerId },
        body: newAuth,
      });
      debugLogger.info('Updated OpenCode native auth');
    } catch (setError) {
      debugLogger.error('Failed to update OpenCode auth', setError);
      // Continue - we can still sync locally
    }
    
    // Sync to local file for qwen-code compatibility
    if (syncToLocal) {
      try {
        const localCreds: QwenCredentials = {
          accessToken: refreshedCreds.accessToken,
          tokenType: refreshedCreds.tokenType,
          refreshToken: refreshedCreds.refreshToken || parts.refreshToken,
          resourceUrl,
          expiryDate: refreshedCreds.expiryDate,
          scope: refreshedCreds.scope,
        };
        saveCredentials(localCreds);
        debugLogger.info('Synced credentials to local file');
      } catch (saveError) {
        debugLogger.error('Failed to sync to local file', saveError);
        // Non-fatal - OpenCode auth was updated
      }
    }
    
    return {
      success: true,
      auth: newAuth,
    };
  } catch (error) {
    // Handle credentials clear required (invalid_grant)
    if (error instanceof CredentialsClearRequiredError) {
      debugLogger.warn('Refresh token invalid, need to re-authenticate');
      
      // Clear OpenCode auth
      try {
        await client.auth.set({
          path: { id: providerId },
          body: {
            type: 'oauth',
            refresh: '',
          },
        });
        debugLogger.info('Cleared invalid OpenCode auth');
      } catch (clearError) {
        debugLogger.error('Failed to clear OpenCode auth', clearError);
      }
    }
    
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Sync credentials from local file to OpenCode
 * Used when local credentials are updated externally (e.g., by qwen-code)
 */
export async function syncLocalToOpenCode(
  credentials: QwenCredentials,
  client: OpenCodeClient,
  providerId: string
): Promise<boolean> {
  try {
    const auth: OpenCodeOAuthAuth = {
      type: 'oauth',
      access: credentials.accessToken,
      refresh: formatQwenRefreshParts({
        refreshToken: credentials.refreshToken,
        resourceUrl: credentials.resourceUrl,
      }),
      expires: credentials.expiryDate,
    };
    
    await client.auth.set({
      path: { id: providerId },
      body: auth,
    });
    
    debugLogger.info('Synced local credentials to OpenCode');
    return true;
  } catch (error) {
    debugLogger.error('Failed to sync to OpenCode', error);
    return false;
  }
}

/**
 * Sync OpenCode auth to local file
 * Used when OpenCode auth is the source of truth
 */
export function syncOpenCodeToLocal(auth: OpenCodeOAuthAuth): boolean {
  try {
    const parts = parseQwenRefreshParts(auth.refresh);
    
    const credentials: QwenCredentials = {
      accessToken: auth.access || '',
      tokenType: 'Bearer',
      refreshToken: parts.refreshToken,
      resourceUrl: parts.resourceUrl,
      expiryDate: auth.expires,
    };
    
    saveCredentials(credentials);
    debugLogger.info('Synced OpenCode auth to local file');
    return true;
  } catch (error) {
    debugLogger.error('Failed to sync to local file', error);
    return false;
  }
}

/**
 * Convert RuntimeAuth back to OpenCodeOAuthAuth for refresh
 */
export function runtimeAuthToOpenCodeAuth(runtimeAuth: RuntimeAuth): OpenCodeOAuthAuth {
  return {
    type: 'oauth',
    access: runtimeAuth.access,
    refresh: formatQwenRefreshParts({
      refreshToken: runtimeAuth.refresh,
      resourceUrl: runtimeAuth.resourceUrl,
    }),
    expires: runtimeAuth.expires,
  };
}
