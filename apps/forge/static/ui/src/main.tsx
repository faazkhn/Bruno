import '@atlaskit/css-reset';
import { view } from '@forge/bridge';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Jira's light/dark theme via ADS tokens
void view.theme.enable();
createRoot(document.getElementById('root')!).render(<App />);
