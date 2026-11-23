import Button from '@atlaskit/button/new';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import { Inline, Stack, Text } from '@atlaskit/primitives';
import SectionMessage from '@atlaskit/section-message';
import Spinner from '@atlaskit/spinner';
import { rovo } from '@forge/bridge';
import { useEffect, useState } from 'react';
import { call, type Summary } from './api';
import { BrunoSays, Meter, Muted, num, pct } from './ui';

interface Nudge { chore: Summary; teammates: number; count: number }

/** Screen 5: in-ticket nudge, shown only to the person who just did a proven chore by hand. */
export function NudgePanel() {
  const [n, setN] = useState<Nudge | null | undefined>(undefined);
  const [proof, setProof] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { void call<Nudge | null>('nudge').then(setN).catch(() => setN(null)); }, []);
  if (n === undefined) return <Spinner size="small" label="Checking for chores" />;
  if (n === null) {
    return (
      <BrunoSays>
        <Text>Nothing to suggest here.</Text>
        <Muted>I only speak up right after you do something by hand that I’ve proven a rule for.</Muted>
      </BrunoSays>
    );
  }
  const c = n.chore;
  const answer = async (a: 'seen' | 'not-a-chore') => { await call('answerNudge', { choreId: c.id, answer: a }); setN(null); };
  const send = async () => {
    const r = await call<{ created: boolean; key?: string; reason?: string }>('sendToAdmin', { choreId: c.id, confirm: true });
    setConfirming(false);
    setMsg(r.created ? `Sent to your admin: ${r.key}` : (r.reason ?? 'Not sent.'));
  };
  const who = n.teammates > 0 ? `You and ${n.teammates} teammate${n.teammates === 1 ? '' : 's'}` : 'You';

  return (
    <Stack space="space.150">
      <BrunoSays>
        <Text weight="bold">Psst, I can take this one.</Text>
        <Text>{who} did this {num(n.count)} times by hand: <strong>{c.sentence}</strong>.</Text>
        <Text>On tickets I never learned from, the rule agreed with your team {num(c.matches)} of {num(c.fires)} times ({pct(c.precision)}).</Text>
      </BrunoSays>
      <Meter part={c.matches} whole={c.fires} label={`Agreed ${c.matches} of ${c.fires} times`} />
      {msg && <SectionMessage appearance="information">{msg}</SectionMessage>}
      <Inline space="space.100" shouldWrap>
        <Button onClick={() => setProof((x) => !x)} aria-expanded={proof}>{proof ? 'Hide proof' : 'Open proof'}</Button>
        <Button appearance="primary" onClick={() => setConfirming(true)} isDisabled={c.verdict !== 'proven'}>Send to admin</Button>
        <Button appearance="subtle" onClick={() => answer('not-a-chore')}>Not a chore</Button>
      </Inline>
      {proof && (
        <Stack space="space.050">
          <Text>Matches the team: {c.matches} · Rule would act where people didn’t: {c.fires - c.matches} · Differences in total: {c.differences}</Text>
          <Muted>Recall {pct(c.recall)} · coverage {pct(c.coverage)}. Full proof and every case: project sidebar → Autopilot.</Muted>
        </Stack>
      )}
      <Button appearance="subtle" spacing="compact" onClick={() => rovo.open({ type: 'forge', agentKey: 'wind-tunnel-agent', agentName: 'Bruno', prompt: `Prove the chore ${c.ref}` }).catch(() => setMsg('Rovo isn’t available on this site.'))}>
        Ask Bruno
      </Button>
      <ModalTransition>
        {confirming && (
          <Modal onClose={() => setConfirming(false)}>
            <ModalHeader><ModalTitle>Send this rule to your admin?</ModalTitle></ModalHeader>
            <ModalBody><Text>Creates a work item with the proof and the rule JSON. The imported rule arrives disabled.</Text></ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button appearance="primary" onClick={send}>Create hand-off</Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </Stack>
  );
}
