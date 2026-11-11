// Cross-platform helper for the matcher's virtual environment.
//   node run.js setup   creates .venv, installs requirements, creates .env from the example
//   node run.js dev     starts the matcher on :8000
//   node run.js test    runs pytest
const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const venvPython = path.join(here, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const systemPython = process.platform === 'win32' ? 'python' : 'python3';

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: here, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status);
}

function ensureSetup() {
  if (fs.existsSync(venvPython)) return;
  console.error('Matcher is not set up yet. Run: npm run setup:matcher');
  process.exit(1);
}

const command = process.argv[2];
if (command === 'setup') {
  if (!fs.existsSync(venvPython)) run(systemPython, ['-m', 'venv', '.venv']);
  run(venvPython, ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt']);
  const env = path.join(here, '.env');
  if (!fs.existsSync(env)) fs.copyFileSync(path.join(here, '.env.example'), env);
  console.log('Matcher is ready.');
} else if (command === 'test') {
  ensureSetup();
  run(venvPython, ['-m', 'pytest', '-q']);
} else if (command === 'dev') {
  ensureSetup();
  const child = spawn(venvPython, ['-m', 'uvicorn', 'app.main:app', '--port', '8000', '--reload', '--reload-dir', 'app'], {
    cwd: here,
    stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => child.kill());
  process.on('SIGTERM', () => child.kill());
} else {
  console.error('Usage: node run.js setup|dev|test');
  process.exit(1);
}
