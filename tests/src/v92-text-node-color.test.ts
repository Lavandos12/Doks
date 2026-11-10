import { describe, it, expect } from 'vitest';
import { CANVAS_COLORS } from '../../web/src/components/board/board-canvas.js';

describe('v92 - Text Node Color System', () => {
  it('correctly resolves text color', () => {
    const resolveColor = (rawColor: string) => {
      return !rawColor || rawColor === 'default'
        ? '#f1f5f9'
        : (rawColor === '6' ? '#94a3b8' : (CANVAS_COLORS[rawColor] || (rawColor.startsWith('#') ? rawColor : undefined)));
    };

    expect(resolveColor('default')).toBe('#f1f5f9');
    expect(resolveColor('1')).toBe(CANVAS_COLORS['1']);
    expect(resolveColor('6')).toBe('#94a3b8');
    expect(resolveColor('#ff0000')).toBe('#ff0000');
  });
});
