/**
 * Loads every story and reports the ones that fail to render.
 *
 * `pnpm run smoke`     — builds nothing, serves the existing `dist`.
 * `pnpm run smoke:dev` — boots `storybook dev` instead. Dev and production use
 *   different Vite pipelines (defines, dep pre-bundling), so a story can render
 *   in one and crash in the other; both modes are worth checking.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DEV_MODE = process.argv.includes('--dev');
const DEV_PORT = 6007;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

async function serveDist() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const filePath = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const origin = `http://localhost:${port}`;
  return {
    origin,
    index: JSON.parse(await readFile(path.join(DIST, 'index.json'), 'utf8')),
    stop: () => server.close(),
  };
}

async function startDevServer() {
  const child = spawn(
    'storybook',
    ['dev', '-p', String(DEV_PORT), '--no-open', '--quiet', '--ci'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
  );
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));

  const origin = `http://localhost:${DEV_PORT}`;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`storybook dev exited early:\n${log}`);
    try {
      const response = await fetch(`${origin}/index.json`);
      if (response.ok) {
        return { origin, index: await response.json(), stop: () => child.kill() };
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  child.kill();
  throw new Error(`storybook dev did not become ready:\n${log}`);
}

// `script tag` — next-themes' ThemeProvider always renders its FOUC-prevention
// script. React never executes it on the client and the provider sets the theme
// class via an effect, so the markup is inert; React only warns in dev builds.
const IGNORED_ERROR =
  /ResizeObserver loop|Failed to load resource|Download the React DevTools|Encountered a script tag while rendering/;

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * True when the story painted something a user could actually see. The preview
 * decorators always add chrome (next-themes' inert script, the sonner toaster),
 * so a non-empty root is not proof the story itself rendered. Scans the whole
 * body because dialogs and sheets render through a portal, outside the root.
 */
function hasVisibleContent() {
  const CHROME = 'script, style, .sb-preview-toaster, #storybook-docs, .sb-preparing-story';
  const scopes = [document.querySelector('#storybook-root'), ...document.body.children].filter(
    (node) => node && !(node instanceof HTMLScriptElement) && !(node instanceof HTMLStyleElement),
  );

  for (const scope of scopes) {
    for (const node of [scope, ...scope.querySelectorAll('*')]) {
      if (node.matches(CHROME) || node.closest(CHROME)) continue;
      if (node.id === 'storybook-root') continue;
      // A painted element has a non-zero area. Thin elements such as a 1px
      // Separator are legitimately visible, so don't require a minimum size.
      // `aria-hidden` is deliberately *not* treated as hidden: decorative but
      // perfectly visible markup (lucide icons, gradients, monograms) sets it.
      const box = node.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.opacity === '0') continue;
      return true;
    }
    // Text rendered directly into a scope has no element box of its own.
    const ownText = [...scope.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    );
    if (ownText) return true;
  }
  return false;
}

/**
 * Vite aborts in-flight navigations when it discovers a new dependency and
 * re-optimizes, which happens on the first loads against a cold dev cache.
 * The reload is expected, so retry rather than failing the run.
 */
async function gotoStory(page, url) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'load' });
      return;
    } catch (error) {
      if (attempt >= 2 || !/ERR_ABORTED/.test(error.message)) throw error;
      await page.waitForTimeout(1000);
    }
  }
}

async function checkStory(page, origin, id) {
  const errors = [];
  const onConsole = (msg) => {
    if (msg.type() === 'error' && !IGNORED_ERROR.test(msg.text())) errors.push(msg.text());
  };
  const onError = (err) => errors.push(err.message);
  page.on('console', onConsole);
  page.on('pageerror', onError);

  await gotoStory(page, `${origin}/iframe.html?id=${id}&viewMode=story`);
  // Stories that fetch through MSW need a tick or two before their first
  // paint; only treat a blank story as a failure after waiting.
  await page
    .waitForFunction(hasVisibleContent, null, { timeout: DEV_MODE ? 10000 : 3000 })
    .catch(() => {});

  const crashed = await page.evaluate(() => {
    const display = document.querySelector('#error-display, .sb-show-errordisplay');
    return Boolean(display) && getComputedStyle(display).display !== 'none';
  });
  let blank = !(await page.evaluate(hasVisibleContent));
  // Mobile-only affordances (`md:hidden`) are correctly invisible at desktop
  // width, so a story only counts as blank when it renders at no viewport.
  if (blank) {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.waitForFunction(hasVisibleContent, null, { timeout: 2000 }).catch(() => {});
    blank = !(await page.evaluate(hasVisibleContent));
    await page.setViewportSize(DESKTOP_VIEWPORT);
  }

  page.off('console', onConsole);
  page.off('pageerror', onError);

  if (!crashed && !blank && errors.length === 0) return null;
  return { id, errors: [...new Set(errors)].slice(0, 2), blank: blank && errors.length === 0 && !crashed };
}

async function main() {
  const target = DEV_MODE ? await startDevServer() : await serveDist();
  const { origin, index } = target;
  const storyIds = Object.values(index.entries)
    .filter((entry) => entry.type === 'story')
    .map((entry) => entry.id);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: DESKTOP_VIEWPORT });
  const failures = [];

  for (const id of storyIds) {
    // A request still in flight when the previous story unmounts can surface as
    // a spurious error, so confirm on a clean load before failing the run.
    const failure = (await checkStory(page, origin, id)) && (await checkStory(page, origin, id));
    if (failure) failures.push(failure);
  }

  await browser.close();
  target.stop();

  const label = DEV_MODE ? 'dev' : 'production';
  console.log(`\nChecked ${storyIds.length} stories (${label}) — ${failures.length} with errors.`);
  for (const failure of failures) {
    console.log(`\n✗ ${failure.id}${failure.blank ? '  (rendered nothing visible)' : ''}`);
    for (const error of failure.errors) console.log(`    ${error.split('\n')[0].slice(0, 200)}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
