import Lozenge from '@atlaskit/lozenge';
import Tooltip from '@atlaskit/tooltip';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { token } from '@atlaskit/tokens';
import type { ReactNode } from 'react';
import type { Status, Verdict } from './api';

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
/** "likely 82–88%": the 95% range, whole percents (finer would claim more than the sample knows) */
export const likely = (r: { low: number; high: number }) => `likely ${Math.floor(r.low * 100)}–${Math.ceil(r.high * 100)}%`;
export const day = (t: number) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const STATUS: Record<Status, { text: string; appearance: 'new' | 'default' | 'inprogress' | 'success' }> = {
  new: { text: 'New', appearance: 'new' },
  proven: { text: 'Validated', appearance: 'success' },
  dismissed: { text: 'Not a chore', appearance: 'default' },
  handed_off: { text: 'Handed off', appearance: 'inprogress' },
  live: { text: 'Live', appearance: 'success' },
};
export const StatusChip = ({ status }: { status: Status }) => <Lozenge appearance={STATUS[status].appearance}>{STATUS[status].text}</Lozenge>;

const VERDICT: Record<Verdict, { text: string; appearance: 'success' | 'moved' | 'default' | 'removed'; hint: string }> = {
  proven: { text: 'Validated', appearance: 'success', hint: 'On the holdout period, even the cautious end of the likely range (95%) reaches the bar for this kind of change, with enough cases and coverage.' },
  weak: { text: 'Not yet', appearance: 'moved', hint: 'On the holdout period the rule agreed with the team less often than the bar for this kind of change (80% for labels/categories, 85% for priority, assignee and status), or too few cases make the likely range dip under it. Look at the exceptions.' },
  'too-few': { text: 'Too few cases', appearance: 'default', hint: 'Fewer than 10 holdout cases where people did this — not enough to prove anything yet.' },
  'needs-judgment': { text: 'Needs judgment', appearance: 'default', hint: 'This action closes or resolves work. Bruno never recommends automating it, however often people do it.' },
  'low-coverage': { text: 'Inconclusive', appearance: 'removed', hint: 'Too many cases could not be modelled (coverage under 80%) — never treated as safe.' },
};
export const VerdictChip = ({ verdict }: { verdict: Verdict }) => (
  <Tooltip content={VERDICT[verdict].hint}>
    <span tabIndex={0}><Lozenge appearance={VERDICT[verdict].appearance}>{VERDICT[verdict].text}</Lozenge></span>
  </Tooltip>
);

/** Plain text button that looks like a link: every number clicks through to the items behind it. */
export function NumberLink({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: token('color.link'), font: 'inherit', fontVariantNumeric: 'tabular-nums', textDecoration: 'underline', textUnderlineOffset: 2 }}
    >
      {children}
    </button>
  );
}

const card = xcss({ borderColor: 'color.border', borderStyle: 'solid', borderWidth: 'border.width', borderRadius: 'radius.medium', padding: 'space.200', backgroundColor: 'elevation.surface.raised' });
export const Card = ({ children }: { children: ReactNode }) => <Box xcss={card}>{children}</Box>;

export interface Segment { key: string; label: string; value: number; color: string; onClick?: () => void }
/** Agreement bar: segments with text labels, never colour alone. */
export function AgreementBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((n, s) => n + s.value, 0) || 1;
  return (
    <Stack space="space.100">
      <div role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')} style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: token('color.background.neutral') }}>
        {segments.filter((s) => s.value > 0).map((s) => <div key={s.key} style={{ width: `${(100 * s.value) / total}%`, background: s.color }} />)}
      </div>
      <Inline space="space.200" shouldWrap>
        {segments.map((s) => (
          <Inline key={s.key} space="space.050" alignBlock="center">
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            <Text size="small">
              {s.label}:{' '}
              {s.onClick ? <NumberLink onClick={s.onClick} label={`Show ${s.label.toLowerCase()} cases`}>{s.value}</NumberLink> : s.value}
            </Text>
          </Inline>
        ))}
      </Inline>
    </Stack>
  );
}

export const Muted = ({ children }: { children: ReactNode }) => <Text color="color.text.subtle">{children}</Text>;

