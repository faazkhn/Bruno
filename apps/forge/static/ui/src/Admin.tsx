import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import { Inline, Stack, Text } from '@atlaskit/primitives';
import SectionMessage from '@atlaskit/section-message';
import TextArea from '@atlaskit/textarea';
import Textfield from '@atlaskit/textfield';
import { useEffect, useState } from 'react';
import { call, type Settings } from './api';
import { BrunoSays, Card, day, Grid, Meter, Muted, num, pct, StatTile } from './ui';

interface Replay {
  understood: { rule: string; conditions: string[] }; inconclusive: boolean; unsupported?: string[]; reason?: string; error?: string;
  range?: { from: number; to: number }; wouldAct?: number; matchesPeople?: number; ruleOnly?: number; peopleOnly?: number; precision?: number; recall?: number; coverage?: number; sentence?: string;
  examples?: { key: string; outcome: string }[];
  hiddenExamples?: number;
}

/** Admin page: per-project settings and "replay an existing rule". */
export function Admin() {
  const [projects, setProjects] = useState<string[]>([]);
  const [projectKey, setProjectKey] = useState('');
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [json, setJson] = useState('');
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayErr, setReplayErr] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void call<string[]>('projects').then((p) => { setProjects(p); if (p[0]) setProjectKey(p[0]); }); }, []);
  useEffect(() => {
    if (!projectKey) return;
    setErr(null);
    void call<Settings>('settings', { projectKey }).then(setS).catch((e) => { setS(null); setErr(String(e.message)); });
  }, [projectKey]);

  const save = async () => {
    if (!s) return;
    const v = await call<Settings>('settings', { projectKey, save: { windowDays: s.windowDays, minCount: s.minCount, minPeople: s.minPeople, anchor: s.anchor, adminProjectKey: s.adminProjectKey ?? '' } });
    setS(v);
    setSaved('Saved. Re-analyse the project to apply.');
  };
  const run = async () => {
    setReplay(null);
    setReplayErr(null);
    setReplaying(true);
    // errors belong next to the button that caused them, not at the top of the page
    try { setReplay(await call<Replay>('replay', { projectKey, ruleJson: json })); } catch (e) { setReplayErr(String((e as Error).message)); } finally { setReplaying(false); }
  };
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => s && setS({ ...s, [k]: Number(e.target.value) });

  return (
    <Stack space="space.300">
      <BrunoSays>
        <Text weight="bold">The knobs, and a way to test rules you already have.</Text>
        <Text>Change how far back I look and what counts as a chore, or paste an existing automation rule and I’ll show what it would have done on real history. None of this changes anything in Jira.</Text>
      </BrunoSays>
      <Inline space="space.100" alignBlock="end" shouldWrap>
        <Stack space="space.050">
          <label htmlFor="pk"><Text weight="medium">Project key</Text></label>
          <Textfield id="pk" value={projectKey} onChange={(e) => setProjectKey((e.target as HTMLInputElement).value.toUpperCase())} width="small" />
        </Stack>
        {projects.map((p) => (
          <Button key={p} spacing="compact" appearance={p === projectKey ? 'primary' : 'subtle'} aria-pressed={p === projectKey} onClick={() => setProjectKey(p)}>{p}</Button>
        ))}
      </Inline>
      {err && <SectionMessage appearance="error">{err}</SectionMessage>}

      <Grid min={420}>
      {s && (
        <Card>
          <Stack space="space.150">
            <Heading size="small">Settings for {projectKey}</Heading>
            <Stack space="space.150">
              <Field id="wd" label="History window (days)" help="Learn on the first two thirds, prove on the last third."><Textfield id="wd" type="number" min={14} max={365} value={s.windowDays} onChange={num('windowDays')} /></Field>
              <Field id="mc" label="Minimum repeats" help="Actions on fewer items are never chores."><Textfield id="mc" type="number" min={5} value={s.minCount} onChange={num('minCount')} /></Field>
              <Field id="mp" label="Minimum people" help="Use 1 only on a single-person demo project."><Textfield id="mp" type="number" min={1} value={s.minPeople} onChange={num('minPeople')} /></Field>
              <Field id="ap" label="Hand-off project (optional)" help="Where admin work items go; defaults to the project itself."><Textfield id="ap" value={s.adminProjectKey ?? ''} onChange={(e) => setS({ ...s, adminProjectKey: (e.target as HTMLInputElement).value.toUpperCase() })} /></Field>
            </Stack>
            <Inline space="space.100" alignBlock="center">
              <input id="anchor" type="checkbox" checked={s.anchor === 'lastActivity'} onChange={(e) => setS({ ...s, anchor: e.target.checked ? 'lastActivity' : 'now' })} />
              <label htmlFor="anchor"><Text>End the window at the project’s last activity (for older or imported projects)</Text></label>
            </Inline>
            <Inline space="space.100" alignBlock="center"><Button appearance="primary" onClick={save}>Save settings</Button>{saved && <Muted>{saved}</Muted>}</Inline>
          </Stack>
        </Card>
      )}

      <Card>
        <Stack space="space.150">
          <Heading size="small">Test a rule you already have</Heading>
          <Muted>Paste a rule exported from Automation (Settings → System → Global automation → Export). Bruno shows what it would have done on {projectKey || 'the project'}’s history and how that compares with what people did. Nothing in Jira changes.</Muted>
          <label htmlFor="rule"><Text weight="medium">Rule JSON</Text></label>
          <TextArea id="rule" value={json} onChange={(e) => setJson(e.target.value)} minimumRows={6} resize="vertical" />
          <Inline><Button onClick={run} isDisabled={!json.trim() || !projectKey} isLoading={replaying}>Replay</Button></Inline>
          <div aria-live="polite">
            {replayErr && <SectionMessage appearance="error" title="Replay failed">{replayErr}</SectionMessage>}
            {replay && <ReplayResult r={replay} />}
          </div>
        </Stack>
      </Card>
      </Grid>
    </Stack>
  );
}

