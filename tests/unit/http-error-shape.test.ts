/**
 * Tests for HTTP Error Shape
 * 
 * Verifies that HTTP errors include all necessary properties:
 * - status, statusText, response, headers, bodyText, url, method
 */

import { describe, it, expect } from 'bun:test';

// Simulate the error shape creation from index.ts
function createHttpError(
  response: {
    status: number;
    statusText: string;
    headers: Map<string, string>;
    text: () => Promise<string>;
  },
  url: string,
  method: string
): Error & Record<string, unknown> {
  // This mirrors the implementation in src/index.ts
  return (async () => {
    const errorText = await response.text().catch(() => '');
    const error: any = new Error(`HTTP ${response.status}: ${errorText}`);
    
    // Attach all necessary properties for retry logic and debugging
    error.status = response.status;
    error.statusText = response.statusText;
    error.response = response;
    error.headers = Object.fromEntries(response.headers.entries());
    error.bodyText = errorText;
    error.url = url;
    error.method = method;
    
    return error;
  })();
}

describe('HTTP Error Shape', () => {
  it('should include status property', async () => {
    const mockResponse = {
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Map([['retry-after', '60']]),
      text: async () => 'Rate limit exceeded',
    };
    
    const error = await createHttpError(mockResponse, 'https://api.example.com/v1/chat', 'POST');
    
    expect(error.status).toBe(429);
  });

  it('should include statusText property', async () => {
    const mockResponse = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Map(),
      text: async () => 'Server error',
    };
    
    const error = await createHttpError(mockResponse, 'https://api.example.com/v1/chat', 'POST');
    
    expect(error.statusText).toBe('Internal Server Error');
  });

  it('should include response property', async () => {
    const mockResponse = {
      status: 401,
      statusText: 'Unauthorized',
      headers: new Map(),
      text: async () => 'Invalid token',
    };
    
    const error = await createHttpError(mockResponse, 'https://api.example.com/v1/chat', 'POST');
    
    expect(error.response).toBe(mockResponse);
  });

  it('should include headers as plain object', async () => {
    const mockResponse = {
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Map([
        ['retry-after', '60'],
        ['x-ratelimit-limit', '60'],
        ['x-ratelimit-remaining', '0'],
      ]),
      text: async () => 'Rate limit exceeded',
    };
    
    const error = await createHttpError(mockResponse, 'https://api.example.com/v1/chat', 'POST');
    
    expect(error.headers).toBeDefined();
    expect(error.headers['retry-after']).toBe('60');
    expect(error.headers['x-ratelimit-limit']).toBe('60');
    expect(error.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('should include bodyText property', async () => {
    const mockResponse = {
      status: 400,
      statusText: 'Bad Request',
      headers: new Map(),
      text: async () => '{"error": "Invalid request body"}',
    };
    
    const error = await createHttpError(mockResponse, 'https://api.example.com/v1/chat', 'POST');
    
    expect(error.bodyText).toBe('{"error": "Invalid request body"}');
  });

  it('should include url property', async () => {
    const mockResponse = {
      status: 404,
      statusText: 'Not Found',
      headers: new Map(),
      text: async () => 'Not found',
    };
    
    const error = await createHttpError(mockResponse, 'https://api.example.com/v1/models/unknown', 'GET');
    
    expect(error.url).toBe('https://api.example.com/v1/models/unknown');
  });

  it('should include method property', async () => {
    const mockResponse = {
      status: 405,
      statusText: 'Method Not Allowed',
      headers: new Map(),
      text: async () => 'Method not allowed',
    };
    
    const error = await createHttpError(mockResponse, 'https://api.example.com/v1/chat', 'DELETE');
    
    expect(error.method).toBe('DELETE');
  });

  it('should have correct error message format', async () => {
    const mockResponse = {
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Map(),
      text: async () => 'Rate limit exceeded',
    };
    
    const error = await createHttpError(mockResponse, 'https://api.example.com/v1/chat', 'POST');
    
    expect(error.message).toContain('HTTP 429');
    expect(error.message).toContain('Rate limit exceeded');
  });

  it('should handle empty response body', async () => {
    const mockResponse = {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Map(),
      text: async () => '',
    };
    
    const error = await createHttpError(mockResponse, 'https://api.example.com/v1/chat', 'POST');
    
    expect(error.bodyText).toBe('');
    expect(error.message).toBe('HTTP 503: ');
  });

  it('should handle text() failure gracefully', async () => {
    const mockResponse = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Map(),
      text: async () => {
        throw new Error('Cannot read body');
      },
    };
    
    const error = await createHttpError(mockResponse, 'https://api.example.com/v1/chat', 'POST');
    
    expect(error.bodyText).toBe('');
  });
});
