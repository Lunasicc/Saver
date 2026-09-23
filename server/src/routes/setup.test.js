// Isolated in-memory DB and no real Akahu tokens, set before any app module loads.
process.env.BUDGET_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.AKAHU_APP_TOKEN = '';
process.env.AKAHU_USER_TOKEN = '';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createApp } = await import('../index.js');
const app = createApp();

async function withServer(fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  try {
    await fn(`http://localhost:${port}/api`, port);
  } finally {
    server.close();
  }
}

const realFetch = globalThis.fetch;
function send(base, method, pathname, body) {
  return realFetch(`${base}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Stubs only outbound Akahu calls; local API calls go through untouched. */
function mockAkahu(handler) {
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith('https://api.akahu.io/')) return handler(href, init);
    return realFetch(url, init);
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}

test('requests with a foreign Host header are rejected (DNS rebinding guard)', async () => {
  await withServer(async (_base, port) => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/health', headers: { Host: 'evil.example:80' } },
        (res) => resolve(res.statusCode)
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
    assert.equal((await realFetch(`http://localhost:${port}/api/health`)).status, 200);
  });
});

test('requests from a foreign Origin are rejected', async () => {
  await withServer(async (base) => {
    const res = await realFetch(`${base}/accounts`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
  });
});

test('Akahu starts disconnected and rejects malformed tokens', async () => {
  await withServer(async (base) => {
    const status = await realFetch(`${base}/akahu/status`).then((r) => r.json());
    assert.equal(status.configured, false);
    assert.equal(status.source, null);
    assert.equal(status.autoSync, true);

    const bad = await send(base, 'PUT', '/akahu/credentials', { appToken: 'nope', userToken: 'user_token_abc' });
    assert.equal(bad.status, 400);

    const sync = await send(base, 'POST', '/akahu/sync', { months: 3 });
    assert.equal(sync.status, 400);
  });
});

test('Akahu tokens are verified, saved without being echoed back, and can be removed', async () => {
  const seen = [];
  const restore = mockAkahu(async (href, init) => {
    seen.push({ href, headers: init?.headers });
    return new Response(JSON.stringify({ success: true, items: [{ _id: 'acc_1' }, { _id: 'acc_2' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  try {
    await withServer(async (base) => {
      const res = await send(base, 'PUT', '/akahu/credentials', {
        appToken: 'app_token_test123',
        userToken: 'user_token_test456',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.configured, true);
      assert.equal(body.source, 'app');
      assert.equal(body.accounts, 2);
      assert.ok(!JSON.stringify(body).includes('test456'), 'token must not be echoed');
      assert.equal(seen[0].headers['X-Akahu-Id'], 'app_token_test123');

      const status = await realFetch(`${base}/akahu/status`).then((r) => r.json());
      assert.equal(status.configured, true);
      assert.equal(status.source, 'app');

      const cleared = await send(base, 'DELETE', '/akahu/credentials').then((r) => r.json());
      assert.equal(cleared.configured, false);
      assert.equal(cleared.source, null);
    });
  } finally {
    restore();
  }
});

test('Akahu tokens rejected by Akahu are not saved', async () => {
  const restore = mockAkahu(async () => new Response('{"success":false}', { status: 401 }));
  try {
    await withServer(async (base) => {
      const res = await send(base, 'PUT', '/akahu/credentials', {
        appToken: 'app_token_wrong',
        userToken: 'user_token_wrong',
      });
      assert.equal(res.status, 401);
      assert.match((await res.json()).error, /rejected/);
      const status = await realFetch(`${base}/akahu/status`).then((r) => r.json());
      assert.equal(status.configured, false);
    });
  } finally {
    restore();
  }
});

test('custom rules file is normalized, validated and takes priority over defaults', async () => {
  const { loadCustomRules, getSeedRules } = await import('../lib/seedRules.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saver-rules-'));
  const file = path.join(dir, 'custom-rules.json');
  fs.writeFileSync(
    file,
    JSON.stringify([
      { pattern: 'Local Gym Ltd', merchant: 'Local Gym', category: 'Health' },
      { pattern: 'briscoes', merchant: 'Briscoes Homeware', category: 'Shopping' },
      { pattern: '', merchant: 'Invalid', category: 'Other' },
    ])
  );
  process.env.CUSTOM_RULES_PATH = file;
  try {
    const rules = loadCustomRules();
    assert.deepEqual(rules[0], { pattern: 'localgymltd', merchant: 'Local Gym', category: 'Health' });
    assert.equal(rules.length, 2, 'rules without a pattern are dropped');
    const firstBriscoes = getSeedRules().find((r) => r.pattern === 'briscoes');
    assert.equal(firstBriscoes.merchant, 'Briscoes Homeware');

    fs.writeFileSync(file, '{ not json');
    assert.deepEqual(loadCustomRules(), [], 'a broken file is ignored rather than crashing startup');
  } finally {
    delete process.env.CUSTOM_RULES_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