function Field({ id, label, help, children }: { id: string; label: string; help: string; children: React.ReactNode }) {
  return (
    <Stack space="space.050">
      <label htmlFor={id}><Text weight="medium">{label}</Text></label>
      {children}
      <Muted>{help}</Muted>
    </Stack>
  );
}

function ReplayResult({ r }: { r: Replay }) {
  if (r.error) return <SectionMessage appearance="error">{r.error}</SectionMessage>;
  if (r.inconclusive) return <SectionMessage appearance="warning" title="Inconclusive">{r.reason} {r.unsupported?.length ? `Can’t model: ${r.unsupported.join('; ')}.` : ''}</SectionMessage>;
  return (
    <Stack space="space.150">
      <Text><strong>{r.sentence}</strong></Text>
      <Muted>{day(r.range!.from)} – {day(r.range!.to)}</Muted>
      <Grid min={130}>
        <StatTile label="Would act" value={num(r.wouldAct!)} />
        <StatTile label="People agreed" value={num(r.matchesPeople!)} sub={pct(r.precision!)} />
        <StatTile label="Rule only" value={num(r.ruleOnly!)} sub="people didn’t" />
        <StatTile label="People only" value={num(r.peopleOnly!)} sub="rule wouldn’t" />
      </Grid>
      <Meter part={r.matchesPeople!} whole={r.wouldAct!} label={`People agreed on ${r.matchesPeople} of the ${r.wouldAct} times the rule would act`} />
      <Muted>Recall {pct(r.recall!)} · coverage {pct(r.coverage!)}</Muted>
      {!!r.hiddenExamples && <Muted>{r.hiddenExamples} examples hidden: you don’t have permission to see them.</Muted>}
      {r.examples && r.examples.length > 0 && <Muted>Examples: {r.examples.map((e) => `${e.key} (${e.outcome})`).join(', ')}</Muted>}
    </Stack>
  );
}
