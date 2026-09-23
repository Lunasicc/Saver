// Render smoke test: loads every page and tab in a real browser (Edge or Chrome) and
// fails on any console error, page error, or failed network request. Also checks the
// legacy URLs redirect to their new homes. Requires both dev servers to be running.
// Run with: npm run smoke --workspace=client
// Pass --shots to also save desktop + mobile screenshots to client/scripts/shots/.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173';
const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = fileURLToPath(new URL('./shots/', import.meta.url));

const PAGES = [
  ['Overview', '/'],
  ['Overview (Aug)', '/?month=2026-08'],
  ['Transactions', '/transactions'],
  ['Tx uncategorized', '/transactions?category=uncategorized'],
  ['Tx import', '/transactions?tab=import'],
  ['Tx rules', '/transactions?tab=rules'],
  ['Planning budgets', '/plan'],
  ['Planning bills', '/plan?tab=bills'],
  ['Planning subs', '/plan?tab=subscriptions'],
  ['Accounts', '/accounts'],
];

const REDIRECTS = [
  ['/snapshot', '/'],
  ['/trends', '/'],
  ['/import', '/transactions?tab=import'],
  ['/rules', '/transactions?tab=rules'],
  ['/budgets', '/plan'],
  ['/recurring', '/plan?tab=bills'],
  ['/subscriptions', '/plan?tab=subscriptions'],
];

const channels = ['msedge', 'chrome'];
let browser;
for (const channel of channels) {
  try {
    browser = await chromium.launch({ channel, headless: true });
    console.log(`launched via ${channel}`);
    break;
  } catch {
    /* try next */
  }
}
if (!browser) {
  console.log('SKIP: no Edge/Chrome available');
  process.exit(0);
}

let failures = 0;
const report = (ok, label, details = []) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${details.length ? `\n      ${details.join('\n      ')}` : ''}`);
};

const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
if (SHOTS) await mkdir(SHOT_DIR, { recursive: true });

function watch() {
  const problems = [];
  const onConsole = (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  };
  const onPageError = (err) => problems.push(`pageerror: ${err.message}`);
  const onResponse = (res) => {
    if (res.status() >= 400) problems.push(`http ${res.status()} ${res.url()}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  return () => {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    return problems;
  };
}

for (const [name, path] of PAGES) {
  const stop = watch();
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const heading = await page.locator('h1').first().textContent().catch(() => null);
  const bodyText = (await page.locator('body').innerText()).trim();
  const problems = stop();
  const empty = bodyText.length < 40;
  report(problems.length === 0 && Boolean(heading) && !empty, `${name.padEnd(18)} h1="${(heading || '(none)').slice(0, 40)}"`, [
    ...problems.slice(0, 4),
    ...(empty ? ['page rendered almost no content'] : []),
  ]);
  if (SHOTS) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await page.screenshot({ path: `${SHOT_DIR}${slug}-desktop.png`, fullPage: true });
  }
}

for (const [from, to] of REDIRECTS) {
  await page.goto(`${BASE}${from}`, { waitUntil: 'networkidle' });
  await page.waitForURL((u) => `${u.pathname}${u.search}` === to, { timeout: 3000 }).catch(() => {});
  const url = new URL(page.url());
  const landed = `${url.pathname}${url.search}`;
  report(landed === to, `redirect ${from.padEnd(15)} -> ${landed}`, landed === to ? [] : [`expected ${to}`]);
}

// Exercise the interactive flows end to end (read-only: nothing is applied).
async function clickFlow(name, path, buttonText, expectText, role = 'button') {
  const stop = watch();
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.getByRole(role, { name: buttonText }).first().click();
  await page.waitForTimeout(1500);
  const text = await page.locator('body').innerText();
  const problems = stop();
  const found = text.includes(expectText);
  report(problems.length === 0 && found, name, [...problems, ...(found ? [] : [`expected to find "${expectText}"`])]);
}

await clickFlow('Budget suggestions flow', '/plan', /Suggest/, 'Suggested budgets for');
await clickFlow('Recurring detection flow', '/plan?tab=bills', /Find recurring charges/, 'recurring charge');
await clickFlow('Tab switching', '/transactions', /^Rules$/, 'Categorization rules', 'tab');

// Month stepper on Overview updates the URL.
{
  const stop = watch();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.waitForTimeout(800);
  const problems = stop();
  const hasMonth = new URL(page.url()).searchParams.has('month');
  report(problems.length === 0 && hasMonth, 'Overview month stepper', [...problems, ...(hasMonth ? [] : ['URL has no ?month='])]);
}

if (SHOTS) {
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  for (const [name, path] of PAGES.filter(([n]) => !n.includes('('))) {
    await mobile.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await mobile.waitForTimeout(700);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await mobile.screenshot({ path: `${SHOT_DIR}${slug}-mobile.png`, fullPage: true });
  }
  console.log(`screenshots saved to ${SHOT_DIR}`);
}

await browser.close();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
