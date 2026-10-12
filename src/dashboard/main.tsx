import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/theme.css';
import { connectPageSync } from '../ui/account';
import { AuthGate } from '../ui/AuthGate';
import { applySavedTheme } from '../ui/themePreference';
import './dashboard.css';
import { Dashboard } from './Dashboard';

applySavedTheme();
connectPageSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <Dashboard />
    </AuthGate>
  </StrictMode>,
);
