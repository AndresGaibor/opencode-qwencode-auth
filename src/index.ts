/**
 * OpenCode Qwen Auth Plugin
 *
 * Plugin de autenticacao OAuth para Qwen, baseado no qwen-code.
 * Implementa Device Flow (RFC 8628) para autenticacao.
 *
 * Provider: qwen-code -> portal.qwen.ai/v1
 * Modelos: qwen3-coder-plus, qwen3-coder-flash, coder-model, vision-model
 *
 * Auth Architecture:
 * - OpenCode native auth is the primary source (via getAuth())
 * - Local credentials file (~/.qwen/oauth_creds.json) is fallback/sync
 * - Both are kept in sync for compatibility with qwen-code
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { QWEN_PROVIDER_ID, QWEN_API_CONFIG, QWEN_MODELS, getQwenHeaders, resolveReasoningDefault } from './constants.js';
import type { QwenCredentials, OpenCodeOAuthAuth, RuntimeAuth } from './types.js';
import { resolveBaseUrl } from './plugin/auth.js';
import {
  generatePKCE,
  requestDeviceAuthorization,
  pollDeviceToken,
  tokenResponseToCredentials,
  SlowDownError,
} from './qwen/oauth.js';
import { retryWithBackoff, getErrorStatus } from './utils/retry.js';
import { RequestQueue } from './plugin/request-queue.js';
import { tokenManager } from './plugin/token-manager.js';
import { createDebugLogger } from './utils/debug-logger.js';
import { formatQwenRefreshParts, isOpenCodeOAuthAuth, parseQwenRefreshParts } from './plugin/opencode-auth.js';
import { resolveRuntimeAuth, hasValidAccessToken, type GetAuthFn } from './plugin/runtime-auth.js';
import { refreshOpenCodeToken, runtimeAuthToOpenCodeAuth, type OpenCodeClient } from './plugin/opencode-token.js';
import { transformResponse } from './plugin/response-transform.js';

const debugLogger = createDebugLogger('PLUGIN');

// Global session ID for the plugin lifetime
const PLUGIN_SESSION_ID = randomUUID();

// Singleton request queue for throttling (shared across all requests)
const requestQueue = new RequestQueue();

// ============================================
// Helpers
// ============================================

function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'rundll32' : 'xdg-open';
    const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref?.();
  } catch {
    // Fallback: show URL in stderr
    console.error('\n[Qwen Auth] Unable to open browser automatically.');
    console.error('Please open this URL manually to authenticate:\n');
    console.error(`  ${url}\n`);
  }
}

/**
 * Check if error is authentication-related (401, 403, token expired)
 * Mirrors official client's isAuthError logic
 */
function isAuthError(error: unknown): boolean {
  if (!error) return false;

  const errorMessage = error instanceof Error
    ? error.message.toLowerCase()
    : String(error).toLowerCase();

  const status = getErrorStatus(error);

  return (
    status === 401 ||
    status === 403 ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('forbidden') ||
    errorMessage.includes('invalid access token') ||
    errorMessage.includes('invalid api key') ||
    errorMessage.includes('token expired') ||
    errorMessage.includes('authentication') ||
    errorMessage.includes('access denied') ||
    (errorMessage.includes('token') && errorMessage.includes('expired'))
  );
}

// ============================================
// Plugin Principal
// ============================================

/**
 * Plugin context provided by OpenCode
 */
interface PluginContext {
  client: OpenCodeClient;
  directory: string;
}