/** Bruno, the mascot: decorative next to his name, so the image itself is hidden from screen readers. */
export const Brand = ({ tagline }: { tagline?: string }) => (
  <Inline space="space.150" alignBlock="center">
    <Stack space="space.0">
      <Text weight="bold" size="large">Bruno</Text>
      {tagline && <Text size="small" color="color.text.subtle">{tagline}</Text>}
    </Stack>
  </Inline>
);

export const num = (n: number) => n.toLocaleString();

/** Bruno talks: mascot + speech bubble. Text only, real numbers only. */
const bubble = xcss({ backgroundColor: 'color.background.accent.yellow.subtlest', borderRadius: 'radius.large', padding: 'space.200', borderColor: 'color.border.accent.yellow', borderStyle: 'solid', borderWidth: 'border.width', flexGrow: 1 });
export const BrunoSays = ({ children }: { children: ReactNode }) => (
  <Inline space="space.150" alignBlock="start">
    <img src="./bruno.png" width={56} height={56} alt="" style={{ display: 'block', flexShrink: 0 }} />
    <Box xcss={bubble}><Stack space="space.050">{children}</Stack></Box>
  </Inline>
);

/** Headline number with what it means underneath. */
const tile = xcss({ borderColor: 'color.border', borderStyle: 'solid', borderWidth: 'border.width', borderRadius: 'radius.large', padding: 'space.200', backgroundColor: 'elevation.surface.raised', minWidth: '0' });
export const StatTile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <Box xcss={tile}>
    <Stack space="space.050">
      <Text size="small" weight="medium" color="color.text.subtle">{label}</Text>
      <span style={{ font: token('font.heading.xlarge'), color: token('color.text'), fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <Text size="small" color="color.text.subtlest">{sub}</Text>}
    </Stack>
  </Box>
);

const grid = (min: number) => xcss({ display: 'grid', gap: 'space.200', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` as never });
export const Grid = ({ min = 220, children }: { min?: number; children: ReactNode }) => <Box xcss={grid(min)}>{children}</Box>;

/** Share of a whole as one bar, with the words beside it (never colour alone). */
export function Meter({ part, whole, label }: { part: number; whole: number; label: string }) {
  const w = whole ? Math.round((100 * part) / whole) : 0;
  return (
    <div role="img" aria-label={label} title={label} style={{ height: 8, borderRadius: 4, background: token('color.background.neutral'), overflow: 'hidden' }}>
      <div style={{ width: `${w}%`, height: '100%', borderRadius: 4, background: token('color.chart.success.bold', token('color.background.success.bold')) }} />
    </div>
  );
}

/** Horizontal bars: one measure across chores, biggest first; each row opens its chore. */
export function BarChart({ rows, onOpen }: { rows: { id: string; label: string; detail?: string; value: number; tag: string; tip: string; display?: string }[]; onOpen: (id: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Stack space="space.100">
      {rows.map((r) => (
        <Tooltip key={r.id} content={r.tip}>
          <button
            type="button"
            onClick={() => onOpen(r.id)}
            aria-label={`${r.label}: ${r.value} times by hand, ${r.tag}. Open proof.`}
            style={{ all: 'unset', cursor: 'pointer', display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr) 132px', alignItems: 'center', gap: 12, padding: '6px 0', width: '100%', borderRadius: 4, boxSizing: 'border-box' }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: token('color.text'), font: token('font.body'), fontWeight: 600 }}>{r.label}</span>
              {r.detail && <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: token('color.text.subtle'), font: token('font.body.small') }}>{r.detail}</span>}
            </span>
            <span style={{ display: 'block', height: 16, background: token('color.background.neutral.subtle') }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.max(2, (100 * r.value) / max)}%`, background: token('color.chart.brand', token('color.background.brand.bold')), borderRadius: '0 4px 4px 0' }} />
            </span>
            <span style={{ whiteSpace: 'nowrap', color: token('color.text.subtle'), font: token('font.body.small'), fontVariantNumeric: 'tabular-nums' }}>{r.display ?? `${num(r.value)} · ${r.tag}`}</span>
          </button>
        </Tooltip>
      ))}
    </Stack>
  );
}

