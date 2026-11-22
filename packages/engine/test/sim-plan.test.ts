import { describe, expect, test } from 'vitest';
import { BOT_CONFIG, planDay } from '../src/sim';

const HOUR = 3_600_000;
const days = (n: number) => Array.from({ length: n }, (_, d) => planDay(BOT_CONFIG, d, 42)).flat();

describe('planDay', () => {
  test('same seed and day give the same plan', () => {
    expect(planDay(BOT_CONFIG, 3, 42)).toEqual(planDay(BOT_CONFIG, 3, 42));
    expect(planDay(BOT_CONFIG, 3, 42)).not.toEqual(planDay(BOT_CONFIG, 4, 42));
  });

  test('volume is close to requestsPerDay', () => {
    const avg = days(20).length / 20;
    expect(avg).toBeGreaterThan(BOT_CONFIG.requestsPerDay * 0.8);
    expect(avg).toBeLessThan(BOT_CONFIG.requestsPerDay * 1.2);
  });

  test('non-VIP invoice requests mostly get Billing within 2 h', () => {
    const inv = days(20).filter((r) => /invoice/i.test(r.summary + ' ' + r.description) && r.org !== BOT_CONFIG.vipOrg);
    const billed = inv.filter((r) =>
      r.actions.some((a) => a.planted === 'billing' && a.kind === 'setRequestType' && a.value === 'Billing' && a.afterMs <= 2 * HOUR),
    );
    expect(inv.length).toBeGreaterThan(50);
    expect(billed.length / inv.length).toBeGreaterThan(0.75);
    expect(billed.length / inv.length).toBeLessThan(0.95);
  });

  test('VIP requests never carry a planted action', () => {
    const vip = days(20).filter((r) => r.org === BOT_CONFIG.vipOrg);
    expect(vip.length).toBeGreaterThan(10);
    expect(vip.flatMap((r) => r.actions).every((a) => a.planted === null)).toBe(true);
  });

  test('VPN requests get the Network component', () => {
    const vpn = days(20).filter((r) => /vpn/i.test(r.summary) && r.org !== BOT_CONFIG.vipOrg);
    const hit = vpn.filter((r) => r.actions.some((a) => a.planted === 'vpn-network' && a.kind === 'setComponent' && a.value === 'Network'));
    expect(hit.length / vpn.length).toBeGreaterThan(0.75);
  });

  test('customer replies are planned and followed by In progress (synthetic chore)', () => {
    const replies = days(20).flatMap((r) => r.actions).filter((a) => a.kind === 'customerComment');
    expect(replies.length).toBeGreaterThan(20);
    expect(days(20).flatMap((r) => r.actions).some((a) => a.planted === 'customer-reply' && a.kind === 'transition')).toBe(true);
  });

  test('actions within a request are ordered and within the day plus 2 days', () => {
    for (const r of days(5)) {
      const t = r.actions.map((a) => a.afterMs);
      expect([...t].sort((a, b) => a - b)).toEqual(t);
      expect(Math.max(0, ...t)).toBeLessThan(48 * HOUR);
    }
  });
});
