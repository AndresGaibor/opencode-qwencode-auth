/**
 * Tests for Reasoning Configuration
 * 
 * Verifies:
 * - reasoning: true by default for coder-model
 * - Environment variable override (OPENCODE_QWEN_REASONING=on|off|auto)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resolveReasoningDefault, QWEN_MODELS } from '../../src/constants.js';

describe('Reasoning Configuration', () => {
  const originalEnv = process.env.OPENCODE_QWEN_REASONING;

  beforeEach(() => {
    // Clear env before each test
    delete process.env.OPENCODE_QWEN_REASONING;
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.OPENCODE_QWEN_REASONING = originalEnv;
    } else {
      delete process.env.OPENCODE_QWEN_REASONING;
    }
  });

  describe('resolveReasoningDefault', () => {
    it('should return true by default (no env set)', () => {
      const result = resolveReasoningDefault('coder-model');
      expect(result).toBe(true);
    });

    it('should return true when env is "on"', () => {
      process.env.OPENCODE_QWEN_REASONING = 'on';
      const result = resolveReasoningDefault('coder-model');
      expect(result).toBe(true);
    });

    it('should return true when env is "true"', () => {
      process.env.OPENCODE_QWEN_REASONING = 'true';
      const result = resolveReasoningDefault('coder-model');
      expect(result).toBe(true);
    });

    it('should return false when env is "off"', () => {
      process.env.OPENCODE_QWEN_REASONING = 'off';
      const result = resolveReasoningDefault('coder-model');
      expect(result).toBe(false);
    });

    it('should return false when env is "false"', () => {
      process.env.OPENCODE_QWEN_REASONING = 'false';
      const result = resolveReasoningDefault('coder-model');
      expect(result).toBe(false);
    });

    it('should return true for coder-model when env is "auto"', () => {
      process.env.OPENCODE_QWEN_REASONING = 'auto';
      const result = resolveReasoningDefault('coder-model');
      expect(result).toBe(true);
    });

    it('should return false for unknown models when env is "auto"', () => {
      process.env.OPENCODE_QWEN_REASONING = 'auto';
      const result = resolveReasoningDefault('unknown-model');
      expect(result).toBe(false);
    });

    it('should be case-insensitive for env values', () => {
      process.env.OPENCODE_QWEN_REASONING = 'OFF';
      const result = resolveReasoningDefault('coder-model');
      expect(result).toBe(false);
    });

    it('should return true for any other env value (default to on)', () => {
      process.env.OPENCODE_QWEN_REASONING = 'random-value';
      const result = resolveReasoningDefault('coder-model');
      expect(result).toBe(true);
    });
  });

  describe('QWEN_MODELS.coder-model', () => {
    it('should have reasoning: true by default', () => {
      expect(QWEN_MODELS['coder-model'].reasoning).toBe(true);
    });

    it('should have correct model id', () => {
      expect(QWEN_MODELS['coder-model'].id).toBe('coder-model');
    });

    it('should have vision capability', () => {
      expect(QWEN_MODELS['coder-model'].capabilities?.vision).toBe(true);
    });

    it('should have correct context window', () => {
      expect(QWEN_MODELS['coder-model'].contextWindow).toBe(1048576);
    });

    it('should have correct max output', () => {
      expect(QWEN_MODELS['coder-model'].maxOutput).toBe(65536);
    });
  });
});
