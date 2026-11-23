/** Wilson score interval for k successes in n trials (95% by default): honest for small n, never outside [0, 1]. */
export function wilson(k: number, n: number, z = 1.96): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { low: Math.max(0, mid - half), high: Math.min(1, mid + half) };
}
