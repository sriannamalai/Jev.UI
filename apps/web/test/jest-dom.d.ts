// @testing-library/jest-dom@6.10.0's own `vitest.d.ts` augments `Assertion<T = any>`
// (a single type parameter), but the installed vitest@5.0.1 declares
// `Assertion<R, T>` (two required type parameters, no default). Because pnpm
// gives jest-dom its own isolated `vitest` resolution, that augmentation
// merges onto a *different* physical module instance than the one this
// package's test files import, so its matchers never become visible here.
// Re-declare the augmentation from within this package so it merges onto the
// same `vitest` instance our tests actually use.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- interface merging is the mechanism here, not an accidental empty type.
  interface Assertion<R, T> extends TestingLibraryMatchers<T, R> {}
}
