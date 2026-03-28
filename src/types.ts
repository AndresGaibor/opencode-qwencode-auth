/**
 * Type Definitions for Qwen Auth Plugin
 */

/**
 * Qwen credentials stored in ~/.qwen/oauth_creds.json
 * Uses camelCase for internal use, snake_case for file format
 */
export interface QwenCredentials {
  accessToken: string;
  tokenType?: string;      // "Bearer"
  refreshToken?: string;
  resourceUrl?: string;    // "portal.qwen.ai" - base URL da API
  expiryDate?: number;     // timestamp em ms (formato qwen-code)
  scope?: string;          // "openid profile email"
}

/**
 * OpenCode's native OAuth authentication shape
 * This is what getAuth() returns and what client.auth.set() expects
 * 
 * Key differences from QwenCredentials:
 * - Uses `access`/`refresh`/`expires` (not `accessToken`/`refreshToken`/`expiryDate`)
 * - Has a `type: "oauth"` discriminator
 */
export interface OpenCodeOAuthAuth {
  type: "oauth";
  access?: string;
  refresh: string;
  expires?: number;
}

/**
 * Runtime auth source indicator
 * Used to track where the current auth came from
 */
export type AuthSource = 'opencode' | 'local';

/**
 * Resolved auth ready for use in requests
 */
export interface RuntimeAuth {
  source: AuthSource;
  access: string;
  refresh?: string;
  expires?: number;
  resourceUrl?: string;
}
