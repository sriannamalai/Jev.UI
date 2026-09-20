import { describe, expect, it } from 'vitest';

describe('tooling', () => {
  // guards against duplicate vitest/chai instances in the workspace
  it('supports the string form of rejects.toThrow', async () => {
    await expect(Promise.reject(new Error('disk full'))).rejects.toThrow('disk full');
  });
});
