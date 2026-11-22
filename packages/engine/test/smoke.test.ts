import { expect, test } from 'vitest';
import { VERSION } from '../src/index';

test('engine exports its version', () => {
  expect(VERSION).toBe('0.1.0');
});
