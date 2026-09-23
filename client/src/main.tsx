import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/theme.css';
import './index.css';
import App from './App.tsx';
import { Overview } from './pages/Overview.tsx';
import { TransactionsHub } from './pages/TransactionsHub.tsx';
import { Planning } from './pages/Planning.tsx';
import { Accounts } from './pages/Accounts.tsx';
import { APP_NAME } from './lib/brand.ts';

document.title = APP_NAME;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Overview />} />
          <Route path="transactions" element={<TransactionsHub />} />
          <Route path="plan" element={<Planning />} />
          <Route path="accounts" element={<Accounts />} />
        </Route>

        {/* Legacy routes from the old 10-page layout, so bookmarks keep working. */}
        <Route path="/snapshot" element={<Navigate to="/" replace />} />
        <Route path="/trends" element={<Navigate to="/" replace />} />
        <Route path="/import" element={<Navigate to="/transactions?tab=import" replace />} />
        <Route path="/rules" element={<Navigate to="/transactions?tab=rules" replace />} />
        <Route path="/budgets" element={<Navigate to="/plan" replace />} />
        <Route path="/recurring" element={<Navigate to="/plan?tab=bills" replace />} />
        <Route path="/subscriptions" element={<Navigate to="/plan?tab=subscriptions" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