const WEEK = 7 * 86_400_000;
const shortDay = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Weekly columns, one measure. Every column has a tooltip; the y-axis shows its top value only. */
export function WeeklyChart({ start, weeks, unit, height = 140 }: { start: number; weeks: number[]; unit: string; height?: number }) {
  const max = Math.max(1, ...weeks);
  const total = weeks.reduce((a, b) => a + b, 0);
  return (
    <Stack space="space.075">
      <div role="img" aria-label={`${num(total)} ${unit} over ${weeks.length} weeks; busiest week ${num(max)}`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height, font: token('font.body.small'), color: token('color.text.subtlest'), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          <span>{num(max)}</span><span>0</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, borderBottom: `1px solid ${token('color.border')}` }}>
          {weeks.map((v, i) => (
            // a native title, not an ADS Tooltip: its wrapper breaks the flex sizing of thin columns
            <div key={i} tabIndex={0} title={`Week of ${shortDay(start + i * WEEK)}: ${num(v)} ${unit}`} aria-label={`Week of ${shortDay(start + i * WEEK)}: ${num(v)} ${unit}`} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ width: '100%', height: `${(100 * v) / max}%`, minHeight: v ? 2 : 0, background: token('color.chart.brand', token('color.background.brand.bold')), borderRadius: '4px 4px 0 0' }} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 32, font: token('font.body.small'), color: token('color.text.subtlest') }}>
        <span>{shortDay(start)}</span><span>{shortDay(start + (weeks.length - 1) * WEEK)}</span>
      </div>
    </Stack>
  );
}

/** Tiny trend line for a card: shape only, the numbers live in the text beside it. */
export function Sparkline({ weeks, label, width = 96, height = 24 }: { weeks: number[]; label: string; width?: number; height?: number }) {
  if (weeks.length < 2) return null;
  const max = Math.max(1, ...weeks);
  const pts = weeks.map((v, i) => `${((i / (weeks.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} role="img" aria-label={label}>
      <title>{label}</title>
      <polyline points={pts} fill="none" stroke={token('color.chart.brand', token('color.border.brand'))} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** One row per chore: dot = agreement, whisker = likely range (95%), tick = the bar it must clear. Scale 50–100%. */
export function RangeChart({ rows, onOpen }: { rows: { id: string; label: string; point: number; low: number; high: number; bar: number | null; tag: string }[]; onOpen: (id: string) => void }) {
  const x = (v: number) => `${Math.min(100, Math.max(0, ((v - 0.5) / 0.5) * 100))}%`;
  return (
    <Stack space="space.100">
      {rows.map((r) => (
        <Tooltip key={r.id} content={`${r.label}: ${(r.point * 100).toFixed(1)}% agreed, likely ${Math.floor(r.low * 100)}–${Math.ceil(r.high * 100)}%${r.bar ? `; needs ${Math.round(r.bar * 100)}%` : '; needs human judgment'}`}>
          <button type="button" onClick={() => onOpen(r.id)} aria-label={`${r.label}: ${r.tag}. Open proof.`}
            style={{ all: 'unset', cursor: 'pointer', display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr) 88px', alignItems: 'center', gap: 12, padding: '4px 0', width: '100%', boxSizing: 'border-box' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: token('font.body'), color: token('color.text') }}>{r.label}</span>
            <span style={{ position: 'relative', height: 18, display: 'block', background: token('color.background.neutral.subtle'), borderRadius: 4 }}>
              {r.bar && <span style={{ position: 'absolute', left: x(r.bar), top: -2, bottom: -2, width: 2, background: token('color.border.bold') }} />}
              <span style={{ position: 'absolute', left: x(r.low), width: `calc(${x(r.high)} - ${x(r.low)})`, top: 8, height: 2, background: token('color.text.subtle') }} />
              <span style={{ position: 'absolute', left: `calc(${x(r.point)} - 5px)`, top: 4, width: 10, height: 10, borderRadius: 5, background: token('color.chart.brand', token('color.background.brand.bold')), boxShadow: `0 0 0 2px ${token('elevation.surface')}` }} />
            </span>
            <span style={{ font: token('font.body.small'), color: token('color.text.subtle'), whiteSpace: 'nowrap' }}>{r.tag}</span>
          </button>
        </Tooltip>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr) 88px', gap: 12 }}>
        <span />
        <span style={{ display: 'flex', justifyContent: 'space-between', font: token('font.body.small'), color: token('color.text.subtlest') }}><span>50%</span><span>75%</span><span>100%</span></span>
        <span />
      </div>
      <Muted>Dot: how often the rule agreed with your team on tickets it never saw. Line: the likely range. Tick: the bar it has to clear.</Muted>
    </Stack>
  );
}
