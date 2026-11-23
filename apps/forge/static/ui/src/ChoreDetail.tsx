import Button from '@atlaskit/button/new';
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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { call, type Case, type ChoreDetail as Detail } from './api';
import { AgreementBar, BarChart, BrunoSays, Card, day, Grid, likely, Muted, num, NumberLink, pct, RangeChart, StatTile, StatusChip, VerdictChip, WeeklyChart, when } from './ui';

const TABS: { id: Case['outcome']; label: string; empty: string }[] = [
  { id: 'TP', label: 'Matches', empty: 'No matches on the holdout period.' },
  { id: 'FP', label: 'Rule would act', empty: 'The rule never acted where people didn’t.' },
  { id: 'FN', label: 'People acted', empty: 'People never acted where the rule wouldn’t.' },
  { id: 'inconclusive', label: 'Inconclusive', empty: 'Every case could be modelled.' },
];
const times = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const FIELD: Record<string, string> = { requestType: 'Request type', priority: 'Priority', status: 'Status', components: 'Component', labels: 'Labels', organizations: 'Organization', assignee: 'Assignee', issuetype: 'Work type', summary: 'Summary', resolution: 'Resolution', fixVersions: 'Fix version' };

export function ChoreDetail({ choreId, initialTab, onBack }: { choreId: string; initialTab?: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(Math.max(0, TABS.findIndex((t) => t.id === initialTab)));
  const [open, setOpen] = useState<Case | null>(null);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const caseRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ appearance: 'success' | 'warning' | 'error'; text: string } | null>(null);

  const load = () => call<Detail>('chore', { choreId }).then(setD).catch((e) => setError(String(e.message)));
  useEffect(() => { void load(); }, [choreId]);

  if (error) return <SectionMessage appearance="error" title="Couldn’t load this chore">{error}</SectionMessage>;
  if (!d) return <Spinner label="Loading proof" />;
  const c = d.chore;
  const p = c.proof;
  const nm = (field: string, v: string | null) => (v == null ? '—' : v.split(',').map((x) => d.names[field]?.[x] ?? x).join(', '));
  const show = (i: number) => setTab(i);
  // the case view renders inline: fixed drawers get clipped inside Jira's auto-sized iframe
  const openCase = (x: Case) => { setOpen(x); setTimeout(() => caseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const blocked = c.verdict !== 'proven' ? 'Hand-off needs a validated rule.' : p.coverage < d.settings.minCoverage ? `Hand-off needs coverage ≥ ${pct(d.settings.minCoverage)}.` : null;

  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try { await fn(); } catch (e) { setNotice({ appearance: 'error', text: String((e as Error).message) }); } finally { setBusy(null); }
  };
  const exclude = () => act('exclude', async () => { setD(await call<Detail>('exclude', { choreId })); setNotice({ appearance: 'success', text: 'New version re-proved on the untouched holdout period.' }); });
  const dismiss = () => act('dismiss', async () => { await call('setStatus', { choreId, status: d.status === 'dismissed' ? 'new' : 'dismissed' }); await load(); });
  const handOff = () => act('handoff', async () => {
    const r = await call<{ created: boolean; key?: string; reason?: string }>('sendToAdmin', { choreId, confirm: true });
    setConfirming(false);
    setNotice(r.created ? { appearance: 'success', text: `Hand-off created: ${r.key}. The rule JSON and import steps are attached.` } : { appearance: 'warning', text: r.reason ?? 'Not created.' });
    await load();
  });

  const cases = p.cases.filter((x) => x.outcome === TABS[tab]!.id);
  const counts: Record<string, number> = { TP: p.tp, FP: p.fp, FN: p.fn, inconclusive: p.inconclusive };

  const i = (c.sentence ?? '').lastIndexOf(', ');
  const what = i < 0 ? c.sentence ?? c.id : (c.sentence ?? '').slice(i + 2, i + 3).toUpperCase() + (c.sentence ?? '').slice(i + 3);
  const cond = i < 0 ? '' : (c.sentence ?? '').slice(0, i);
  const bar = c.verdict === 'needs-judgment' ? null : d.summary.risk === 'medium' ? 0.85 : 0.8;
  const lk = d.summary.precisionLikely;
  const say = {
    proven: [`This one’s ready.`, `On tickets I never learned from, the rule agreed with your team ${num(p.tp)} of ${num(p.tp + p.fp)} times. Even the cautious end of that (${Math.floor(lk.low * 100)}%) clears the ${Math.round((bar ?? 0.8) * 100)}% bar.`],
    weak: [`Close, but not yet.`, `It agreed ${num(p.tp)} of ${num(p.tp + p.fp)} times (${pct(p.precision)}, likely ${Math.floor(lk.low * 100)}–${Math.ceil(lk.high * 100)}%), and it needs ${Math.round((bar ?? 0.8) * 100)}%.${c.exceptions?.suggestion ? ` I think I know why: most misses are when ${c.exceptions.suggestionText}. Try the fix below.` : ''}`],
    'too-few': ['Not enough tickets yet.', `People did this only ${p.tp + p.fn} times in the test period. I need at least ${d.settings.minHoldoutPositives} before I’ll vouch for a rule.`],
    'low-coverage': ['I can’t see enough of these.', `I could only model ${pct(p.coverage)} of the cases, and unknown never counts as safe.`],
    'needs-judgment': ['I’d leave this one to people.', 'It closes or resolves work, and that always needs a human to decide, however often it’s done by hand.'],
  }[c.verdict];

  return (
    <Stack space="space.300">
      <Inline spread="space-between" alignBlock="center" shouldWrap>
        <Button appearance="subtle" onClick={onBack}>← All chores</Button>
        <Inline space="space.100" shouldWrap>
          {d.handoff && <Button appearance="subtle" onClick={() => router.open(`/browse/${d.handoff!.handoff_key}`)}>Open hand-off</Button>}
          <Button onClick={dismiss} isDisabled={busy === 'dismiss'}>{d.status === 'dismissed' ? 'Restore chore' : 'Not a chore'}</Button>
          <span title={blocked ?? 'Creates a work item for your Jira admin with the rule and import steps'}>
            <Button appearance="primary" isDisabled={!!blocked || !!d.handoff} onClick={() => setConfirming(true)}>{d.handoff ? `Handed off (${d.handoff.handoff_key})` : 'Send to admin'}</Button>
          </span>
        </Inline>
      </Inline>

      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <VerdictChip verdict={c.verdict} />
          <StatusChip status={d.status} />
          <Lozenge>Version {c.version}</Lozenge>
        </Inline>
        <Heading size="large">{what}</Heading>
        {cond && <Text size="large" color="color.text.subtle">{cond}</Text>}
        {c.note && <Muted>Note: {c.note}.</Muted>}
      </Stack>
      {notice && <SectionMessage appearance={notice.appearance}>{notice.text}</SectionMessage>}

      <BrunoSays>
        <Text weight="bold">{say[0]}</Text>
        <Text>{say[1]}</Text>
      </BrunoSays>

      <Grid min={190}>
        <StatTile label="Agreed with your team" value={pct(p.precision)} sub={`${num(p.tp)} of ${num(p.tp + p.fp)} · ${likely(lk)}`} />
        <StatTile label="Caught of what people did" value={pct(p.recall)} sub={`${num(p.tp)} of ${num(p.tp + p.fn)} · ${likely(d.summary.recallLikely)}`} />
        <StatTile label="Could be modelled" value={pct(p.coverage)} sub={`needs ${pct(d.settings.minCoverage)}`} />
        <StatTile label="Done by hand" value={num(c.count)} sub={`by ${c.people} ${c.people === 1 ? 'person' : 'people'}`} />
      </Grid>

      <Grid min={420}>
        <Card>
          <Stack space="space.200">
            <Heading size="small">Tested on tickets Bruno never saw</Heading>
            <Text>
              {day(p.range.from)} – {day(p.range.to)}, a period not used for learning or for choosing exclusions. The rule would have acted {num(p.tp + p.fp)} times and agreed with your team on{' '}
              <NumberLink onClick={() => show(0)} label="Show matches">{num(p.tp)}</NumberLink> of them.
            </Text>
            <AgreementBar
              segments={[
                { key: 'tp', label: 'Matches the team', value: p.tp, color: token('color.background.success.bold'), onClick: () => show(0) },
                { key: 'fp', label: 'Rule would act where people didn’t', value: p.fp, color: token('color.background.warning.bold'), onClick: () => show(1) },
                { key: 'fn', label: 'People acted where the rule wouldn’t', value: p.fn, color: token('color.background.discovery.bold'), onClick: () => show(2) },
                { key: 'inc', label: 'Inconclusive', value: p.inconclusive, color: token('color.background.neutral.bold'), onClick: () => show(3) },
              ]}
            />
            <RangeChart onOpen={() => show(0)} rows={[{ id: c.id, label: 'Agreement', point: p.precision, low: lk.low, high: lk.high, bar, tag: c.verdict === 'proven' ? 'validated' : c.verdict === 'needs-judgment' ? 'needs judgment' : 'not yet' }]} />
            <Muted>Agreement with what your team did, not proof the team was always right.</Muted>
          </Stack>
        </Card>
        {d.trend && (
          <Card>
            <Stack space="space.150">
              <Heading size="small">Done by hand, week by week</Heading>
              <Muted>Every time a person did this in the last {d.trend.weeks.length} weeks.</Muted>
              <WeeklyChart start={d.trend.start} weeks={d.trend.weeks} unit="times by hand" />
            </Stack>
          </Card>
        )}
      </Grid>

      {d.shadow && (
        <Card>
          <Stack space="space.100">
            <Inline space="space.100" alignBlock="center"><Heading size="small">Shadow mode</Heading><Lozenge appearance="inprogress">Watching</Lozenge></Inline>
            {d.shadow.items === 0 ? (
              <Text>Watching work items that arrive after {day(d.shadow.from)}. None yet.</Text>
            ) : (
              <Text>
                Since {day(d.shadow.from)}, {times(d.shadow.items, 'new work item')} arrived{d.shadow.realItemsOnSimulatedRule ? ' on this project (real items)' : ''}. The rule would have acted {times(d.shadow.wouldAct, 'time')} and agreed with your team on {d.shadow.agreed}
                {d.shadow.peopleOnly ? `; people did it ${times(d.shadow.peopleOnly, 'time')} where it wouldn’t` : ''}.
              </Text>
            )}
            <Muted>Shadow mode only scores the rule on work it has never seen; nothing in Jira is changed.{d.shadow.realItemsOnSimulatedRule ? ' The rule was learned on the simulated history and is scored here on real work items.' : ''}</Muted>
          </Stack>
        </Card>
      )}

      {c.exceptions && c.exceptions.groups.length > 0 && (
        <Card>
          <Stack space="space.150">
            <Heading size="small">Why it misses</Heading>
            <Muted>Found on the learning period only ({c.exceptions.period ? `${day(c.exceptions.period.from)} – ${day(c.exceptions.period.to)}` : 'before the test'}), so the test above stays fair. Click a row to list the tickets.</Muted>
            <BarChart
              onOpen={(id) => setOpenGroup(openGroup === Number(id) ? null : Number(id))}
              rows={c.exceptions.groups.map((g, k) => ({
                id: String(k), label: (c.exceptions!.described?.[k] ?? '').replace(/^./, (x) => x.toUpperCase()), detail: g.outcome === 'FP' ? 'rule would act, people didn’t' : 'people acted, rule wouldn’t',
                value: g.differences, tag: `${g.lift.toFixed(1)}×`, display: `${num(g.differences)} of ${num(g.ofDifferences)} · ${g.lift.toFixed(1)}×`,
                tip: `${g.differences} of ${g.ofDifferences} differences, ${g.lift.toFixed(1)}× more often than elsewhere`,
              }))}
            />
            {openGroup !== null && c.exceptions.groups[openGroup] && (
              <Muted>
                Learning-period items{c.exceptions.groups[openGroup]!.caseKeys.length > 40 ? ` (first 40 of ${c.exceptions.groups[openGroup]!.caseKeys.length})` : ''}: {c.exceptions.groups[openGroup]!.caseKeys.slice(0, 40).join(', ') || 'hidden (you can’t browse them)'}
              </Muted>
            )}
            {c.exceptions.suggestion && (
              <SectionMessage
                appearance="discovery"
                title={`The fix: leave out ${c.exceptions.suggestionText}`}
                actions={[<SectionMessageAction key="apply" onClick={exclude}>{busy === 'exclude' ? 'Re-testing…' : 'Apply and re-test'}</SectionMessageAction>]}
              >
                <Text>Explains {pct(c.exceptions.suggestion.share)} of the times the rule would act where people didn’t, and raises the learning-period score from {c.exceptions.suggestion.learnF1Before.toFixed(2)} to {c.exceptions.suggestion.learnF1After.toFixed(2)}. Uses only facts known when the trigger happens; the new version is tested once on the same untouched tickets.</Text>
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
                <div style={{ overflowX: 'auto', width: '100%' }}>
                  <DynamicTable
                    head={{ cells: [{ key: 'k', content: 'Item' }, { key: 't', content: 'Trigger' }, { key: 'a', content: 'Person acted' }, { key: 'w', content: 'Why' }] }}
                    rows={cases.map((x, i) => ({
                      key: `${x.key}-${i}`,
                      cells: [
                        { key: 'k', content: <NumberLink onClick={() => openCase(x)} label={`Open case ${x.key}`}>{x.key}</NumberLink> },
                        { key: 't', content: x.triggerTs ? when(x.triggerTs) : '—' },
                        { key: 'a', content: x.actionTs ? when(x.actionTs) : '—' },
                        { key: 'w', content: x.reason === 'no-trigger' ? 'No trigger before it' : x.clauses.map((cl, k) => ({ cl, k })).filter(({ cl }) => cl.value !== true).map(({ cl, k }) => `${c.clauseText?.[k] ?? cl.jql}: ${cl.value === false ? 'false' : 'unknown'}`).join('; ') || 'All conditions held' },
                      ],
                    }))}
                    rowsPerPage={20}
                    emptyView={<Muted>{t.empty}</Muted>}
                  />
                </div>
                {!!c.hiddenCases && <Muted>{c.hiddenCases} example items hidden: you don’t have permission to see them. The counts above include them.</Muted>}
                {c.casesTruncated && <Muted>Showing up to 50 example cases of each kind; the counts above include every case.</Muted>}
              </Stack>
            </TabPanel>
          ))}
        </Tabs>
      </Stack>

      {open && (
        <div ref={caseRef}>
          <Card>
            <Stack space="space.200">
              {(() => {
                const list = p.cases.filter((x) => x.outcome === open.outcome);
                const i = list.indexOf(open);
                return (
                  <Inline spread="space-between" alignBlock="center" shouldWrap>
                    <Heading size="small">{`Flight recorder · case ${i + 1} of ${list.length}`}</Heading>
                    <Inline space="space.100">
                      <Button appearance="subtle" isDisabled={i <= 0} onClick={() => setOpen(list[i - 1]!)}>Previous</Button>
                      <Button appearance="subtle" isDisabled={i < 0 || i >= list.length - 1} onClick={() => setOpen(list[i + 1]!)}>Next</Button>
                      <Button appearance="subtle" onClick={() => setOpen(null)}>Close</Button>
                    </Inline>
                  </Inline>
                );
              })()}
              <CaseView key={open.issueId + open.outcome + (open.triggerTs ?? open.actionTs)} c={open} detail={d} nm={nm} />
            </Stack>
          </Card>
        </div>
      )}


      <ModalTransition>
        {confirming && (
          <Modal onClose={() => setConfirming(false)}>
            <ModalHeader><ModalTitle>Send this rule to your admin?</ModalTitle></ModalHeader>
            <ModalBody>
              <Stack space="space.100">
                <Text>Creates a Jira work item “Automate: {c.sentence}” in {d.settings.adminProjectKey || 'this project'} with a review checklist, the evidence (automation passport) and the rule JSON to import.</Text>
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

    </Stack>
  );
}

interface Timeline { key: string; summary: string; events: { ts: number; kind: string; actor: string; field: string | null; from: string | null; to: string | null }[] }

/** What the rule decided and whether it agreed with people, per case outcome (step 3 and 4 of the flight recorder). */
const STORY: Record<Case['outcome'], { rule: string; people: string; verdict: string; appearance: 'success' | 'removed' | 'default' }> = {
  TP: { rule: 'Would act: every condition held.', people: 'A person did it by hand.', verdict: 'Agree', appearance: 'success' },
  FP: { rule: 'Would act: every condition held.', people: 'Nobody did it within the window.', verdict: 'Disagree: rule only', appearance: 'removed' },
  FN: { rule: 'Would not act.', people: 'A person did it by hand.', verdict: 'Disagree: people only', appearance: 'removed' },
  inconclusive: { rule: 'Can’t decide: a condition is unknown at that moment.', people: '', verdict: 'No verdict (lowers coverage)', appearance: 'default' },
};

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance="new">{`Step ${n}`}</Lozenge>
        <Heading size="xsmall">{title}</Heading>
      </Inline>
      {children}
    </Stack>
  );
}

function CaseView({ c, detail, nm }: { c: Case; detail: Detail; nm: (f: string, v: string | null) => string }) {
  const [tl, setTl] = useState<Timeline | null | 'hidden'>(null);
  const around = c.triggerTs ?? c.actionTs ?? 0;
  useEffect(() => { void call<Timeline | null>('timeline', { issueId: c.issueId, around }).then((t) => setTl(t ?? 'hidden')).catch(() => setTl('hidden')); }, [c.issueId, around]);
  const story = STORY[c.outcome];
  const actor = { human_agent: 'A person', customer: 'Customer', automation: 'Automation', app: 'An app' } as Record<string, string>;
  const trig = detail.chore.trigger;
  const triggerText = { created: 'The work item was created', customerCommented: 'A customer commented', statusTo: `Status changed to ${nm('status', trig.value ?? null)}`, fieldChanged: `${FIELD[trig.field ?? ''] ?? trig.field} changed` }[trig.type] ?? trig.type;
  // fields the rule looks at come first in the snapshot
  const used = new Set(Object.keys(c.snapshot).filter((f) => c.clauses.some((cl) => cl.jql.includes(f))));
  const rows = Object.entries(c.snapshot).filter(([f]) => f !== 'fixVersions').sort(([a], [b]) => Number(used.has(b)) - Number(used.has(a)));
  return (
    <Stack space="space.300">
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Heading size="medium">{c.key}</Heading>
        {detail.demo ? <Lozenge>Simulated item</Lozenge> : <Button appearance="subtle" onClick={() => router.open(`/browse/${c.key}`)}>Open in Jira (history tab)</Button>}
        <Lozenge appearance={story.appearance}>{story.verdict}</Lozenge>
      </Inline>

      <Step n={1} title="What happened">
        <Text>{c.triggerTs ? `${triggerText} · ${when(c.triggerTs)}` : 'The trigger never happened shortly before this, so the rule had no chance to act.'}</Text>
      </Step>

      <Step n={2} title="Facts at that moment">
        {c.clauses.map((cl, i) => (
          <Inline key={i} space="space.100" alignBlock="center">
            <Lozenge appearance={cl.value === true ? 'success' : cl.value === false ? 'removed' : 'default'}>{cl.value === true ? 'True' : cl.value === false ? 'False' : 'Unknown'}</Lozenge>
            <Text>{detail.chore.clauseText?.[i] ?? cl.jql}</Text>
          </Inline>
        ))}
        <DynamicTable
          head={{ cells: [{ key: 'f', content: 'Field' }, { key: 'v', content: 'Value' }] }}
          rows={rows.map(([f, v]) => ({ key: f, cells: [{ key: 'f', content: FIELD[f] ?? f }, { key: 'v', content: nm(f, v) }] }))}
        />
        <Muted>Only what was known {c.triggerTs ? 'when the trigger happened' : 'just before the person acted'}: later changes never count.</Muted>
      </Step>

      <Step n={3} title="The rule’s decision">
        <Text>{c.reason === 'no-trigger' ? 'Would not act: no trigger.' : story.rule}</Text>
        <Muted>Rule: {detail.chore.sentence}</Muted>
      </Step>

      <Step n={4} title="What people did">
        <Text>{c.actionTs ? `A person did it by hand · ${when(c.actionTs)}` : story.people || 'Not compared.'}</Text>
        <Inline><Lozenge appearance={story.appearance}>{story.verdict}</Lozenge></Inline>
      </Step>

      <Stack space="space.100">
        <Heading size="xsmall">Full history around it</Heading>
        {tl === null ? <Spinner size="small" label="Loading history" /> : tl === 'hidden' ? <Muted>History not available for this item.</Muted> : tl.events.map((e, i) => (
          <Text key={i}>
            {when(e.ts)} · {actor[e.actor] ?? e.actor}{' '}
            {e.kind === 'created' ? 'created it' : e.kind === 'comment' ? `commented (${e.field})` : `changed ${FIELD[e.field ?? ''] ?? e.field}: ${e.from ?? '—'} → ${e.to ?? '—'}`}
          </Text>
        ))}
        <Muted>People are never named here: Bruno only knows whether a person, a customer or automation acted.</Muted>
      </Stack>
    </Stack>
  );
}
