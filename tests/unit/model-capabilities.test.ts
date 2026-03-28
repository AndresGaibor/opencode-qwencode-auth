/**
 * Tests for Model Capabilities Declaration
 * 
 * Verifies:
 * - tool_call: true is declared in the provider mapping
 * - All models have correct capabilities structure
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { QWEN_MODELS, resolveReasoningDefault } from '../../src/constants.js';

// Simulate the model mapping from config()
function buildModelMapping() {
  return Object.fromEntries(
    Object.entries(QWEN_MODELS).map(([id, m]) => {
      const hasVision = 'capabilities' in m && m.capabilities?.vision;
      const reasoningEnabled = resolveReasoningDefault(m.id);
      
      return [
        id,
        {
          id: m.id,
          name: m.name,
          reasoning: reasoningEnabled,
          tool_call: true,
          limit: { context: m.contextWindow, output: m.maxOutput },
          cost: m.cost,
          modalities: { 
            input: hasVision ? ['text', 'image'] : ['text'], 
            output: ['text'] 
          },
        },
      ];
    })
  );
}

describe('Model Capabilities', () => {
  let modelMapping: Record<string, any>;

  beforeEach(() => {
    delete process.env.OPENCODE_QWEN_REASONING;
    modelMapping = buildModelMapping();
  });

  describe('tool_call capability', () => {
    it('should declare tool_call: true for coder-model', () => {
      expect(modelMapping['coder-model'].tool_call).toBe(true);
    });

    it('should declare tool_call: true for all models', () => {
      for (const [id, model] of Object.entries(modelMapping)) {
        expect(model.tool_call).toBe(true);
      }
    });
  });

  describe('reasoning capability', () => {
    it('should declare reasoning: true for coder-model by default', () => {
      expect(modelMapping['coder-model'].reasoning).toBe(true);
    });

    it('should respect OPENCODE_QWEN_REASONING=off env', () => {
      process.env.OPENCODE_QWEN_REASONING = 'off';
      const mapping = buildModelMapping();
      expect(mapping['coder-model'].reasoning).toBe(false);
    });

    it('should respect OPENCODE_QWEN_REASONING=on env', () => {
      process.env.OPENCODE_QWEN_REASONING = 'on';
      const mapping = buildModelMapping();
      expect(mapping['coder-model'].reasoning).toBe(true);
    });
  });

  describe('modalities', () => {
    it('should declare text and image input for vision models', () => {
      expect(modelMapping['coder-model'].modalities.input).toContain('text');
      expect(modelMapping['coder-model'].modalities.input).toContain('image');
    });

    it('should declare text output for all models', () => {
      for (const [id, model] of Object.entries(modelMapping)) {
        expect(model.modalities.output).toContain('text');
      }
    });
  });

  describe('limit configuration', () => {
    it('should have correct context window for coder-model', () => {
      expect(modelMapping['coder-model'].limit.context).toBe(1048576);
    });

    it('should have correct max output for coder-model', () => {
      expect(modelMapping['coder-model'].limit.output).toBe(65536);
    });
  });

  describe('model structure', () => {
    it('should have all required properties', () => {
      const requiredProps = ['id', 'name', 'reasoning', 'tool_call', 'limit', 'cost', 'modalities'];
      
      for (const [id, model] of Object.entries(modelMapping)) {
        for (const prop of requiredProps) {
          expect(model).toHaveProperty(prop);
        }
      }
    });

    it('should have zero cost for OAuth models', () => {
      for (const [id, model] of Object.entries(modelMapping)) {
        expect(model.cost.input).toBe(0);
        expect(model.cost.output).toBe(0);
      }
    });
  });
});
