import Lozenge from '@atlaskit/lozenge';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { token } from '@atlaskit/tokens';
import type { ReactNode } from 'react';
import type { Status, Verdict } from './api';

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const day = (t: number) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const STATUS: Record<Status, { text: string; appearance: 'new' | 'default' | 'inprogress' | 'success' }> = {
  new: { text: 'New', appearance: 'new' },
  proven: { text: 'Proven', appearance: 'success' },
  dismissed: { text: 'Not a chore', appearance: 'default' },
  handed_off: { text: 'Handed off', appearance: 'inprogress' },
  live: { text: 'Live', appearance: 'success' },
};
export const StatusChip = ({ status }: { status: Status }) => <Lozenge appearance={STATUS[status].appearance}>{STATUS[status].text}</Lozenge>;

const VERDICT: Record<Verdict, { text: string; appearance: 'success' | 'moved' | 'default' | 'removed'; hint: string }> = {
  proven: { text: 'Proven', appearance: 'success', hint: 'Matched the team on the holdout period with enough cases and coverage.' },
  weak: { text: 'Not yet', appearance: 'moved', hint: 'On the holdout period the rule agreed with the team less often than the bar for this kind of change (80% for labels/categories, 85% for priority, assignee and status). Look at the exceptions.' },
  'too-few': { text: 'Too few cases', appearance: 'default', hint: 'Fewer than 10 holdout cases where people did this — not enough to prove anything yet.' },
  'needs-judgment': { text: 'Needs judgment', appearance: 'default', hint: 'This action closes or resolves work. Wind Tunnel never recommends automating it, however often people do it.' },
  'low-coverage': { text: 'Inconclusive', appearance: 'removed', hint: 'Too many cases could not be modelled (coverage under 80%) — never treated as safe.' },
};
export const VerdictChip = ({ verdict }: { verdict: Verdict }) => (
  <span title={VERDICT[verdict].hint}><Lozenge appearance={VERDICT[verdict].appearance}>{VERDICT[verdict].text}</Lozenge></span>
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
