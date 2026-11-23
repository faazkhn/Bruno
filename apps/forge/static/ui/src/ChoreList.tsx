import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import { Inline, Stack, Text } from '@atlaskit/primitives';
import { ProgressTracker } from '@atlaskit/progress-tracker';
import SectionMessage from '@atlaskit/section-message';
import Spinner from '@atlaskit/spinner';
import { token } from '@atlaskit/tokens';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { call, type Overview, type Progress, type Status, type Summary } from './api';
import { BarChart, Brand, BrunoSays, Card, day, Grid, likely, Meter, Muted, num, pct, StatTile, StatusChip, VerdictChip } from './ui';

const PHASES: { id: Progress['phase']; label: string }[] = [
  { id: 'listing', label: 'Listing items' },
  { id: 'fetching', label: 'Fetching history' },
  { id: 'mining', label: 'Finding chores' },
  { id: 'proving', label: 'Proving on holdout' },
];
const running = (p?: Progress) => !!p && ['listing', 'fetching', 'mining', 'proving'].includes(p.phase);

interface Weekly { live: { ref: string; sentence: string; runs: number; reversed: number }[]; newChores: { ref: string; sentence: string }[]; from: number; to: number }

/** Chore sentences all start alike ("When a work item is created, if …"): lead with what the chore does. */
const split = (s: string) => { const i = s.lastIndexOf(', '); return i < 0 ? { what: s, when: '' } : { what: s.slice(i + 2, i + 3).toUpperCase() + s.slice(i + 3), when: s.slice(0, i) }; };

