import { expect, test } from 'vitest';
import { wilson } from '../src/stats';

test('wilson 95% interval: large n is tight, small n is wide, n = 0 says nothing', () => {
  const big = wilson(557, 653);
  expect(big.low).toBeCloseTo(0.824, 3);
  expect(big.high).toBeCloseTo(0.878, 3);
  expect(wilson(17, 20).low).toBeCloseTo(0.640, 3);
  expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  expect(wilson(10, 10).high).toBeCloseTo(1, 9);
});
