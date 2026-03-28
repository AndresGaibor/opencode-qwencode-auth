/**
 * OpenCode OAuth Auth Helpers
 *
 * Provides type definitions and helpers for working with OpenCode's
 * native OAuth authentication shape.
 *
 * Key differences from QwenCredentials:
 * - OpenCode uses `access`/`refresh`/`expires` (not `accessToken`/`refreshToken`/`expiryDate`)
 * - The `refresh` field can encode additional metadata (like resourceUrl)
 */

/**
 * OpenCode's native OAuth authentication shape
 * This is what getAuth() returns and what client.auth.set() expects
 */
export interface OpenCodeOAuthAuth {
  type: "oauth";
  access?: string;
  refresh: string;
  expires?: number;
}

/**
 * Parsed refresh field containing Qwen-specific metadata
 * Format: `refreshToken|resourceUrl`
 */
export interface QwenRefreshParts {
  refreshToken: string;
  resourceUrl?: string;
}

/**
 * Type guard to check if an auth object is OpenCode OAuth
 */
export function isOpenCodeOAuthAuth(auth: unknown): auth is OpenCodeOAuthAuth {
  if (!auth || typeof auth !== 'object') return false;
  const a = auth as Record<string, unknown>;
  return (
    a['type'] === 'oauth' &&
    typeof a['refresh'] === 'string' &&
    (a['access'] === undefined || typeof a['access'] === 'string') &&
    (a['expires'] === undefined || typeof a['expires'] === 'number')
  );
}

/**
 * Check if an access token is expired or about to expire
 * Uses a 30-second buffer to prevent edge cases
 */
export function accessTokenExpired(auth: OpenCodeOAuthAuth, bufferMs = 30000): boolean {
  if (!auth.expires) return true; // No expiry info = assume expired
  return Date.now() >= auth.expires - bufferMs;
}

/**
 * Check if an access token is valid (exists and not expired)
 */
export function accessTokenValid(auth: OpenCodeOAuthAuth, bufferMs = 30000): boolean {
  if (!auth.access) return false;
  return !accessTokenExpired(auth, bufferMs);
}

/**
 * Parse the refresh field to extract Qwen-specific metadata
 * Format: `refreshToken|resourceUrl`
 * 
 * Examples:
 * - "abc123|https://portal.qwen.ai" → { refreshToken: "abc123", resourceUrl: "https://portal.qwen.ai" }
 * - "abc123" → { refreshToken: "abc123" }
 */
export function parseQwenRefreshParts(refresh: string): QwenRefreshParts {
  const pipeIndex = refresh.indexOf('|');
  
  if (pipeIndex === -1) {
    // No pipe found, entire string is refresh token
    return { refreshToken: refresh };
  }
  
  const refreshToken = refresh.slice(0, pipeIndex);
  const resourceUrl = refresh.slice(pipeIndex + 1) || undefined;
  
  return { refreshToken, resourceUrl };
}

/**
 * Format refresh token and resourceUrl into a single string
 * Format: `refreshToken|resourceUrl`
 * 
 * Examples:
 * - { refreshToken: "abc123", resourceUrl: "https://portal.qwen.ai" } → "abc123|https://portal.qwen.ai"
 * - { refreshToken: "abc123" } → "abc123"
 */
export function formatQwenRefreshParts(parts: QwenRefreshParts): string {
  if (!parts.resourceUrl) {
    return parts.refreshToken;
  }
  return `${parts.refreshToken}|${parts.resourceUrl}`;
}

/**
 * Create an OpenCode OAuth auth object from Qwen credentials
 */
export function createOpenCodeAuth(params: {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  resourceUrl?: string;
}): OpenCodeOAuthAuth {
  const refresh = params.refreshToken
    ? formatQwenRefreshParts({ 
        refreshToken: params.refreshToken, 
        resourceUrl: params.resourceUrl 
      })
    : '';
    
  return {
    type: 'oauth',
    access: params.accessToken,
    refresh,
    expires: params.expiryDate,
  };
}

/**
 * Extract Qwen credentials from an OpenCode OAuth auth object
 */
export function extractQwenCredentials(auth: OpenCodeOAuthAuth): {
  accessToken?: string;
  refreshToken?: string;
  expiryDate?: number;
  resourceUrl?: string;
} {
  const parts = parseQwenRefreshParts(auth.refresh);
  
  return {
    accessToken: auth.access,
    refreshToken: parts.refreshToken,
    expiryDate: auth.expires,
    resourceUrl: parts.resourceUrl,
  };
}
