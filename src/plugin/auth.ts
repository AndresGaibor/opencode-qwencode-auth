/**
 * Qwen Credentials Management
 *
 * Handles saving credentials to ~/.qwen/oauth_creds.json
 * Compatible with qwen-code official client format
 */

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, writeFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import type { QwenCredentials } from '../types.js';
import { QWEN_API_CONFIG } from '../constants.js';
import { createDebugLogger } from '../utils/debug-logger.js';

const debugLogger = createDebugLogger('AUTH');

/**
 * Get the path to the credentials file
 * Supports test override via QWEN_TEST_CREDS_PATH environment variable
 */
export function getCredentialsPath(): string {
  // Check for test override (prevents tests from modifying user credentials)
  if (process.env.QWEN_TEST_CREDS_PATH) {
    return process.env.QWEN_TEST_CREDS_PATH;
  }
  const homeDir = homedir();
  return join(homeDir, '.qwen', 'oauth_creds.json');
}

/**
 * Validate credentials structure
 * Matches official client's validateCredentials() function
 */
function validateCredentials(data: unknown): QwenCredentials {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid credentials format: expected object');
  }

  const creds = data as Partial<QwenCredentials>;
  const requiredFields = ['accessToken', 'tokenType'] as const;

  // Validate required string fields
  for (const field of requiredFields) {
    if (!creds[field] || typeof creds[field] !== 'string') {
      throw new Error(`Invalid credentials: missing or invalid ${field}`);
    }
  }

  // Validate refreshToken (optional but should be string if present)
  if (creds.refreshToken !== undefined && typeof creds.refreshToken !== 'string') {
    throw new Error('Invalid credentials: refreshToken must be a string');
  }

  // Validate expiryDate (required for token management)
  if (!creds.expiryDate || typeof creds.expiryDate !== 'number') {
    throw new Error('Invalid credentials: missing or invalid expiryDate');
  }

  // Validate resourceUrl (optional but should be string if present)
  if (creds.resourceUrl !== undefined && typeof creds.resourceUrl !== 'string') {
    throw new Error('Invalid credentials: resourceUrl must be a string');
  }

  // Validate scope (optional but should be string if present)
  if (creds.scope !== undefined && typeof creds.scope !== 'string') {
    throw new Error('Invalid credentials: scope must be a string');
  }

  return {
    accessToken: creds.accessToken!,
    tokenType: creds.tokenType!,
    refreshToken: creds.refreshToken,
    resourceUrl: creds.resourceUrl,
    expiryDate: creds.expiryDate!,
    scope: creds.scope,
  };
}

/**
 * Load credentials from file and map to camelCase QwenCredentials
 * Includes comprehensive validation matching official client
 * Handles corrupted files gracefully with detailed error reporting
 */
export function loadCredentials(): QwenCredentials | null {
  const credPath = getCredentialsPath();
  
  if (!existsSync(credPath)) {
    debugLogger.debug('Credentials file does not exist', { path: credPath });
    return null;
  }

  try {
    // Get file stats for diagnostic info
    const stats = statSync(credPath);
    
    // Read file content
    let content: string;
    try {
      content = readFileSync(credPath, 'utf8');
    } catch (readError) {
      debugLogger.error('Failed to read credentials file', {
        path: credPath,
        error: readError instanceof Error ? readError.message : String(readError),
        fileSize: stats.size,
        modified: stats.mtime.toISOString()
      });
      return null;
    }

    // Check for empty file
    if (!content || content.trim().length === 0) {
      debugLogger.warn('Credentials file is empty', {
        path: credPath,
        fileSize: stats.size
      });
      return null;
    }

    // Parse JSON
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (parseError) {
      debugLogger.error('Credentials file contains invalid JSON', {
        path: credPath,
        error: parseError instanceof Error ? parseError.message : String(parseError),
        fileSize: stats.size,
        contentPreview: content.substring(0, 100) + (content.length > 100 ? '...' : '')
      });
      return null;
    }

    // Validate data is an object
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      debugLogger.error('Credentials file does not contain a valid object', {
        path: credPath,
        dataType: typeof data,
        isArray: Array.isArray(data)
      });
      return null;
    }
    
    // Convert snake_case (file format) to camelCase (internal format)
    // This matches qwen-code format for compatibility
    const converted: QwenCredentials = {
      accessToken: (data as Record<string, unknown>).access_token as string,
      tokenType: ((data as Record<string, unknown>).token_type as string) || 'Bearer',
      refreshToken: (data as Record<string, unknown>).refresh_token as string | undefined,
      resourceUrl: (data as Record<string, unknown>).resource_url as string | undefined,
      expiryDate: (data as Record<string, unknown>).expiry_date as number | undefined,
      scope: (data as Record<string, unknown>).scope as string | undefined,
    };
    
    // Validate converted credentials structure
    const validated = validateCredentials(converted);
    
    debugLogger.debug('Credentials loaded successfully', {
      path: credPath,
      hasAccessToken: !!validated.accessToken,
      hasRefreshToken: !!validated.refreshToken,
      expiryDate: validated.expiryDate ? new Date(validated.expiryDate).toISOString() : 'N/A'
    });
    
    return validated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugLogger.error('Unexpected error loading credentials', {
      path: credPath,
      error: message,
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 3).join('\n') : undefined
    });
    
    return null;
  }
}

/**
 * Resolve the API base URL based on the token region
 */
export function resolveBaseUrl(resourceUrl?: string): string {
  if (!resourceUrl) return QWEN_API_CONFIG.portalBaseUrl;

  if (resourceUrl.includes('portal.qwen.ai')) {
    return QWEN_API_CONFIG.portalBaseUrl;
  }

  if (resourceUrl.includes('dashscope')) {
    // Both dashscope and dashscope-intl use similar URL patterns
    if (resourceUrl.includes('dashscope-intl')) {
      return 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
    }
    return QWEN_API_CONFIG.defaultBaseUrl;
  }

  return QWEN_API_CONFIG.portalBaseUrl;
}

/**
 * Save credentials to file in qwen-code compatible format
 * Uses atomic write (temp file + rename) to prevent corruption
 */
export function saveCredentials(credentials: QwenCredentials): void {
  const credPath = getCredentialsPath();
  const dir = dirname(credPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Save in qwen-code format for compatibility
  const data = {
    access_token: credentials.accessToken,
    token_type: credentials.tokenType || 'Bearer',
    refresh_token: credentials.refreshToken,
    resource_url: credentials.resourceUrl,
    expiry_date: credentials.expiryDate,
    scope: credentials.scope,
  };

  // ATOMIC WRITE: temp file + rename to prevent corruption
  const tempPath = `${credPath}.tmp.${randomUUID()}`;
  
  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2));
    renameSync(tempPath, credPath); // Atomic on POSIX systems
  } catch (error) {
    // Cleanup temp file if rename fails
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {}
    throw error;
  }
}
