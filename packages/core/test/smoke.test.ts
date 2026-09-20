import { expect, test } from 'vitest';
import { CORE_VERSION } from '../src/index.js';

test('core exports a version', () => expect(CORE_VERSION).toBe('0.1.0'));
