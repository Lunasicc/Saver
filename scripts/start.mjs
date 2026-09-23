// One-command launcher: bundles the UI, then starts the server (which serves it)
// and opens the browser. Used by `npm start` and the Start scripts.
import { spawnSync } from 'node:child_process';

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`Saver needs Node.js 22 or newer (you have ${process.versions.node}). Get it from https://nodejs.org`);
  process.exit(1);
}

console.log('Building the app...');
const build = spawnSync('npm run bundle --workspace=client --silent', { stdio: 'inherit', shell: true });
if (build.status !== 0) {
  console.error('Building the UI failed. Try running `npm install` first.');
  process.exit(build.status ?? 1);
}

process.env.OPEN_BROWSER ??= '1';
await import('../server/src/index.js');
