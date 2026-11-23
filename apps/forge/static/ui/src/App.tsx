import { Box, xcss } from '@atlaskit/primitives';
import Spinner from '@atlaskit/spinner';
import { view } from '@forge/bridge';
import { useEffect, useState } from 'react';
import { Admin } from './Admin';
import { ChoreDetail } from './ChoreDetail';
import { ChoreList } from './ChoreList';
import { Home } from './Home';
import { NudgePanel } from './Nudge';

const page = xcss({ padding: 'space.300', maxWidth: '1200px', marginInline: 'auto' });
const panel = xcss({ padding: 'space.100' });

/** One Custom UI bundle, routed by the Forge module it is rendered in. */
export function App() {
  const [moduleKey, setModuleKey] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; tab?: string } | null>(null);
  useEffect(() => { void view.getContext().then((c) => setModuleKey(c.moduleKey)); }, []);
  if (!moduleKey) return <Spinner label="Loading" />;
  if (moduleKey === 'chore-nudge') return <Box xcss={panel}><NudgePanel /></Box>;
  if (moduleKey === 'autopilot-admin') return <Box xcss={page}><Admin /></Box>;
  if (moduleKey === 'bruno-home') {
    return <Box xcss={page} as="main">{open ? <ChoreDetail choreId={open.id} initialTab={open.tab} onBack={() => setOpen(null)} /> : <Home onOpen={(id, tab) => setOpen({ id, tab })} />}</Box>;
  }
  return (
    <Box xcss={page} as="main">
      {open ? <ChoreDetail choreId={open.id} initialTab={open.tab} onBack={() => setOpen(null)} /> : <ChoreList onOpen={(id, tab) => setOpen({ id, tab })} />}
    </Box>
  );
}