export function ChoreList({ onOpen, toolbar }: { onOpen: (choreId: string, tab?: string) => void; toolbar?: ReactNode }) {
  const [data, setData] = useState<Overview | null>(null);
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | Status>('active');
  const [sort, setSort] = useState<'hand' | 'ready'>('hand');

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

  const demo = async (on: boolean) => {
    const p = await call<Progress>('demo', { on });
    setData((d) => (d ? { ...d, progress: p, demo: on, meta: null, chores: [] } : d));
    setWeekly(null);
  };
  const start = async () => {
    const p = await call<Progress>('start');
    setData((d) => (d ? { ...d, progress: p } : d));
  };

  if (error) return <SectionMessage appearance="error" title="Bruno couldn’t load">{error}</SectionMessage>;
  if (!data) return <Spinner label="Loading chores" />;

  const { progress, meta, settings } = data;
  const phaseIndex = PHASES.findIndex((p) => p.id === progress.phase);
  const chores = data.chores;
  const days = meta ? Math.max(1, Math.round((meta.window.end - meta.window.start) / 86_400_000)) : settings.windowDays;
  const total = chores.reduce((n, c) => n + c.count, 0);
  const ready = chores.filter((c) => c.verdict === 'proven');
  // a rule counts as live when it is marked live or signed a run this week (statuses reset when sample data is reloaded)
  const live = chores.filter((c) => c.status === 'live' || weekly?.live.some((l) => l.ref === c.ref && l.runs > 0));
  const fixable = chores.filter((c) => c.verdict !== 'proven' && c.fixable);
  const perMonthReady = Math.round(ready.reduce((n, c) => n + c.perMonth, 0));
  const runsThisWeek = weekly?.live.reduce((n, l) => n + l.runs, 0) ?? 0;
  const rank = (c: Summary) => (c.verdict === 'proven' ? 2 : c.fixable ? 1 : 0);
  const shown = chores
    .filter((c) => (filter === 'active' ? c.status !== 'dismissed' : c.status === filter))
    .sort((a, b) => (sort === 'ready' ? rank(b) - rank(a) || b.precision - a.precision : b.count - a.count));
  const countOf = (f: 'active' | Status) => chores.filter((c) => (f === 'active' ? c.status !== 'dismissed' : c.status === f)).length;

  return (
    <Stack space="space.300">
      <Inline spread="space-between" alignBlock="center" shouldWrap>
        {toolbar ?? <Brand tagline="Chores your team does by hand, and rules proven on your team's past tickets." />}
        <Button appearance={meta ? 'default' : 'primary'} onClick={start} isDisabled={running(progress)}>
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
            <Muted>{progress.phase === 'fetching' ? `${num(progress.done)} items read so far…` : 'This runs in the background, you can leave this page.'}</Muted>
          </Stack>
        </Card>
      )}
      {data.demo && (
        <SectionMessage appearance="information" title="You’re looking at sample data">
          <Stack space="space.100">
            <Text>90 days generated from Bruno’s published history-bot config (4 agents, planted chores, a VIP exception, noise and bulk edits). Every number is a real run of the engine on that history; the items aren’t real Jira work items.</Text>
            <Inline><Button spacing="compact" onClick={() => demo(false)}>Use this project’s real history</Button></Inline>
          </Stack>
        </SectionMessage>
      )}
      {progress.phase === 'error' && <SectionMessage appearance="error" title="The last analysis failed">{progress.error}</SectionMessage>}

      {!meta && !running(progress) && (
        <BrunoSays>
          <Text weight="bold">Ciao! I haven’t looked at this project yet.</Text>
          <Text>I read its history, find the clicks people repeat by hand, and prove a rule for each one on later tickets I never learned from. I never change anything in Jira on my own.</Text>
          <Muted>A chore needs at least {settings.minCount} repeats by {settings.minPeople} or more people.</Muted>
          <Inline space="space.100" shouldWrap>
            <Button appearance="primary" onClick={start}>Read the last {settings.windowDays} days</Button>
            <Button onClick={() => demo(true)}>Show me with sample data</Button>
          </Inline>
        </BrunoSays>
      )}

      {meta && !chores.length && !running(progress) && (
        <BrunoSays>
          <Text weight="bold">I looked at {num(meta.issues)} work items and found no chores yet.</Text>
          <Text>A chore needs at least {settings.minCount} repeats by {settings.minPeople} or more people, with a clear trigger before it.</Text>
          {meta.unexplained.length > 0 && <Muted>Repeated but not automatable yet: {meta.unexplained.slice(0, 5).map((u) => `${u.id} (${u.count}×, ${u.reason === 'no-trigger' ? 'no trigger' : 'no pattern'})`).join(', ')}.</Muted>}
          {!data.demo && <Inline><Button onClick={() => demo(true)}>Show me with sample data</Button></Inline>}
        </BrunoSays>
      )}

      {meta && chores.length > 0 && (
        <>
          <BrunoSays>
            <Text weight="bold">
              Ciao! In {num(meta.issues)} {data.demo ? 'sample ' : ''}work items from the last {days} days, your team did {chores.length} chore{chores.length === 1 ? '' : 's'} by hand, {num(total)} times.
            </Text>
            <Text>
              {ready.length
                ? `${ready.length} rule${ready.length === 1 ? ' is' : 's are'} validated and ready for your admin, about ${num(perMonthReady)} clicks a month I could take off your plate.`
                : 'None of the rules is validated yet.'}
              {fixable.length ? ` ${fixable.length} more could get there with one exclusion I found.` : ''}
              {live.length ? ` ${live.length} ${live.length === 1 ? 'is' : 'are'} already running.` : ''}
            </Text>
          </BrunoSays>

          <Grid min={190}>
            <StatTile label="Done by hand" value={num(total)} sub={`in ${days} days`} />
            <StatTile label="Chores found" value={num(chores.length)} sub={`${fixable.length} fixable with one exclusion`} />
            <StatTile label="Ready for your admin" value={num(ready.length)} sub={ready.length ? `~${num(perMonthReady)} clicks a month` : 'validated on unseen tickets'} />
            <StatTile label="Running live" value={num(live.length)} sub={`${num(runsThisWeek)} run${runsThisWeek === 1 ? '' : 's'} this week`} />
          </Grid>

          <Card>
            <Stack space="space.150">
              <Heading size="small">Where your team’s clicks go</Heading>
              <Muted>Times each chore was done by hand in the last {days} days. Click a bar to see its proof.</Muted>
              <BarChart
                onOpen={(id) => onOpen(id)}
                rows={[...chores].sort((a, b) => b.count - a.count).slice(0, 8).map((c) => ({
                  id: c.id, label: split(c.sentence).what, detail: split(c.sentence).when, value: c.count, tag: c.verdict === 'proven' ? 'validated' : c.verdict === 'needs-judgment' ? 'needs judgment' : 'not yet',
                  tip: `${c.sentence} · ${num(c.count)} times by ${c.people} people · agreed ${c.matches} of ${c.fires} · ${likely(c.precisionLikely)}`,
                }))}
              />
            </Stack>
          </Card>

          <Stack space="space.150">
            <Inline spread="space-between" alignBlock="center" shouldWrap>
              <Heading size="small">Chores</Heading>
              <Inline space="space.100" alignBlock="center" shouldWrap>
                {(['active', 'new', 'handed_off', 'live', 'dismissed'] as const).map((f) => (
                  <Button key={f} appearance={filter === f ? 'primary' : 'subtle'} spacing="compact" onClick={() => setFilter(f)} aria-pressed={filter === f}>
                    {`${{ active: 'All', new: 'New', handed_off: 'Handed off', live: 'Live', dismissed: 'Not a chore' }[f as string]} (${countOf(f)})`}
                  </Button>
                ))}
                <Button spacing="compact" appearance="subtle" onClick={() => setSort(sort === 'hand' ? 'ready' : 'hand')}>
                  {sort === 'hand' ? 'Sorted by hand-work' : 'Sorted by readiness'}
                </Button>
              </Inline>
            </Inline>
            {shown.length ? <Grid min={320}>{shown.map((c) => <ChoreCard key={c.id} c={c} onOpen={onOpen} />)}</Grid> : <Muted>No chores with this status.</Muted>}
          </Stack>

          {weekly && (weekly.live.length > 0 || weekly.newChores.length > 0) && (
            <Card>
              <Stack space="space.100">
                <Heading size="small">This week ({day(weekly.from)} – {day(weekly.to)})</Heading>
                {weekly.live.map((l) => (
                  <Text key={l.ref}>
                    {l.sentence}: ran {l.runs} time{l.runs === 1 ? '' : 's'}
                    {l.reversed ? `, possible human corrections within 24 h: ${l.reversed} (a person set the field back after the rule ran)` : ''}
                  </Text>
                ))}
                {weekly.newChores.length > 0 && <Muted>New chores found: {weekly.newChores.map((n) => n.sentence).join('; ')}</Muted>}
              </Stack>
            </Card>
          )}

          <Muted>
            Learned on {day(meta.window.start)} – {day(meta.window.cut)} · proved on {day(meta.window.cut)} – {day(meta.window.end)} (not used for learning) · last run {day(meta.runAt)}
            {settings.minPeople < 2 ? ` · counting chores done by ${settings.minPeople} person or more (setting)` : ''}
          </Muted>
        </>
      )}
    </Stack>
  );
}

