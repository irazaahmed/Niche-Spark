import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/theme.css';
import { connectPageSync } from '../ui/account';
import { AuthGate } from '../ui/AuthGate';
import { applySavedTheme } from '../ui/themePreference';
import './popup.css';
import { Popup } from './Popup';

applySavedTheme();
connectPageSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate compact>
      <Popup />
    </AuthGate>
  </StrictMode>,
);
