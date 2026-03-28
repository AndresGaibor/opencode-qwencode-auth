/**
 * Response Transformation for Qwen API
 *
 * Handles transformation of responses to ensure compatibility with OpenCode:
 * - Preserves reasoning_content and reasoning fields
 * - Preserves tool_calls
 * - Works with both JSON responses and SSE streaming
 */

import { createDebugLogger } from '../utils/debug-logger.js';

const debugLogger = createDebugLogger('RESPONSE_TRANSFORM');

/**
 * Message delta in SSE stream
 */
interface StreamDelta {
  role?: string;
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

/**
 * Stream choice in SSE
 */
interface StreamChoice {
  index?: number;
  delta?: StreamDelta;
  finish_reason?: string;
}

/**
 * SSE chunk structure
 */
interface SSEChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: StreamChoice[];
}

/**
 * Message in JSON response
 */
interface ResponseMessage {
  role?: string;
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

/**
 * Choice in JSON response
 */
interface ResponseChoice {
  index?: number;
  message?: ResponseMessage;
  finish_reason?: string;
}

/**
 * JSON response structure
 */
interface JSONResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: ResponseChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Transform a message to ensure reasoning fields are present
 * Qwen may return reasoning in either reasoning or reasoning_content
 */
function transformMessage(message: ResponseMessage | undefined): void {
  if (!message) return;
  
  // If reasoning exists but reasoning_content doesn't, copy it
  if (message.reasoning && !message.reasoning_content) {
    message.reasoning_content = message.reasoning;
    debugLogger.debug('Copied reasoning to reasoning_content');
  }
  // If reasoning_content exists but reasoning doesn't, copy it
  else if (message.reasoning_content && !message.reasoning) {
    message.reasoning = message.reasoning_content;
    debugLogger.debug('Copied reasoning_content to reasoning');
  }
  
  // tool_calls are preserved as-is
  if (message.tool_calls) {
    debugLogger.debug('Preserving tool_calls', {
      count: message.tool_calls.length,
      ids: message.tool_calls.map(t => t.id).filter(Boolean),
    });
  }
}

/**
 * Transform a delta in SSE stream
 */
function transformDelta(delta: StreamDelta | undefined): void {
  if (!delta) return;
  
  // If reasoning exists but reasoning_content doesn't, copy it
  if (delta.reasoning && !delta.reasoning_content) {
    delta.reasoning_content = delta.reasoning;
  }
  // If reasoning_content exists but reasoning doesn't, copy it
  else if (delta.reasoning_content && !delta.reasoning) {
    delta.reasoning = delta.reasoning_content;
  }
  
  // tool_calls are preserved as-is
}

/**
 * Transform a JSON response from Qwen API
 */
export function transformJSONResponse(responseText: string): string {
  try {
    const response: JSONResponse = JSON.parse(responseText);
    
    if (response.choices) {
      for (const choice of response.choices) {
        transformMessage(choice.message);
      }
    }
    
    return JSON.stringify(response);
  } catch (error) {
    // If parsing fails, return original
    debugLogger.warn('Failed to parse JSON response, returning as-is');
    return responseText;
  }
}

/**
 * Transform an SSE chunk from Qwen API
 */
export function transformSSEChunk(chunkText: string): string {
  // SSE format: "data: {...}\n\n" or "data: [DONE]\n\n"
  const lines = chunkText.split('\n');
  const transformedLines: string[] = [];
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      
      // Handle [DONE] marker
      if (data === '[DONE]') {
        transformedLines.push(line);
        continue;
      }
      
      try {
        const chunk: SSEChunk = JSON.parse(data);
        
        if (chunk.choices) {
          for (const choice of chunk.choices) {
            transformDelta(choice.delta);
          }
        }
        
        transformedLines.push(`data: ${JSON.stringify(chunk)}`);
      } catch (error) {
        // If parsing fails, keep original
        transformedLines.push(line);
      }
    } else {
      transformedLines.push(line);
    }
  }
  
  return transformedLines.join('\n');
}

/**
 * Check if content type indicates JSON response
 */
export function isJSONResponse(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.includes('application/json');
}

/**
 * Check if content type indicates SSE stream
 */
export function isSSEStream(contentType: string | null): boolean {
  if (!contentType) return false;
  return (
    contentType.includes('text/event-stream') ||
    contentType.includes('application/x-ndjson')
  );
}

/**
 * Create a transformed response wrapper
 */
export function createTransformedResponse(
  originalResponse: Response,
  transformedBody: string
): Response {
  return new Response(transformedBody, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: originalResponse.headers,
  });
}

/**
 * Transform response body based on content type
 * Returns the original response if no transformation needed
 */
export async function transformResponse(response: Response): Promise<Response> {
  const contentType = response.headers.get('content-type');
  
  // Only transform successful responses
  if (!response.ok) {
    return response;
  }
  
  // Handle SSE streams differently - they need streaming transformation
  if (isSSEStream(contentType)) {
    // For SSE, we return a transformed stream
    return createTransformedStreamResponse(response);
  }
  
  // Handle JSON responses
  if (isJSONResponse(contentType)) {
    const originalText = await response.text();
    const transformedText = transformJSONResponse(originalText);
    
    // Return new response with transformed body
    return createTransformedResponse(response, transformedText);
  }
  
  // No transformation needed
  return response;
}

/**
 * Create a streaming response that transforms SSE chunks
 */
function createTransformedStreamResponse(originalResponse: Response): Response {
  const reader = originalResponse.body?.getReader();
  
  if (!reader) {
    return originalResponse;
  }
  
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  
  let buffer = '';
  
  const transformStream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      
      if (done) {
        // Process any remaining buffer
        if (buffer.trim()) {
          const transformed = transformSSEChunk(buffer);
          controller.enqueue(encoder.encode(transformed));
        }
        controller.close();
        return;
      }
      
      // Decode chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });
      
      // Process complete SSE events (separated by double newline)
      const events = buffer.split('\n\n');
      
      // Keep the last incomplete event in buffer
      buffer = events.pop() || '';
      
      // Transform and emit complete events
      for (const event of events) {
        if (event.trim()) {
          const transformed = transformSSEChunk(event + '\n\n');
          controller.enqueue(encoder.encode(transformed));
        }
      }
    },
    
    cancel() {
      reader.cancel();
    },
  });
  
  return new Response(transformStream, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: originalResponse.headers,
  });
}
