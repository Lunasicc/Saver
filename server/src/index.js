import './env.js';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import accountsRouter from './routes/accounts.js';
import categoriesRouter from './routes/categories.js';
import transactionsRouter from './routes/transactions.js';
import budgetsRouter from './routes/budgets.js';
import recurringBillsRouter from './routes/recurringBills.js';
import reportsRouter from './routes/reports.js';
import akahuRouter from './routes/akahu.js';
import merchantRulesRouter from './routes/merchantRules.js';

const PORT = Number(process.env.PORT) || 4000;
const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');

// The Vite dev server and the built app (served by this server) run on localhost.
// Allowing an arbitrary origin would let any website you happen to have open read
// (or delete) your real financial data via the local API, so the allow-list is explicit.
const ALLOWED_ORIGINS = new Set(
  (
    process.env.ALLOWED_ORIGINS ||
    `http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://localhost:${PORT},http://127.0.0.1:${PORT}`
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
);

// Blocks DNS-rebinding: a malicious site pointing its own hostname at 127.0.0.1
// would pass the origin check for same-origin GETs, but not this Host check.
const ALLOWED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  ...(process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
]);

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const hostname = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    if (!ALLOWED_HOSTNAMES.has(hostname)) return res.status(403).json({ error: 'Forbidden host' });
    return next();
  });
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/non-browser callers (curl, the Vite proxy) send no Origin header.
        if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
        const err = new Error(`Origin ${origin} is not allowed`);
        err.status = 403;
        return callback(err);
      },
    })
  );
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/accounts', accountsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/budgets', budgetsRouter);
  app.use('/api/recurring-bills', recurringBillsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/akahu', akahuRouter);
  app.use('/api/merchant-rules', merchantRulesRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built UI (npm start) so the whole app runs on a single port.
  if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    app.use(express.static(CLIENT_DIST, { index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  }

  // Malformed JSON bodies should be a 400, not an unhandled 500.
  app.use((err, _req, res, next) => {
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'Request body is not valid JSON' });
    }
    return next(err);
  });

  // Centralized error handler
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const app = createApp();
  // Bind to loopback only: this API is unauthenticated and holds real bank data,
  // so it must never be reachable from other devices on the network.
  const HOST = process.env.HOST || '127.0.0.1';
  const server = app.listen(PORT, HOST, () => {
    const url = `http://localhost:${PORT}`;
    const hasUi = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));
    console.log(`\n  Saver is running at ${url}${hasUi ? '' : ' (API only; run `npm run build` for the UI)'}`);
    console.log('  Press Ctrl+C to stop.\n');
    if (process.env.OPEN_BROWSER === '1' && hasUi) openBrowser(url);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} is already in use. Saver may already be running at http://localhost:${PORT}.`);
      console.error('  Close the other copy, or set a different PORT in server/.env.\n');
      process.exit(1);
    }
    throw err;
  });
}

function openBrowser(url) {
  const command =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, () => {});
}
