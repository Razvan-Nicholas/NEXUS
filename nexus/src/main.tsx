import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';

// Fonts are bundled locally by default; `npm run build:remote-fonts` links the same families from Google Fonts.
if (import.meta.env.MODE !== 'remote-fonts') void import('./fonts');

createRoot(document.getElementById('root')!).render(<App />);
