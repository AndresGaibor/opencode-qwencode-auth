/**
 * Tests for Response Transformation
 */

import { describe, it, expect } from 'bun:test';
import {
  transformJSONResponse,
  transformSSEChunk,
  isJSONResponse,
  isSSEStream,
} from '../../src/plugin/response-transform.js';

describe('transformJSONResponse', () => {
  it('should copy reasoning to reasoning_content when missing', () => {
    const response = JSON.stringify({
      id: 'test-id',
      choices: [{
        message: {
          role: 'assistant',
          content: 'Hello',
          reasoning: 'Thinking about this...',
        }
      }]
    });

    const transformed = transformJSONResponse(response);
    const parsed = JSON.parse(transformed);

    expect(parsed.choices[0].message.reasoning).toBe('Thinking about this...');
    expect(parsed.choices[0].message.reasoning_content).toBe('Thinking about this...');
  });

  it('should copy reasoning_content to reasoning when missing', () => {
    const response = JSON.stringify({
      id: 'test-id',
      choices: [{
        message: {
          role: 'assistant',
          content: 'Hello',
          reasoning_content: 'Thinking content...',
        }
      }]
    });

    const transformed = transformJSONResponse(response);
    const parsed = JSON.parse(transformed);

    expect(parsed.choices[0].message.reasoning).toBe('Thinking content...');
    expect(parsed.choices[0].message.reasoning_content).toBe('Thinking content...');
  });

  it('should preserve both when both exist', () => {
    const response = JSON.stringify({
      id: 'test-id',
      choices: [{
        message: {
          role: 'assistant',
          content: 'Hello',
          reasoning: 'Original reasoning',
          reasoning_content: 'Original content',
        }
      }]
    });

    const transformed = transformJSONResponse(response);
    const parsed = JSON.parse(transformed);

    expect(parsed.choices[0].message.reasoning).toBe('Original reasoning');
    expect(parsed.choices[0].message.reasoning_content).toBe('Original content');
  });

  it('should preserve tool_calls', () => {
    const response = JSON.stringify({
      id: 'test-id',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call-123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location": "SF"}'
            }
          }]
        }
      }]
    });

    const transformed = transformJSONResponse(response);
    const parsed = JSON.parse(transformed);

    expect(parsed.choices[0].message.tool_calls).toHaveLength(1);
    expect(parsed.choices[0].message.tool_calls[0].id).toBe('call-123');
    expect(parsed.choices[0].message.tool_calls[0].function.name).toBe('get_weather');
  });

  it('should handle multiple choices', () => {
    const response = JSON.stringify({
      choices: [
        { message: { reasoning: 'First' } },
        { message: { reasoning_content: 'Second' } },
      ]
    });

    const transformed = transformJSONResponse(response);
    const parsed = JSON.parse(transformed);

    expect(parsed.choices[0].message.reasoning_content).toBe('First');
    expect(parsed.choices[1].message.reasoning).toBe('Second');
  });

  it('should handle invalid JSON gracefully', () => {
    const response = 'not valid json';
    const transformed = transformJSONResponse(response);
    expect(transformed).toBe('not valid json');
  });

  it('should preserve other response fields', () => {
    const response = JSON.stringify({
      id: 'test-id',
      object: 'chat.completion',
      created: 1234567890,
      model: 'qwen-3-coder',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
      choices: [{
        message: { content: 'Hello' }
      }]
    });

    const transformed = transformJSONResponse(response);
    const parsed = JSON.parse(transformed);

    expect(parsed.id).toBe('test-id');
    expect(parsed.model).toBe('qwen-3-coder');
    expect(parsed.usage.total_tokens).toBe(30);
  });
});

describe('transformSSEChunk', () => {
  it('should transform reasoning in SSE delta', () => {
    const chunk = 'data: {"choices":[{"delta":{"reasoning":"thinking..."}}]}\n\n';
    const transformed = transformSSEChunk(chunk);
    const parsed = JSON.parse(transformed.slice(6)); // Remove "data: "

    expect(parsed.choices[0].delta.reasoning).toBe('thinking...');
    expect(parsed.choices[0].delta.reasoning_content).toBe('thinking...');
  });

  it('should transform reasoning_content in SSE delta', () => {
    const chunk = 'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n';
    const transformed = transformSSEChunk(chunk);
    const parsed = JSON.parse(transformed.slice(6));

    expect(parsed.choices[0].delta.reasoning).toBe('thinking...');
    expect(parsed.choices[0].delta.reasoning_content).toBe('thinking...');
  });

  it('should preserve tool_calls in SSE', () => {
    const chunk = 'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"test"}}]}}]}\n\n';
    const transformed = transformSSEChunk(chunk);
    const parsed = JSON.parse(transformed.slice(6));

    expect(parsed.choices[0].delta.tool_calls).toHaveLength(1);
    expect(parsed.choices[0].delta.tool_calls[0].function.name).toBe('test');
  });

  it('should pass through [DONE] marker', () => {
    const chunk = 'data: [DONE]\n\n';
    const transformed = transformSSEChunk(chunk);
    expect(transformed).toBe('data: [DONE]\n\n');
  });

  it('should handle multiple data lines', () => {
    const chunk = 'data: {"choices":[{"delta":{"content":"Hello"} }]}\n\ndata: {"choices":[{"delta":{"reasoning":"thinking"}}]}\n\n';
    const transformed = transformSSEChunk(chunk);

    // Both should be preserved
    expect(transformed).toContain('"content":"Hello"');
    expect(transformed).toContain('"reasoning":"thinking"');
    expect(transformed).toContain('"reasoning_content":"thinking"');
  });

  it('should handle invalid JSON in data gracefully', () => {
    const chunk = 'data: not valid json\n\n';
    const transformed = transformSSEChunk(chunk);
    expect(transformed).toBe('data: not valid json\n\n');
  });

  it('should preserve non-data lines', () => {
    const chunk = ': comment\ndata: {"choices":[]}\n\n';
    const transformed = transformSSEChunk(chunk);
    expect(transformed).toContain(': comment');
  });
});

describe('isJSONResponse', () => {
  it('should return true for application/json', () => {
    expect(isJSONResponse('application/json')).toBe(true);
  });

  it('should return true for application/json with charset', () => {
    expect(isJSONResponse('application/json; charset=utf-8')).toBe(true);
  });

  it('should return false for other content types', () => {
    expect(isJSONResponse('text/html')).toBe(false);
    expect(isJSONResponse('text/plain')).toBe(false);
    expect(isJSONResponse('application/xml')).toBe(false);
  });

  it('should return false for null', () => {
    expect(isJSONResponse(null)).toBe(false);
  });
});

describe('isSSEStream', () => {
  it('should return true for text/event-stream', () => {
    expect(isSSEStream('text/event-stream')).toBe(true);
  });

  it('should return true for text/event-stream with charset', () => {
    expect(isSSEStream('text/event-stream; charset=utf-8')).toBe(true);
  });

  it('should return true for application/x-ndjson', () => {
    expect(isSSEStream('application/x-ndjson')).toBe(true);
  });

  it('should return false for other content types', () => {
    expect(isSSEStream('application/json')).toBe(false);
    expect(isSSEStream('text/plain')).toBe(false);
  });

  it('should return false for null', () => {
    expect(isSSEStream(null)).toBe(false);
  });
});