/** One chore: what it is, how sure we are, and the obvious next step. */
function ChoreCard({ c, onOpen }: { c: Summary; onOpen: (choreId: string, tab?: string) => void }) {
  const next = c.status === 'live' ? 'See live runs' : c.verdict === 'proven' && !c.handoff ? 'Review & hand off' : c.fixable && c.verdict !== 'proven' ? 'See the fix' : 'Open proof';
  return (
    <Card>
      <Stack space="space.150">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <VerdictChip verdict={c.verdict} />
          <StatusChip status={c.status} />
        </Inline>
        <button type="button" onClick={() => onOpen(c.id)} style={{ all: 'unset', cursor: 'pointer', font: token('font.heading.xsmall'), color: token('color.text') }}>{c.sentence}</button>
        <Muted>{num(c.count)} times by hand · {c.people} {c.people === 1 ? 'person' : 'people'}</Muted>
        <Stack space="space.075">
          <Meter part={c.matches} whole={c.fires} label={`Agreed with the team on ${c.matches} of ${c.fires} times it would act`} />
          <Text size="small">Agreed {num(c.matches)} of {num(c.fires)} times it would act · {pct(c.precision)}, {likely(c.precisionLikely)}</Text>
        </Stack>
        <Inline><Button appearance={next === 'Review & hand off' ? 'primary' : 'default'} spacing="compact" onClick={() => onOpen(c.id)}>{next}</Button></Inline>
      </Stack>
    </Card>
  );
}
