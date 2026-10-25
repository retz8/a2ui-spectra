import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './index.css';

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import {App} from './App.tsx';
import {applyTheme} from './state/theme.ts';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('The page has no #root element.');
}

applyTheme();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