export const QwenAuthPlugin = async (ctx: PluginContext) => {
  const { client, directory } = ctx;
  
  debugLogger.info('Plugin initialized', {
    sessionId: PLUGIN_SESSION_ID,
    directory,
    hasClient: !!client,
  });

  return {
    auth: {
      provider: QWEN_PROVIDER_ID,

      loader: async (
        getAuth: GetAuthFn,
        provider: { models?: Record<string, { cost?: { input: number; output: number } }> },
      ) => {
        // Zerar custo dos modelos (gratuito via OAuth)
        if (provider?.models) {
          for (const model of Object.values(provider.models)) {
            if (model) model.cost = { input: 0, output: 0 };
          }
        }

        // ============================================
        // Auth Resolution with Auto-Refresh
        // ============================================
        // Priority:
        // 1. OpenCode auth (if valid or refreshable)
        // 2. Local credentials (fallback)
        // 3. Force re-auth (return null)
        
        let runtimeAuth: RuntimeAuth | null = null;
        let authSource: 'opencode' | 'local' | 'none' = 'none';

        // Try OpenCode native auth first
        if (typeof getAuth === 'function') {
          try {
            const openCodeAuth = await getAuth();
            
            if (openCodeAuth && isOpenCodeOAuthAuth(openCodeAuth)) {
              // Check if token is valid
              const parts = parseQwenRefreshParts(openCodeAuth.refresh);
              const isExpired = !openCodeAuth.expires || Date.now() >= openCodeAuth.expires - 30000;
              
              if (openCodeAuth.access && !isExpired) {
                // Token is valid, use it
                runtimeAuth = {
                  source: 'opencode',
                  access: openCodeAuth.access,
                  refresh: parts.refreshToken,
                  expires: openCodeAuth.expires,
                  resourceUrl: parts.resourceUrl,
                };
                authSource = 'opencode';
                debugLogger.info('Using valid OpenCode native auth');
              } else if (parts.refreshToken) {
                // Token expired but we have refresh token - try to refresh
                debugLogger.info('OpenCode token expired, attempting refresh...');
                
                const refreshResult = await refreshOpenCodeToken(openCodeAuth, {
                  client,
                  providerId: QWEN_PROVIDER_ID,
                  syncToLocal: true,
                });
                
                if (refreshResult.success && refreshResult.auth) {
                  const newParts = parseQwenRefreshParts(refreshResult.auth.refresh);
                  runtimeAuth = {
                    source: 'opencode',
                    access: refreshResult.auth.access || '',
                    refresh: newParts.refreshToken,
                    expires: refreshResult.auth.expires,
                    resourceUrl: newParts.resourceUrl,
                  };
                  authSource = 'opencode';
                  debugLogger.info('OpenCode token refreshed successfully');
                } else {
                  // Refresh failed - clear invalid OpenCode auth and fallback to local
                  debugLogger.warn('OpenCode token refresh failed, falling back to local credentials');
                  
                  // Clear the invalid OpenCode auth
                  try {
                    await client.auth.set({
                      path: { id: QWEN_PROVIDER_ID },
                      body: { type: 'oauth', refresh: '' },
                    });
                  } catch (e) {
                    debugLogger.error('Failed to clear invalid OpenCode auth', e);
                  }
                  
                  // Fall through to local fallback (don't return null yet)
                }
              } else {
                // No refresh token - clear invalid OpenCode auth and fallback to local
                debugLogger.warn('OpenCode auth expired with no refresh token, falling back to local');
                
                try {
                  await client.auth.set({
                    path: { id: QWEN_PROVIDER_ID },
                    body: { type: 'oauth', refresh: '' },
                  });
                } catch (e) {
                  debugLogger.error('Failed to clear invalid OpenCode auth', e);
                }
                
                // Fall through to local fallback
              }
            }
          } catch (e) {
            debugLogger.error('Failed to get OpenCode auth, falling back to local', e);
            // Fall through to local fallback
          }
        }

        // Fallback to local credentials if OpenCode auth not available
        if (!runtimeAuth) {
          const localCreds = await tokenManager.getValidCredentials();
          
          if (localCreds?.accessToken) {
            runtimeAuth = {
              source: 'local',
              access: localCreds.accessToken,
              refresh: localCreds.refreshToken,
              expires: localCreds.expiryDate,
              resourceUrl: localCreds.resourceUrl,
            };
            authSource = 'local';
            debugLogger.info('Using local credentials');
          }
        }

        // No credentials available from any source
        if (!runtimeAuth?.access) {
          debugLogger.warn('No valid credentials available from any source');
          console.error('\n[Qwen Auth] No credentials found. Please authenticate:');
          console.error('  Run: opencode auth login\n');
          return null;
        }

        const baseURL = resolveBaseUrl(runtimeAuth.resourceUrl);

        debugLogger.info('Loader initialized', {
          source: authSource,
          hasBaseURL: !!baseURL,
        });

        return {
          apiKey: runtimeAuth.access,
          baseURL: baseURL,
          headers: {
            ...getQwenHeaders(),
          },
          // Custom fetch with throttling, retry and 401 recovery
          fetch: async (url: string, options: any = {}) => {
            return requestQueue.enqueue(async () => {
              let authRetryCount = 0;

              const executeRequest = async (): Promise<Response> => {
                // Resolve auth FRESH for each request (like Antigravity)
                // This ensures we use the most up-to-date credentials
                const authResult = await resolveRuntimeAuth(getAuth, tokenManager);
                const runtimeAuth = authResult.auth;
                
                if (!runtimeAuth?.access) {
                  throw new Error('No access token available');
                }

                const token = runtimeAuth.access;
                const authSource = runtimeAuth.source;

                // Prepare merged headers
                const mergedHeaders: Record<string, string> = {
                  ...getQwenHeaders(),
                };

                // Merge provided headers (handles both plain object and Headers instance)
                if (options.headers) {
                  if (typeof (options.headers as any).entries === 'function') {
                    for (const [k, v] of (options.headers as any).entries()) {
                      const kl = k.toLowerCase();
                      if (!kl.startsWith('x-dashscope') && kl !== 'user-agent' && kl !== 'authorization') {
                        mergedHeaders[k] = v;
                      }
                    }
                  } else {
                    for (const [k, v] of Object.entries(options.headers)) {
                      const kl = k.toLowerCase();
                      if (!kl.startsWith('x-dashscope') && kl !== 'user-agent' && kl !== 'authorization') {
                        mergedHeaders[k] = v as string;
                      }
                    }
                  }
                }

                // Force our Authorization token
                mergedHeaders['Authorization'] = `Bearer ${token}`;

                // Perform the request
                const response = await fetch(url, {
                  ...options,
                  headers: mergedHeaders
                });

                // Reactive recovery for 401 (token expired mid-session)
                if (response.status === 401 && authRetryCount < 1) {
                  authRetryCount++;
                  debugLogger.warn('401 Unauthorized detected. Attempting token refresh...', {
                    url: url.substring(0, 100) + (url.length > 100 ? '...' : ''),
                    attempt: authRetryCount,
                    authSource,
                  });
                  
                  const refreshStart = Date.now();
                  let refreshedAuth: RuntimeAuth | null = null;
                  
                  // Refresh based on auth source
                  if (authSource === 'opencode' && typeof getAuth === 'function') {
                    // Refresh via OpenCode
                    try {
                      const currentAuth = await getAuth();
                      if (currentAuth && isOpenCodeOAuthAuth(currentAuth)) {
                        const result = await refreshOpenCodeToken(currentAuth, {
                          client,
                          providerId: QWEN_PROVIDER_ID,
                          syncToLocal: true,
                        });
                        
                        if (result.success && result.auth) {
                          refreshedAuth = {
                            source: 'opencode',
                            access: result.auth.access || '',
                            refresh: result.auth.refresh,
                            expires: result.auth.expires,
                            resourceUrl: parseRefreshForUrl(result.auth.refresh),
                          };
                        }
                      }
                    } catch (refreshError) {
                      debugLogger.error('OpenCode refresh failed', refreshError);
                    }
                  } else {
                    // Refresh via local token manager
                    const refreshedCreds = await tokenManager.getValidCredentials(true);
                    if (refreshedCreds?.accessToken) {
                      refreshedAuth = {
                        source: 'local',
                        access: refreshedCreds.accessToken,
                        refresh: refreshedCreds.refreshToken,
                        expires: refreshedCreds.expiryDate,
                        resourceUrl: refreshedCreds.resourceUrl,
                      };
                      
                      // Sync to OpenCode if we have a client
                      if (client && refreshedCreds.refreshToken) {
                        try {
                          const openCodeAuth: OpenCodeOAuthAuth = {
                            type: 'oauth',
                            access: refreshedCreds.accessToken,
                            refresh: formatQwenRefreshParts({
                              refreshToken: refreshedCreds.refreshToken,
                              resourceUrl: refreshedCreds.resourceUrl,
                            }),
                            expires: refreshedCreds.expiryDate,
                          };
                          await client.auth.set({
                            path: { id: QWEN_PROVIDER_ID },
                            body: openCodeAuth,
                          });
                          debugLogger.info('Synced refreshed local creds to OpenCode');
                        } catch (syncError) {
                          debugLogger.error('Failed to sync to OpenCode', syncError);
                        }
                      }
                    }
                  }
                  
                  const refreshElapsed = Date.now() - refreshStart;
                  
                  if (refreshedAuth) {
                    debugLogger.info('Token refreshed successfully, retrying request...', {
                      refreshElapsed,
                      newSource: refreshedAuth.source,
                    });
                    return executeRequest(); // Recursive retry with new token
                  } else {
                    debugLogger.error('Failed to refresh token after 401', {
                      refreshElapsed,
                    });
                  }
                }

                // Error handling for retryWithBackoff
                if (!response.ok) {
                  const errorText = await response.text().catch(() => '');
                  const error: any = new Error(`HTTP ${response.status}: ${errorText}`);
                  
                  // Attach all necessary properties for retry logic and debugging
                  error.status = response.status;
                  error.statusText = response.statusText;
                  error.response = response;
                  error.headers = Object.fromEntries(response.headers.entries());
                  error.bodyText = errorText;
                  error.url = url;
                  error.method = options?.method || 'GET';
                  
                  // Add context for debugging
                  debugLogger.error('Request failed', {
                    status: response.status,
                    statusText: response.statusText,
                    url: url.substring(0, 100) + (url.length > 100 ? '...' : ''),
                    method: error.method,
                    errorText: errorText.substring(0, 200) + (errorText.length > 200 ? '...' : ''),
                    hasRetryAfter: !!error.headers['retry-after']
                  });
                  
                  throw error;
                }

                // Transform response to ensure reasoning fields are present
                return transformResponse(response);
              };

              // Use official retry logic for 429/5xx errors
              return retryWithBackoff(() => executeRequest(), {
                authType: 'qwen-oauth',
                maxAttempts: 7,
                shouldRetryOnError: (error: any) => {
                  const status = error.status || getErrorStatus(error);
                  // Retry on 401 (handled by executeRequest recursion too), 429, and 5xx
                  return status === 401 || status === 429 || (status !== undefined && status >= 500 && status < 600);
                }
              });
            });
          }
        };
      },

      methods: [
        {
          type: 'oauth' as const,
          label: 'Qwen Code (qwen.ai OAuth)',
          authorize: async () => {
            const { verifier, challenge } = generatePKCE();

            try {
              const deviceAuth = await requestDeviceAuthorization(challenge);
              openBrowser(deviceAuth.verification_uri_complete);

              const POLLING_MARGIN_MS = 3000;

              return {
                url: deviceAuth.verification_uri_complete,
                instructions: `Codigo: ${deviceAuth.user_code}`,
                method: 'auto' as const,
                callback: async () => {
                  const startTime = Date.now();
                  const timeoutMs = deviceAuth.expires_in * 1000;
                  let interval = 5000;

                  while (Date.now() - startTime < timeoutMs) {
                    await new Promise(resolve => setTimeout(resolve, interval + POLLING_MARGIN_MS));

                    try {
                      const tokenResponse = await pollDeviceToken(deviceAuth.device_code, verifier);

                      if (tokenResponse) {
                        const credentials = tokenResponseToCredentials(tokenResponse);
                        tokenManager.setCredentials(credentials);

                        // Return in OpenCode format with resourceUrl packed in refresh
                        return {
                          type: 'success' as const,
                          access: credentials.accessToken,
                          refresh: formatQwenRefreshParts({
                            refreshToken: credentials.refreshToken,
                            resourceUrl: credentials.resourceUrl,
                          }),
                          expires: credentials.expiryDate || Date.now() + 3600000,
                        };
                      }
                    } catch (e) {
                      if (e instanceof SlowDownError) {
                        interval = Math.min(interval + 5000, 15000);
                      } else if (!(e instanceof Error) || !e.message.includes('authorization_pending')) {
                        return { type: 'failed' as const };
                      }
                    }
                  }

                  return { type: 'failed' as const };
                },
              };
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Erro desconhecido';
              return {
                url: '',
                instructions: `Erro: ${msg}`,
                method: 'auto' as const,
                callback: async () => ({ type: 'failed' as const }),
              };
            }
          },
        },
      ],
    },

    config: async (config: Record<string, unknown>) => {
      const providers = (config.provider as Record<string, unknown>) || {};

        providers[QWEN_PROVIDER_ID] = {
          npm: '@ai-sdk/openai-compatible',
          name: 'Qwen Code',
          options: { 
            baseURL: QWEN_API_CONFIG.baseUrl,
            headers: getQwenHeaders()
          },
        models: Object.fromEntries(
          Object.entries(QWEN_MODELS).map(([id, m]) => {
            const hasVision = 'capabilities' in m && m.capabilities?.vision;
            // Use environment variable override for reasoning
            const reasoningEnabled = resolveReasoningDefault(m.id);
            
            return [
              id,
              {
                id: m.id,
                name: m.name,
                reasoning: reasoningEnabled,
                tool_call: true, // Qwen models support function calling via OpenAI-compatible API
                limit: { context: m.contextWindow, output: m.maxOutput },
                cost: m.cost,
                modalities: { 
                  input: hasVision ? ['text', 'image'] : ['text'], 
                  output: ['text'] 
                },
              },
            ];
          })
        ),
      };

      config.provider = providers;
    },

    /**
     * Chat params hook - intercepts parameters before API call
     * Uses flat key format as per OpenCode plugin API
     */
    'chat.params': async (params: {
      model: string;
      messages?: unknown[];
      tools?: unknown[];
      temperature?: number;
      max_tokens?: number;
      [key: string]: unknown;
    }) => {
      const modelId = params.model;
      
      // Log for debugging - helps understand what parameters are being passed
      debugLogger.debug('chat.params hook called', {
        model: modelId,
        hasMessages: !!params.messages,
        hasTools: !!params.tools,
        temperature: params.temperature,
        max_tokens: params.max_tokens,
      });

      // Return params unchanged - future reasoning params can be added here
      return params;
    },
  };
};

/**
 * Helper to extract resourceUrl from packed refresh field
 */
function parseRefreshForUrl(refresh: string): string | undefined {
  const pipeIndex = refresh.indexOf('|');
  if (pipeIndex === -1) return undefined;
  return refresh.slice(pipeIndex + 1) || undefined;
}

export default QwenAuthPlugin;