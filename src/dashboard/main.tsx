import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/theme.css';
import { connectPageSync } from '../ui/account';
import { AuthGate } from '../ui/AuthGate';
import './dashboard.css';
import { Dashboard } from './Dashboard';

connectPageSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <Dashboard />
    </AuthGate>
  </StrictMode>,
);
