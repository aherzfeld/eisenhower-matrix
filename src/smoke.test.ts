import { describe, it, expect } from 'vitest';

describe('environment', () => {
  it('runs under jsdom', () => {
    expect(typeof document).toBe('object');
  });
});
