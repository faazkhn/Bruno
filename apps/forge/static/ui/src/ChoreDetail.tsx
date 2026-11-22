import Button from '@atlaskit/button/new';
import Drawer from '@atlaskit/drawer';
import DynamicTable from '@atlaskit/dynamic-table';
import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import { Inline, Stack, Text } from '@atlaskit/primitives';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import Spinner from '@atlaskit/spinner';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import { token } from '@atlaskit/tokens';
import { router } from '@forge/bridge';
import { useEffect, useState } from 'react';
import { call, type Case, type ChoreDetail as Detail } from './api';
import { AgreementBar, Card, day, Muted, NumberLink, pct, StatusChip, VerdictChip, when } from './ui';

const TABS: { id: Case['outcome']; label: string; empty: string }[] = [
  { id: 'TP', label: 'Matches', empty: 'No matches on the holdout period.' },
  { id: 'FP', label: 'Rule would act', empty: 'The rule never acted where people didn’t.' },
  { id: 'FN', label: 'People acted', empty: 'People never acted where the rule wouldn’t.' },
  { id: 'inconclusive', label: 'Inconclusive', empty: 'Every case could be modelled.' },
];
const FIELD: Record<string, string> = { requestType: 'Request type', priority: 'Priority', status: 'Status', components: 'Component', labels: 'Labels', organizations: 'Organization', assignee: 'Assignee', issuetype: 'Work type', summary: 'Summary', resolution: 'Resolution', fixVersions: 'Fix version' };

