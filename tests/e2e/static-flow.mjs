// Browser check of the static app (docs/). Opens docs/index.html straight from disk (file://), with no server,
// drives headless Edge or Chrome over the DevTools protocol, and checks the live adjustment controls.
// Not part of `npm test` because it needs an installed browser. Run with: npm run e2e

import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const indexUrl = pathToFileURL(path.join(root, 'docs', 'index.html')).href;
const DEBUG_PORT = 9334;
const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectToPage(browserProcess) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (browserProcess.exitCode !== null) {
      throw new Error('browser exited before the debugging port was ready');
    }
    try {
      const pages = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = pages.find((target) => target.type === 'page');
      if (page) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error('timed out waiting for the browser debugging port');
}

function openDevTools(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    const listeners = [];
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve: done, reject: fail } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          fail(new Error(message.error.message));
        } else {
          done(message.result);
        }
      } else if (message.method) {
        for (const listener of listeners) {
          listener(message);
        }
      }
    };
    socket.onerror = reject;
    socket.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((done, fail) => {
            nextId += 1;
            pending.set(nextId, { resolve: done, reject: fail });
            socket.send(JSON.stringify({ id: nextId, method, params }));
          });
        },
        on(listener) {
          listeners.push(listener);
        },
        close() {
          socket.close();
        },
      });
  });
}

async function main() {
  const browserPath = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!browserPath) {
    console.log('SKIPPED: no Chromium-based browser found (Edge or Chrome).');
    return 0;
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lvst-static-e2e-'));
  const profileDir = path.join(tempRoot, 'profile');
  const errors = [];
  let browser;
  let devtools;

  try {
    browser = spawn(
      browserPath,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-sandbox',
        '--allow-file-access-from-files',
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--window-size=1280,800',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );

    devtools = await openDevTools(await connectToPage(browser));
    devtools.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        errors.push(message.params.exceptionDetails.exception?.description ?? 'exception');
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
      }
    });
    await devtools.send('Page.enable');
    await devtools.send('Runtime.enable');

    const evaluate = async (expression) => {
      const result = await devtools.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
      }
      return result.result.value;
    };
    const waitFor = async (expression, label, timeoutMs = 8000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (await evaluate(expression)) {
          return;
        }
        await sleep(100);
      }
      throw new Error(`timed out waiting for: ${label}`);
    };
    const key = (k) => evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}' }))`);
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const step = (label) => console.log(`  ok  ${label}`);

    // Start from empty storage so the run is repeatable.
    await devtools.send('Page.navigate', { url: indexUrl });
    await waitFor(`!!document.querySelector('[data-action="new-person"]')`, 'home screen');
    await evaluate(`localStorage.clear()`);
    await devtools.send('Page.navigate', { url: indexUrl });
    await waitFor(`!!document.querySelector('[data-action="new-person"]')`, 'home screen after reset');
    step('static app opens from file:// with no server');

    await click('[data-action="new-person"]');
    await waitFor(`!!document.querySelector('#person-form')`, 'new person form');
    await evaluate(`
      document.querySelector('[name=name]').value = 'Fake Static Person';
      document.querySelector('[name=age]').value = '66';
      document.querySelector('[name=visionLevel]').value = 'Fake vision level';
      document.querySelector('[data-action="save-person"]').click();
    `);
    await waitFor(`!!document.querySelector('[data-action="setup"]')`, 'person detail after save');
    const stored = await evaluate(`JSON.parse(localStorage.getItem('lowVisionShapeTest.records.v1')).people.length`);
    assert.equal(stored, 1);
    step('new person is saved in browser storage');

    await click('[data-action="setup"]');
    await waitFor(`!!document.querySelector('.setup')`, 'setup screen');
    await evaluate(`document.querySelector('[data-action="set"][data-key="mode"][data-value="fixed"]').click()`);
    await click('[data-action="start-test"]');
    await waitFor(`document.getElementById('hud-status')?.textContent.includes('Trial 1')`, 'first trial');
    step('fixed-size test starts from the setup screen');

    await key('1');
    await waitFor(`document.getElementById('hud-message').textContent.includes('Recorded')`, 'recorded message');
    await waitFor(`document.getElementById('hud-message').textContent.includes('Waiting for the answer')`, 'second trial');
    step('answering a trial records it and shows the next one');

    // Live adjustments while the test runs.
    await key('a');
    await waitFor(`!document.getElementById('adjust').hidden`, 'adjust panel visible');
    step('A opens the Adjust panel');
    await sleep(300);
    const shot = await devtools.send('Page.captureScreenshot', { format: 'png' });
    const shotPath = path.join(os.tmpdir(), 'lvst-static-adjust.png');
    await fs.writeFile(shotPath, Buffer.from(shot.data, 'base64'));
    console.log(`  info adjust panel screenshot: ${shotPath}`);

    const sizeBefore = await evaluate(`document.getElementById('hud-status').textContent`);
    await key('b');
    const sizeAfter = await evaluate(`document.getElementById('hud-status').textContent`);
    assert.notEqual(sizeBefore, sizeAfter);
    step('bigger changes the size of the shape on screen');

    await evaluate(`document.querySelector('[data-action="live-set"][data-key="color"][data-value="red"]').click()`);
    const colourSelected = await evaluate(`document.querySelector('[data-action="live-set"][data-key="color"][data-value="red"]').getAttribute('aria-pressed')`);
    assert.equal(colourSelected, 'true');
    const savedColour = await evaluate(`JSON.parse(localStorage.getItem('lowVisionShapeTest.settings')).color`);
    assert.equal(savedColour, 'red');
    step('changing colour in the Adjust panel applies and is remembered');

    await evaluate(`
      const slider = document.querySelector('#adjust input[type=range]');
      slider.value = '400';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await waitFor(`document.getElementById('live-speed').textContent.startsWith('400 px/s')`, 'speed label');
    step('speed slider changes the speed live');

    await evaluate(`document.querySelector('[data-action="live-toggle-shape"][data-value="heart"]').click()`);
    const heartOn = await evaluate(`document.querySelector('[data-action="live-toggle-shape"][data-value="heart"]').getAttribute('aria-pressed')`);
    assert.equal(heartOn, 'false', 'heart was on by default, so toggling turns it off');
    step('toggling a shape in the Adjust panel updates the selection');

    await key('a');
    await waitFor(`document.getElementById('adjust').hidden`, 'adjust panel hidden');
    await key('0');
    await sleep(900);
    await key('Escape');
    await waitFor(`!!document.querySelector('[data-action="save-session"]')`, 'results screen');
    step('Escape ends the test and shows results');

    await click('[data-action="save-session"]');
    await waitFor(`!!document.querySelector('.facts')`, 'person screen after save');
    const sessions = await evaluate(`JSON.parse(localStorage.getItem('lowVisionShapeTest.records.v1')).people[0].sessions.length`);
    assert.equal(sessions, 1);
    step('saved session is stored locally');

    assert.deepEqual(errors, [], `browser reported errors: ${errors.join(' | ')}`);
    step('no JavaScript errors in the browser console');
    return 0;
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    if (errors.length) {
      console.error(`Browser errors: ${errors.join(' | ')}`);
    }
    return 1;
  } finally {
    devtools?.close();
    browser?.kill();
    await sleep(500);
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

process.exitCode = await main();
