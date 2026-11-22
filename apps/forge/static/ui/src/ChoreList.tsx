import Button from '@atlaskit/button/new';
import DynamicTable from '@atlaskit/dynamic-table';
import Heading from '@atlaskit/heading';
import { Inline, Stack, Text } from '@atlaskit/primitives';
import { ProgressTracker } from '@atlaskit/progress-tracker';
import SectionMessage from '@atlaskit/section-message';
import Spinner from '@atlaskit/spinner';
import { useCallback, useEffect, useState } from 'react';
import { call, type Overview, type Progress, type Status } from './api';
import { Card, day, Muted, NumberLink, pct, StatusChip, VerdictChip } from './ui';

const PHASES: { id: Progress['phase']; label: string }[] = [
  { id: 'listing', label: 'Listing items' },
  { id: 'fetching', label: 'Fetching history' },
  { id: 'mining', label: 'Finding chores' },
  { id: 'proving', label: 'Proving on holdout' },
];
const running = (p?: Progress) => !!p && ['listing', 'fetching', 'mining', 'proving'].includes(p.phase);

interface Weekly { live: { ref: string; sentence: string; runs: number; reversed: number }[]; newChores: { ref: string; sentence: string }[]; from: number; to: number }

export function ChoreList({ onOpen }: { onOpen: (choreId: string, tab?: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | Status>('active');

  const load = useCallback(async () => {
    try {
      const o = await call<Overview>('overview');
      setData(o);
      setError(null);
      if (o.chores.length) setWeekly(await call<Weekly>('weekly'));
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // poll while the background analysis runs
  useEffect(() => {
    if (!running(data?.progress)) return;
    const t = setInterval(async () => {
      const p = await call<Progress>('progress').catch(() => null);
      if (!p) return;
      if (running(p)) setData((d) => (d ? { ...d, progress: p } : d));
      else void load();
    }, 3000);
    return () => clearInterval(t);
  }, [data?.progress, load]);

  const start = async () => {
    const p = await call<Progress>('start');
    setData((d) => (d ? { ...d, progress: p } : d));
  };

  if (error) return <SectionMessage appearance="error" title="Wind Tunnel couldn’t load">{error}</SectionMessage>;
  if (!data) return <Spinner label="Loading chores" />;

  const { progress, meta, settings } = data;
  const phaseIndex = PHASES.findIndex((p) => p.id === progress.phase);
  const shown = data.chores.filter((c) => (filter === 'active' ? c.status !== 'dismissed' : c.status === filter));

  return (
    <Stack space="space.300">
      <Inline spread="space-between" alignBlock="center" shouldWrap>
        <Muted>Chores your team does by hand, and rules proven against what the team actually did.</Muted>
        <Button appearance="primary" onClick={start} isDisabled={running(progress)}>
          {meta ? 'Re-analyse history' : `Analyse the last ${settings.windowDays} days`}
        </Button>
      </Inline>

      {running(progress) && (
        <Card>
          <Stack space="space.150">
            <ProgressTracker
              label="Analysis progress"
              items={PHASES.map((p, i) => ({ id: p.id, label: p.label, percentageComplete: i < phaseIndex ? 100 : i === phaseIndex ? 50 : 0, status: i < phaseIndex ? 'visited' : i === phaseIndex ? 'current' : 'unvisited' }))}
            />
            <Muted>{progress.phase === 'fetching' ? `${progress.done} items fetched so far…` : 'This runs in the background — you can leave this page.'}</Muted>
          </Stack>
        </Card>
      )}
      {progress.phase === 'error' && <SectionMessage appearance="error" title="The last analysis failed">{progress.error}</SectionMessage>}

      {meta && (
        <Muted>
          Learned on {day(meta.window.start)} – {day(meta.window.cut)} · proved on {day(meta.window.cut)} – {day(meta.window.end)} (not used for learning) · {meta.issues} items · last run {day(meta.runAt)}
          {settings.minPeople < 2 ? ` · counting chores done by ${settings.minPeople} person or more (setting)` : ''}
        </Muted>
      )}

      {!meta && !running(progress) && (
        <Card>
          <Stack space="space.100">
            <Heading size="small">Nothing analysed yet</Heading>
            <Text>Wind Tunnel reads this project’s history, finds actions people repeat by hand, and proves a rule for each one on a later period it didn’t learn from.</Text>
            <Muted>A chore needs at least {settings.minCount} repeated actions on {settings.minCount} items by {settings.minPeople} or more people. Nothing in Jira changes until someone sends a rule to an admin.</Muted>
          </Stack>
        </Card>
      )}

      {meta && !data.chores.length && !running(progress) && (
        <Card>
          <Stack space="space.100">
            <Heading size="small">No chores found yet</Heading>
            <Text>A chore needs at least {settings.minCount} repeated actions on {settings.minCount} items by {settings.minPeople} or more people, with a clear trigger before it.</Text>
            {meta.unexplained.length > 0 && <Muted>Repeated but not automatable yet: {meta.unexplained.slice(0, 5).map((u) => `${u.id} (${u.count}×, ${u.reason === 'no-trigger' ? 'no trigger' : 'no pattern'})`).join(', ')}.</Muted>}
          </Stack>
        </Card>
      )}

      {data.chores.length > 0 && (
        <Stack space="space.100">
          <Inline space="space.100" shouldWrap>
            {(['active', 'new', 'handed_off', 'live', 'dismissed'] as const).map((f) => (
              <Button key={f} appearance={filter === f ? 'primary' : 'subtle'} spacing="compact" onClick={() => setFilter(f)} aria-pressed={filter === f}>
                {{ active: 'All', new: 'New', handed_off: 'Handed off', live: 'Live', dismissed: 'Not a chore' }[f as string]}
              </Button>
            ))}
          </Inline>
          <div>
            <div style={{ overflowX: 'auto' }}>
              <DynamicTable
                caption="Chores"
                head={{
                  cells: [
                    { key: 'sentence', content: 'Chore' },
                    { key: 'count', content: <span title="Times done by hand in the whole window (bulk edits excluded)">Times by hand</span>, isSortable: true },
                    { key: 'people', content: 'People', isSortable: true },
                    { key: 'matches', content: <span title="On the holdout period: times the rule would act that matched what people did">Matches</span> },
                    { key: 'verdict', content: 'Proof' },
                    { key: 'status', content: 'Status' },
                  ],
                }}
                rows={shown.map((c) => ({
                  key: c.id,
                  cells: [
                    { key: 'sentence', content: <NumberLink onClick={() => onOpen(c.id)} label={`Open proof: ${c.sentence}`}><span style={{ textDecoration: 'none' }}>{c.sentence}</span></NumberLink> },
                    { key: 'count', content: c.count },
                    { key: 'people', content: c.people },
                    { key: 'matches', content: <NumberLink onClick={() => onOpen(c.id, 'TP')} label={`Show the ${c.matches} matching cases`}>{c.matches} of {c.fires}</NumberLink> },
                    { key: 'verdict', content: <span title={`Precision ${pct(c.precision)} · recall ${pct(c.recall)} · coverage ${pct(c.coverage)}`}><VerdictChip verdict={c.verdict} /></span> },
                    { key: 'status', content: <StatusChip status={c.status} /> },
                  ],
                }))}
                emptyView={<Muted>No chores with this status.</Muted>}
              />
            </div>
          </div>
        </Stack>
      )}

      {weekly && (weekly.live.length > 0 || weekly.newChores.length > 0) && (
        <Card>
          <Stack space="space.100">
            <Heading size="small">This week ({day(weekly.from)} – {day(weekly.to)})</Heading>
            {weekly.live.map((l) => (
              <Text key={l.ref}>
                {l.sentence}: ran {l.runs} time{l.runs === 1 ? '' : 's'}
                {l.reversed ? `, reversed by a person within 24 h ${l.reversed} time${l.reversed === 1 ? '' : 's'} (handed back as exceptions)` : ''}
              </Text>
            ))}
            {weekly.newChores.length > 0 && <Muted>New chores found: {weekly.newChores.map((n) => n.sentence).join('; ')}</Muted>}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
