import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// jsdom implements `Range` but not the layout-measurement methods on it.
// CodeMirror 6 (the JSON pane, Task 12b-1) calls these while measuring
// cursor/selection position on every document change; without a stub they
// throw inside CodeMirror's internal measure pass. The exact geometry
// doesn't matter in tests — an empty/zero rect is enough to let the
// measure pass complete.
if (typeof Range !== 'undefined') {
  const zeroRect: DOMRect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON() {
      return this;
    },
  };

  Range.prototype.getBoundingClientRect = () => zeroRect;
  Range.prototype.getClientRects = () =>
    ({
      item: () => null,
      length: 0,
      [Symbol.iterator]: function* () {
        // No rects to yield in jsdom.
      },
    }) as unknown as DOMRectList;
}
