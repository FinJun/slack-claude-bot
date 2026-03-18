import { describe, it, expect } from 'vitest';
import { splitMessage } from '../../src/utils/message-splitter.js';

describe('splitMessage', () => {
  it('returns single chunk for short messages', () => {
    const result = splitMessage('Hello, world!');
    expect(result).toEqual(['Hello, world!']);
  });

  it('returns single chunk when message is exactly maxSize', () => {
    const text = 'a'.repeat(3900);
    const result = splitMessage(text);
    expect(result).toEqual([text]);
  });

  it('splits long plain text into chunks not exceeding maxSize', () => {
    const text = 'a'.repeat(8000);
    const result = splitMessage(text);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(3900);
    }
    expect(result.join('')).toBe(text);
  });

  it('prefers splitting at newline boundaries', () => {
    // Build a text with newlines where the first newline falls before 3900
    const line = 'x'.repeat(100) + '\n';
    const text = line.repeat(50); // 5050 chars total
    const result = splitMessage(text);
    expect(result.length).toBeGreaterThan(1);
    // Each chunk should end with a newline (split at newline boundary)
    for (const chunk of result.slice(0, -1)) {
      expect(chunk.endsWith('\n')).toBe(true);
    }
    expect(result.join('')).toBe(text);
  });

  it('does not split inside a code block when it fits before maxSize', () => {
    const before = 'Some text\n' + 'b'.repeat(3800) + '\n';
    const codeBlock = '```\nconst x = 1;\n```\n';
    const after = 'After code';
    const text = before + codeBlock + after;

    const result = splitMessage(text);
    // Verify the code block is not split across chunks
    const hasOpenWithoutClose = result.some((chunk) => {
      const opens = (chunk.match(/```/g) || []).length;
      return opens % 2 !== 0;
    });
    expect(hasOpenWithoutClose).toBe(false);
    expect(result.join('')).toBe(text);
  });

  it('handles message with only a code block larger than maxSize', () => {
    const largeCode = '```\n' + 'x'.repeat(8000) + '\n```';
    const result = splitMessage(largeCode);
    // All chunks must be non-empty and together reconstruct the original
    expect(result.join('')).toBe(largeCode);
    for (const chunk of result) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it('respects custom maxSize option', () => {
    const text = 'hello world this is a test message for splitting';
    const result = splitMessage(text, { maxSize: 10 });
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
    expect(result.join('')).toBe(text);
  });

  it('handles empty string', () => {
    const result = splitMessage('');
    expect(result).toEqual(['']);
  });

  it('handles multiple code blocks without splitting them', () => {
    const block1 = '```js\nconst a = 1;\n```\n';
    const block2 = '```py\nprint("hello")\n```\n';
    const filler = 'f'.repeat(3000);
    const text = block1 + filler + block2;

    const result = splitMessage(text);
    expect(result.join('')).toBe(text);
    for (const chunk of result) {
      const count = (chunk.match(/```/g) || []).length;
      expect(count % 2).toBe(0);
    }
  });
});
