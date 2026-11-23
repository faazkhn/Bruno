import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import { Inline, Stack, Text } from '@atlaskit/primitives';
import SectionMessage from '@atlaskit/section-message';
import Spinner from '@atlaskit/spinner';
import { token } from '@atlaskit/tokens';
import { useEffect, useState } from 'react';
import { call, getProject, setProject, type HomeRow, type ProjectRef } from './api';
import { ChoreList } from './ChoreList';
import { Card, Grid, Muted } from './ui';

/** Bruno's home (Apps → Bruno): a welcome on first run, then every analysed project in one place. */
export function Home({ onOpen }: { onOpen: (choreId: string, tab?: string) => void }) {
  const [rows, setRows] = useState<HomeRow[] | null>(null);
  const [project, setProj] = useState<string | undefined>(getProject());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => call<HomeRow[]>('home').then((r) => {
    setRows(r);
    if (!r.some((x) => x.projectKey === project)) setProj(r.find((x) => x.chores > 0)?.projectKey ?? r[0]?.projectKey);
  }).catch((e) => setError(String((e as Error).message)));
  useEffect(() => { void load(); }, []);

  if (error) return <SectionMessage appearance="error" title="Bruno couldn’t load">{error}</SectionMessage>;
  if (!rows) return <Spinner label="Loading Bruno" />;
  if (!rows.length || adding || !project) {
    return <Welcome onCancel={rows.length ? () => setAdding(false) : undefined} onDone={(key) => { setProj(key); setAdding(false); void load(); }} />;
  }
  setProject(project); // every call below is about this project
  return (
    <Stack space="space.300">
      <ChoreList
        key={project}
        onOpen={onOpen}
        toolbar={
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Text weight="medium" color="color.text.subtle">Project</Text>
            {rows.map((r) => (
              <Button key={r.projectKey} spacing="compact" appearance={r.projectKey === project ? 'primary' : 'subtle'} aria-pressed={r.projectKey === project} onClick={() => setProj(r.projectKey)}>
                {`${r.projectKey}${r.demo ? ' · sample data' : ''}`}
              </Button>
            ))}
            <Button spacing="compact" appearance="subtle" onClick={() => setAdding(true)}>+ Add a project</Button>
          </Inline>
        }
      />
    </Stack>
  );
}

function Welcome({ onDone, onCancel }: { onDone: (projectKey: string) => void; onCancel?: () => void }) {
  const [projects, setProjects] = useState<ProjectRef[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<'real' | 'sample' | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void call<ProjectRef[]>('allProjects')
      .then((p) => setProjects([...p].sort((a, b) => Number(b.type === 'service_desk') - Number(a.type === 'service_desk'))))
      .catch((e) => setError(String((e as Error).message)));
  }, []);

  const begin = async (mode: 'real' | 'sample') => {
    if (!pick) return;
    setBusy(mode);
    try {
      setProject(pick);
      await (mode === 'real' ? call('start') : call('demo', { on: true }));
      onDone(pick);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(null);
    }
  };

  return (
    <Stack space="space.400">
      <Inline space="space.300" alignBlock="center">
        <img src="./bruno.png" width={112} height={112} alt="Bruno, a smiling cartoon man with curly hair, round glasses and a beard" style={{ flexShrink: 0 }} />
        <Stack space="space.100" grow="fill">
          <Heading size="xlarge">Ciao, I’m Bruno.</Heading>
          <Text size="large">I find the clicks your team repeats by hand in Jira, and prove an automation rule for each one on tickets I never learned from.</Text>
          <Muted>I never change anything in Jira on my own: your admin reviews every rule, and it arrives switched off.</Muted>
        </Stack>
      </Inline>
      {error && <SectionMessage appearance="error" title="Something went wrong">{error}</SectionMessage>}

      <Stack space="space.150">
        <Heading size="small">1 · Pick a project</Heading>
        {!projects ? <Spinner size="small" label="Loading projects" /> : !projects.length ? <Muted>You can’t browse any projects yet.</Muted> : (
          <div style={{ maxHeight: 300, overflowY: 'auto', padding: 2 }}>
          <Grid min={200}>
            {projects.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={pick === p.key}
                onClick={() => setPick(p.key)}
                style={{
                  all: 'unset', cursor: 'pointer', padding: 16, borderRadius: 8, background: token('elevation.surface.raised'),
                  border: `2px solid ${pick === p.key ? token('color.border.selected') : token('color.border')}`,
                }}
              >
                <Stack space="space.050">
                  <Text weight="bold">{p.name}</Text>
                  <Inline space="space.100"><Text size="small" color="color.text.subtle">{p.key}</Text>{p.type === 'service_desk' && <Lozenge>Service</Lozenge>}</Inline>
                </Stack>
              </button>
            ))}
          </Grid>
          </div>
        )}
      </Stack>

      <Stack space="space.150">
        <Heading size="small">2 · How should I start?</Heading>
        <Grid min={280}>
          <Card>
            <Stack space="space.100">
              <Text weight="bold">Read its real history</Text>
              <Muted>Best when the project has a few weeks of work. I read the last 90 days in the background; nothing in Jira changes.</Muted>
              <Inline><Button appearance="primary" isDisabled={!pick || !!busy} isLoading={busy === 'real'} onClick={() => begin('real')}>Read real history</Button></Inline>
            </Stack>
          </Card>
          <Card>
            <Stack space="space.100">
              <Text weight="bold">Show me with sample data</Text>
              <Muted>Best for a first look or an empty project: 90 simulated days with planted chores, clearly labelled as sample data.</Muted>
              <Inline><Button isDisabled={!pick || !!busy} isLoading={busy === 'sample'} onClick={() => begin('sample')}>Use sample data</Button></Inline>
            </Stack>
          </Card>
        </Grid>
        {!pick && <Muted>Pick a project first.</Muted>}
      </Stack>
      {onCancel && <Inline><Button appearance="subtle" onClick={onCancel}>Back to my projects</Button></Inline>}
    </Stack>
  );
}
