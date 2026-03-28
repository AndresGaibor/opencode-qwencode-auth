/**
 * Request Queue with Real Serialization and Sliding Window Rate Limiting
 * 
 * Features:
 * - Promise chaining for true request serialization (no race conditions)
 * - Sliding window rate limiting (60 requests per 60 seconds by default)
 * - Configurable jitter (50-150ms default, reduced from 500-1500ms)
 * - Automatic cleanup of expired timestamps
 * 
 * This implementation ensures concurrent requests are properly serialized
 * and rate-limited, preventing API rate limit violations.
 */

import { createDebugLogger } from '../utils/debug-logger.js';

const debugLogger = createDebugLogger('REQUEST_QUEUE');

export class RequestQueue {
  // Tail promise for serialization - each request chains to this
  private tail: Promise<void> = Promise.resolve();
  
  // Sliding window for rate limiting
  private requestTimestamps: number[] = [];
  
  // Rate limit configuration (Qwen: 60 requests per 60 seconds)
  private readonly MAX_REQUESTS_PER_WINDOW: number;
  private readonly WINDOW_SIZE_MS: number;
  
  // Minimum interval between requests (baseline spacing)
  private readonly MIN_INTERVAL = 1000; // 1 second
  
  // Reduced jitter for better performance while still avoiding thundering herd
  private readonly JITTER_MIN = 50;   // 50ms
  private readonly JITTER_MAX = 150;  // 150ms

  /**
   * Create a new RequestQueue
   * @param maxRequestsPerWindow Maximum requests allowed in the time window (default: 60)
   * @param windowSizeMs Time window in milliseconds (default: 60000 = 60 seconds)
   */
  constructor(maxRequestsPerWindow = 60, windowSizeMs = 60000) {
    this.MAX_REQUESTS_PER_WINDOW = maxRequestsPerWindow;
    this.WINDOW_SIZE_MS = windowSizeMs;
  }

  /**
   * Get random jitter between JITTER_MIN and JITTER_MAX
   */
  private getJitter(): number {
    return Math.random() * (this.JITTER_MAX - this.JITTER_MIN) + this.JITTER_MIN;
  }

  /**
   * Clean up timestamps older than the window
   * This maintains the sliding window
   */
  private cleanupTimestamps(): void {
    const cutoff = Date.now() - this.WINDOW_SIZE_MS;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > cutoff);
  }

  /**
   * Calculate how long to wait before the next request can be made
   * based on the sliding window rate limit
   */
  private getRateLimitWaitTime(): number {
    this.cleanupTimestamps();
    
    if (this.requestTimestamps.length < this.MAX_REQUESTS_PER_WINDOW) {
      return 0;
    }
    
    // We're at the limit - need to wait until the oldest request expires
    const oldestTimestamp = this.requestTimestamps[0];
    const waitUntil = oldestTimestamp + this.WINDOW_SIZE_MS;
    const waitTime = Math.max(0, waitUntil - Date.now());
    
    return waitTime;
  }

  /**
   * Get current queue state for debugging
   */
  getState(): {
    pendingRequests: number;
    requestsInWindow: number;
    maxRequestsPerWindow: number;
    windowSizeMs: number;
  } {
    this.cleanupTimestamps();
    return {
      pendingRequests: this.requestTimestamps.length,
      requestsInWindow: this.requestTimestamps.length,
      maxRequestsPerWindow: this.MAX_REQUESTS_PER_WINDOW,
      windowSizeMs: this.WINDOW_SIZE_MS,
    };
  }

  /**
   * Execute a function with proper serialization and rate limiting
   * 
   * This method:
   * 1. Chains the request to the end of the current tail promise (serialization)
   * 2. Applies sliding window rate limiting before execution
   * 3. Adds minimum interval spacing and jitter
   * 4. Records the timestamp for rate limit tracking
   * 
   * @param fn The async function to execute
   * @returns The result of the function
   */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    // Chain this request to the tail promise for serialization
    // Store the new tail promise so the next request chains to this one
    const currentTail = this.tail;
    
    let resolveTail: () => void;
    this.tail = new Promise<void>(resolve => {
      resolveTail = resolve;
    });

    // Wait for all previous requests to complete
    await currentTail;

    try {
      // Calculate wait time based on rate limit
      const rateLimitWait = this.getRateLimitWaitTime();
      
      // Calculate minimum interval wait
      const lastRequestTime = this.requestTimestamps.length > 0 
        ? this.requestTimestamps[this.requestTimestamps.length - 1] 
        : 0;
      const elapsed = Date.now() - lastRequestTime;
      const minIntervalWait = Math.max(0, this.MIN_INTERVAL - elapsed);
      
      // Take the maximum of both wait times
      const baseWait = Math.max(rateLimitWait, minIntervalWait);
      
      // Add jitter to avoid thundering herd
      const jitter = baseWait > 0 ? this.getJitter() : 0;
      const totalWait = baseWait + jitter;
      
      if (totalWait > 0) {
        debugLogger.info(
          `Throttling: waiting ${totalWait.toFixed(0)}ms (rateLimit: ${rateLimitWait.toFixed(0)}ms, minInterval: ${minIntervalWait.toFixed(0)}ms, jitter: ${jitter.toFixed(0)}ms)`
        );
        
        await new Promise(resolve => setTimeout(resolve, totalWait));
      }
      
      // Record this request timestamp for rate limiting
      const executionTime = Date.now();
      this.requestTimestamps.push(executionTime);
      
      debugLogger.debug('Executing request', {
        requestsInWindow: this.requestTimestamps.length,
        maxRequests: this.MAX_REQUESTS_PER_WINDOW,
        timestamp: new Date(executionTime).toISOString()
      });
      
      // Execute the actual request
      return await fn();
    } finally {
      // Always resolve the tail promise so the next request can proceed
      resolveTail!();
    }
  }

  /**
   * Clear all recorded timestamps
   * Useful for testing or resetting rate limit state
   */
  reset(): void {
    this.requestTimestamps = [];
    this.tail = Promise.resolve();
    debugLogger.info('Request queue reset');
  }
}