export function ChoreDetail({ choreId, initialTab, onBack }: { choreId: string; initialTab?: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(Math.max(0, TABS.findIndex((t) => t.id === initialTab)));
  const [open, setOpen] = useState<Case | null>(null);
  const [filterKeys, setFilterKeys] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ appearance: 'success' | 'warning' | 'error'; text: string } | null>(null);

  const load = () => call<Detail>('chore', { choreId }).then(setD).catch((e) => setError(String(e.message)));
  useEffect(() => { void load(); }, [choreId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <SectionMessage appearance="error" title="Couldn’t load this chore">{error}</SectionMessage>;
  if (!d) return <Spinner label="Loading proof" />;
  const c = d.chore;
  const p = c.proof;
  const nm = (field: string, v: string | null) => (v == null ? '—' : v.split(',').map((x) => d.names[field]?.[x] ?? x).join(', '));
  const show = (i: number, keys: string[] | null = null) => { setTab(i); setFilterKeys(keys); };
  const blocked = c.verdict !== 'proven' ? 'Hand-off needs a proven rule.' : p.coverage < d.settings.minCoverage ? `Hand-off needs coverage ≥ ${pct(d.settings.minCoverage)}.` : null;

  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try { await fn(); } catch (e) { setNotice({ appearance: 'error', text: String((e as Error).message) }); } finally { setBusy(null); }
  };
  const exclude = () => act('exclude', async () => { setD(await call<Detail>('exclude', { choreId })); setNotice({ appearance: 'success', text: 'New version re-proved on the same holdout period.' }); });
  const dismiss = () => act('dismiss', async () => { await call('setStatus', { choreId, status: d.status === 'dismissed' ? 'new' : 'dismissed' }); await load(); });
  const handOff = () => act('handoff', async () => {
    const r = await call<{ created: boolean; key?: string; reason?: string }>('sendToAdmin', { choreId, confirm: true });
    setConfirming(false);
    setNotice(r.created ? { appearance: 'success', text: `Hand-off created: ${r.key}. The rule JSON and import steps are attached.` } : { appearance: 'warning', text: r.reason ?? 'Not created.' });
    await load();
  });

  const cases = p.cases.filter((x) => x.outcome === TABS[tab]!.id && (!filterKeys || filterKeys.includes(x.key)));
  const counts: Record<string, number> = { TP: p.tp, FP: p.fp, FN: p.fn, inconclusive: p.inconclusive };

  return (
    <Stack space="space.300">
      <Inline space="space.100" alignBlock="center"><Button appearance="subtle" onClick={onBack}>← All chores</Button></Inline>
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <VerdictChip verdict={c.verdict} />
          <StatusChip status={d.status} />
          <Lozenge>Version {c.version}</Lozenge>
        </Inline>
        <Heading size="medium">{c.sentence}</Heading>
        <Muted>Done by hand {c.count} times by {c.people} {c.people === 1 ? 'person' : 'people'} in this window.{c.note ? ` Note: ${c.note}.` : ''}</Muted>
      </Stack>
      {notice && <SectionMessage appearance={notice.appearance}>{notice.text}</SectionMessage>}

      <Card>
        <Stack space="space.200">
          <Heading size="small">Proof</Heading>
          <Text>
            Tested on {day(p.range.from)} – {day(p.range.to)}, a period not used for learning. The rule would have acted {p.tp + p.fp} times and matched your team on{' '}
            <NumberLink onClick={() => show(0)} label="Show matches">{p.tp}</NumberLink> of them.
          </Text>
          <AgreementBar
            segments={[
              { key: 'tp', label: 'Matches the team', value: p.tp, color: token('color.background.success.bold'), onClick: () => show(0) },
              { key: 'fp', label: 'Rule would act where people didn’t', value: p.fp, color: token('color.background.warning.bold'), onClick: () => show(1) },
              { key: 'fn', label: 'People acted where the rule wouldn’t', value: p.fn, color: token('color.background.discovery.bold'), onClick: () => show(2) },
              { key: 'inc', label: 'Inconclusive', value: p.inconclusive, color: token('color.background.neutral.bold'), onClick: () => show(3) },
            ]}
          />
          <Inline space="space.300" shouldWrap>
            <span title="Of the times the rule would act, how often people did the same"><Text>Precision {pct(p.precision)}</Text></span>
            <span title="Of the times people did it, how often the rule would have done it"><Text>Recall {pct(p.recall)}</Text></span>
            <span title="Share of cases we could model; under 80% blocks hand-off"><Text>Coverage {pct(p.coverage)}</Text></span>
          </Inline>
        </Stack>
      </Card>

      {c.exceptions && c.exceptions.groups.length > 0 && (
        <Card>
          <Stack space="space.150">
            <Heading size="small">Exceptions</Heading>
            {c.exceptions.groups.map((g, i) => (
              <Text key={i}>
                <NumberLink onClick={() => show(g.outcome === 'FP' ? 1 : 2, g.caseKeys)} label={`Show these ${g.differences} cases`}>{g.differences} of {g.ofDifferences}</NumberLink>{' '}
                {g.outcome === 'FP' ? 'times the rule would act where people didn’t' : 'times people acted where the rule wouldn’t'}: {c.exceptions!.described?.[i]} ({g.lift.toFixed(1)}× more often than elsewhere)
              </Text>
            ))}
            {c.exceptions.suggestion && (
              <SectionMessage
                appearance="discovery"
                title={`Suggested: exclude when ${c.exceptions.suggestionText}`}
                actions={[<SectionMessageAction key="apply" onClick={exclude}>{busy === 'exclude' ? 'Re-proving…' : 'Apply and re-prove'}</SectionMessageAction>]}
              >
                <Text>Explains {pct(c.exceptions.suggestion.share)} of the times the rule would act where people didn’t, and raises the learning-period F1 from {c.exceptions.suggestion.learnF1Before.toFixed(2)} to {c.exceptions.suggestion.learnF1After.toFixed(2)}. Uses only facts known when the trigger happens.</Text>
              </SectionMessage>
            )}
          </Stack>
        </Card>
      )}

      <Stack space="space.100">
        <Tabs id="cases" selected={tab} onChange={(i) => show(i)}>
          <TabList>{TABS.map((t) => <Tab key={t.id}>{`${t.label} (${counts[t.id]})`}</Tab>)}</TabList>
          {TABS.map((t) => (
            <TabPanel key={t.id}>
              <Stack space="space.100">
                {filterKeys && <Inline space="space.100" alignBlock="center"><Muted>Showing one exception group.</Muted><Button spacing="compact" appearance="subtle" onClick={() => setFilterKeys(null)}>Show all</Button></Inline>}
                <div style={{ overflowX: 'auto', width: '100%' }}>
                  <DynamicTable
                    head={{ cells: [{ key: 'k', content: 'Item' }, { key: 't', content: 'Trigger' }, { key: 'a', content: 'Person acted' }, { key: 'w', content: 'Why' }] }}
                    rows={cases.map((x, i) => ({
                      key: `${x.key}-${i}`,
                      cells: [
                        { key: 'k', content: <NumberLink onClick={() => setOpen(x)} label={`Open case ${x.key}`}>{x.key}</NumberLink> },
                        { key: 't', content: x.triggerTs ? when(x.triggerTs) : '—' },
                        { key: 'a', content: x.actionTs ? when(x.actionTs) : '—' },
                        { key: 'w', content: x.reason === 'no-trigger' ? 'No trigger before it' : x.clauses.map((cl, k) => ({ cl, k })).filter(({ cl }) => cl.value !== true).map(({ cl, k }) => `${c.clauseText?.[k] ?? cl.jql}: ${cl.value === false ? 'false' : 'unknown'}`).join('; ') || 'All conditions held' },
                      ],
                    }))}
                    rowsPerPage={20}
                    emptyView={<Muted>{t.empty}</Muted>}
                  />
                </div>
                {c.casesTruncated && <Muted>Showing up to 50 example cases of each kind; the counts above include every case.</Muted>}
              </Stack>
            </TabPanel>
          ))}
        </Tabs>
      </Stack>

      <Inline space="space.100" shouldWrap>
        <span title={blocked ?? 'Creates a work item for your Jira admin with the rule and import steps'}>
          <Button appearance="primary" isDisabled={!!blocked || !!d.handoff} onClick={() => setConfirming(true)}>{d.handoff ? `Handed off (${d.handoff.handoff_key})` : 'Send to admin'}</Button>
        </span>
        <Button onClick={dismiss} isDisabled={busy === 'dismiss'}>{d.status === 'dismissed' ? 'Restore chore' : 'Not a chore'}</Button>
        {d.handoff && <Button appearance="subtle" onClick={() => router.open(`/browse/${d.handoff!.handoff_key}`)}>Open hand-off</Button>}
      </Inline>
      {blocked && <Muted>{blocked}</Muted>}

      <ModalTransition>
        {confirming && (
          <Modal onClose={() => setConfirming(false)}>
            <ModalHeader><ModalTitle>Send this rule to your admin?</ModalTitle></ModalHeader>
            <ModalBody>
              <Stack space="space.100">
                <Text>Creates a Jira work item “Automate: {c.sentence}” in {d.settings.adminProjectKey || 'this project'} with the proof summary, the rule JSON and import steps.</Text>
                <Muted>The imported rule arrives disabled. Nothing else in Jira changes.</Muted>
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button appearance="primary" onClick={handOff} isLoading={busy === 'handoff'}>Create hand-off</Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>

      <Drawer isOpen={!!open} onClose={() => setOpen(null)} width="wide" label="Case details">
        {open && <CaseView c={open} detail={d} nm={nm} />}
      </Drawer>
    </Stack>
  );
}

interface Timeline { key: string; summary: string; events: { ts: number; kind: string; actor: string; field: string | null; from: string | null; to: string | null }[] }

function CaseView({ c, detail, nm }: { c: Case; detail: Detail; nm: (f: string, v: string | null) => string }) {
  const [tl, setTl] = useState<Timeline | null>(null);
  const around = c.triggerTs ?? c.actionTs ?? 0;
  useEffect(() => { void call<Timeline>('timeline', { issueId: c.issueId, around }).then(setTl).catch(() => setTl(null)); }, [c.issueId, around]);
  const outcome = { TP: 'Matches the team', FP: 'Rule would act where people didn’t', FN: 'People acted where the rule wouldn’t', inconclusive: 'Inconclusive' }[c.outcome];
  const actor = { human_agent: 'A person', customer: 'Customer', automation: 'Automation', app: 'An app' } as Record<string, string>;
  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center">
          <Heading size="medium">{c.key}</Heading>
          <Button appearance="subtle" onClick={() => router.open(`/browse/${c.key}`)}>Open in Jira (history tab)</Button>
        </Inline>
        <Text>{outcome}{c.reason === 'no-trigger' ? ' — the trigger never happened shortly before this.' : ''}</Text>
        <Muted>{c.triggerTs ? `Trigger: ${when(c.triggerTs)}` : 'No trigger'} · {c.actionTs ? `Person acted: ${when(c.actionTs)}` : 'No person acted within the window'}</Muted>
      </Stack>
      {c.clauses.length > 0 && (
        <Stack space="space.100">
          <Heading size="small">Conditions at that moment</Heading>
          {c.clauses.map((cl, i) => (
            <Inline key={i} space="space.100" alignBlock="center">
              <Lozenge appearance={cl.value === true ? 'success' : cl.value === false ? 'removed' : 'default'}>{cl.value === true ? 'True' : cl.value === false ? 'False' : 'Unknown'}</Lozenge>
              <Text>{detail.chore.clauseText?.[i] ?? cl.jql}</Text>
            </Inline>
          ))}
        </Stack>
      )}
      <Stack space="space.100">
        <Heading size="small">The item {c.triggerTs ? 'when the trigger happened' : 'just before the person acted'}</Heading>
        <DynamicTable
          head={{ cells: [{ key: 'f', content: 'Field' }, { key: 'v', content: 'Value' }] }}
          rows={Object.entries(c.snapshot).filter(([f]) => f !== 'fixVersions').map(([f, v]) => ({ key: f, cells: [{ key: 'f', content: FIELD[f] ?? f }, { key: 'v', content: nm(f, v) }] }))}
        />
      </Stack>
      <Stack space="space.100">
        <Heading size="small">What happened around it</Heading>
        {!tl ? <Spinner size="small" label="Loading history" /> : tl.events.map((e, i) => (
          <Text key={i}>
            {when(e.ts)} · {actor[e.actor] ?? e.actor}{' '}
            {e.kind === 'created' ? 'created it' : e.kind === 'comment' ? `commented (${e.field})` : `changed ${FIELD[e.field ?? ''] ?? e.field}: ${e.from ?? '—'} → ${e.to ?? '—'}`}
          </Text>
        ))}
        <Muted>People are never named here: Wind Tunnel only knows whether a person, a customer or automation acted. Rule: {detail.chore.sentence}</Muted>
      </Stack>
    </Stack>
  );
}
