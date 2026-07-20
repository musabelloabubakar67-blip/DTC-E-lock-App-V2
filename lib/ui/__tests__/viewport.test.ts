import { describe, expect, it } from 'vitest';
import { classifyAppViewport } from '../viewport';

describe('classifyAppViewport', () => {
  it('keeps narrow tablet split-screen layouts in phone mode', () => {
    expect(classifyAppViewport(390, 800)).toBe('phone');
  });

  it('uses the tablet rail at normal tablet widths', () => {
    expect(classifyAppViewport(600, 800)).toBe('tablet-portrait');
    expect(classifyAppViewport(800, 800)).toBe('tablet-portrait');
    expect(classifyAppViewport(1024, 800)).toBe('tablet-landscape');
  });

  it('uses desktop mode for wide screens', () => {
    expect(classifyAppViewport(1280, 800)).toBe('desktop');
  });
});
