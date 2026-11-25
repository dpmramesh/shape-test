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
      const notice = await evaluate(`document.getElementById('notice').textContent`);
      const hud = await evaluate(`document.getElementById('hud-message')?.textContent ?? ''`);
      const status = await evaluate(`document.getElementById('hud-status')?.textContent ?? ''`);
      const said = [notice, hud, status].filter(Boolean).join(' | ');
      throw new Error(`timed out waiting for: ${label}${said ? ` (screen says: ${said})` : ''}`);
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
    // Setup checks that the shapes fit before anything is drawn. Step down the size until the check is clear.
    let flaggedAtStart = false;
    let chosenDeg = null;
    for (const deg of ['5', '4', '3', '2.5', '2', '1.5', '1.25', '1']) {
      await evaluate(`(() => {
        const select = document.querySelector('[data-input="fixedSizeDeg"]');
        select.value = '${deg}';
        select.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const flag = await evaluate(`document.getElementById('fit-status').textContent`);
      if (deg === '5') {
        flaggedAtStart = Boolean(flag);
      }
      if (!flag) {
        chosenDeg = deg;
        break;
      }
    }
    assert.ok(chosenDeg, 'at least one size fits the screen');
    step(flaggedAtStart ? `setup flags 5° as overlapping, and ${chosenDeg}° fits` : `${chosenDeg}° is the starting size`);

    // A trial whose shapes would overlap is held back. Press S for a smaller size until it can be drawn.
    const showTrial = async (label) => {
      // Wait for the next trial to be set up (drawn or held) before deciding whether to press S.
      await waitFor(
        `['Waiting for the answer', 'cannot fit'].some((text) => document.getElementById('hud-message').textContent.includes(text))`,
        `${label}: trial set up`,
      );
      let presses = 0;
      while (presses < 8 && (await evaluate(`document.getElementById('hud-message').textContent.includes('cannot fit')`))) {
        await key('s');
        presses += 1;
        await sleep(200);
      }
      await waitFor(`document.getElementById('hud-message').textContent.includes('Waiting for the answer')`, label);
      return presses;
    };

    await click('[data-action="start-test"]');
    await waitFor(`document.getElementById('hud-status')?.textContent.includes('Trial 1')`, 'first trial');
    await showTrial('first trial shown');
    step('fixed-size test starts from the setup screen');

    // Number keys count a shape; R records the answer.
    await key('1');
    await key('r');
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
    const refused = await evaluate(`document.getElementById('hud-message').textContent.includes('cannot fit')`);
    // The trial is on screen, so bigger is refused exactly when the next size would overlap, and then the size stays put.
    assert.equal(sizeBefore !== sizeAfter, !refused, 'bigger changes the size exactly when it is not refused');
    if (refused) {
      assert.equal(sizeBefore, sizeAfter, 'a refused bigger leaves the size unchanged');
    }
    step(refused ? 'bigger is refused, and the size stays put, when the shapes would overlap' : 'bigger changes the size of the shape on screen');

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
    assert.equal(heartOn, 'true', 'heart is off by default, so toggling turns it on');
    step('toggling a shape in the Adjust panel updates the selection');

    await evaluate(`
      const count = document.querySelector('#adjust select[data-input="count"]');
      count.value = '2';
      count.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    const savedCount = await evaluate(`JSON.parse(localStorage.getItem('lowVisionShapeTest.settings')).count`);
    assert.equal(savedCount, 2);
    step('changing the count of each shape in the Adjust panel is remembered');

    await key('a');
    await waitFor(`document.getElementById('adjust').hidden`, 'adjust panel hidden');
    await key('0');
    // The count of 2 applies to this trial: two circles and two hearts, 4 shapes. The test checks the stage first.
    const presses = await showTrial('third trial');
    step(presses ? `4 shapes would overlap, so the trial was held until the size was smaller (${presses} S presses)` : 'a trial with 4 shapes is drawn without overlap');

    // Opening Adjust narrows the stage while a trial is drawn. The trial must then still fit, or be held with "cannot fit".
    // Bigger until it is refused, so the size is as large as the full stage allows and the narrower stage is most likely to be too small.
    let growPresses = 0;
    while (growPresses < 12 && !(await evaluate(`document.getElementById('hud-message').textContent.includes('cannot fit')`))) {
      await key('b');
      growPresses += 1;
      await sleep(100);
    }
    const fullWidth = await evaluate(`document.getElementById('stage').width`);
    // Clear the message first, so a stale "cannot fit" from the refused bigger cannot be mistaken for a hold.
    await evaluate(`document.getElementById('hud-message').textContent = 'no check yet'`);
    await key('a');
    await waitFor(`!document.getElementById('adjust').hidden`, 'adjust panel visible for stage check');
    await sleep(200);
    const stage = await evaluate(`(() => {
      const canvas = document.getElementById('stage');
      const settings = JSON.parse(localStorage.getItem('lowVisionShapeTest.settings'));
      const px = Number(document.getElementById('hud-status').textContent.match(/\\((\\d+) px\\)/)[1]);
      return {
        width: canvas.width,
        height: canvas.height,
        px,
        count: settings.shapes.length * settings.count,
        held: document.getElementById('hud-message').textContent.includes('cannot fit'),
      };
    })()`);
    assert.ok(stage.width < fullWidth, 'opening Adjust narrows the stage');
    // The stage and panel must end above the response bar, as laid out on screen, including after the message changed.
    const edges = await evaluate(`(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      return { hudTop: box('hud').top, stageBottom: box('stage').bottom, panelBottom: box('adjust').bottom };
    })()`);
    assert.ok(edges.stageBottom <= edges.hudTop + 0.5, `stage ends at ${edges.stageBottom}, under the response bar at ${edges.hudTop}`);
    assert.ok(edges.panelBottom <= edges.hudTop + 0.5, `Adjust panel ends at ${edges.panelBottom}, under the response bar at ${edges.hudTop}`);
    const fitsNarrow = await evaluate(
      `window.LVST.layoutFit(${stage.count}, ${stage.width}, ${stage.height}, ${stage.px}).fits`,
    );
    assert.equal(stage.held, !fitsNarrow, `at ${stage.px} px the trial is held exactly when ${stage.count} shapes do not fit the narrower stage`);
    if (stage.held) {
      await showTrial('trial held after Adjust opened');
      step(`opening Adjust holds the trial, and a smaller size draws it again (${stage.count} shapes, ${stage.px} px)`);
    } else {
      step(`opening Adjust keeps the trial drawn, because ${stage.count} shapes still fit the narrower stage`);
    }
    await key('a');
    await waitFor(`document.getElementById('adjust').hidden`, 'adjust panel hidden after stage check');
    const multiShot = await devtools.send('Page.captureScreenshot', { format: 'png' });
    const multiPath = path.join(os.tmpdir(), 'lvst-static-multi.png');
    await fs.writeFile(multiPath, Buffer.from(multiShot.data, 'base64'));
    console.log(`  info multi-shape screenshot: ${multiPath}`);
    await key('1');
    await key('1');
    await waitFor(`document.getElementById('responses').textContent.includes('(2)')`, 'count shown on the button');
    await key('r');
    await waitFor(`document.getElementById('hud-message').textContent.includes('Recorded: Circle 2')`, 'counted answer recorded');
    step('counting shapes and recording the answer works');

    await key('Escape');
    await waitFor(`!!document.querySelector('[data-action="save-session"]')`, 'results screen');
    step('Escape ends the test and shows results');

    await click('[data-action="save-session"]');
    await waitFor(`!!document.querySelector('.facts')`, 'person screen after save');
    const session = await evaluate(`JSON.parse(localStorage.getItem('lowVisionShapeTest.records.v1')).people[0].sessions[0]`);
    assert.equal(session.trials.length, 3);
    const counted = session.trials[2];
    assert.equal(counted.targets.circle, 2);
    assert.deepEqual(counted.counts, { circle: 2 });
    assert.equal(counted.answer, 'counted');
    step('saved session keeps the shapes shown and the counts named');

    await click('[data-action="nav-home"]');
    await waitFor(`!!document.querySelector('[data-action="guest-test"]')`, 'home screen before guest test');
    await click('[data-action="guest-test"]');
    await waitFor(`!!document.querySelector('.setup')`, 'setup screen for guest');
    const guest = await evaluate(`(() => {
      const people = JSON.parse(localStorage.getItem('lowVisionShapeTest.records.v1')).people;
      const person = people[people.length - 1];
      return { count: people.length, name: person.name, age: person.age, gender: person.gender, visionLevel: person.visionLevel, issues: person.issues, notes: person.notes };
    })()`);
    assert.equal(guest.count, 2, 'the guest profile is saved as a new person');
    assert.match(guest.name, /^Guest /, 'the guest profile is named Guest');
    assert.deepEqual([guest.age, guest.gender, guest.visionLevel, guest.issues, guest.notes], [null, null, null, null, null], 'the guest profile has no details');
    step('guest test starts from home with no details to enter');

    // Reset puts the settings back to the defaults, here the yellow colour.
    await evaluate(`document.querySelector('[data-action="set"][data-key="color"][data-value="red"]').click()`);
    await click('[data-action="reset-settings"]');
    const resetColour = await evaluate(`JSON.parse(localStorage.getItem('lowVisionShapeTest.settings')).color`);
    assert.equal(resetColour, 'yellow', 'reset restores the default colour');
    step('reset settings restores the defaults');

    // A test can be paused to change settings. Resume applies them, and the trial in progress is not recorded.
    await click('[data-action="start-test"]');
    await waitFor(`document.getElementById('hud-status')?.textContent.includes('Trial 1')`, 'guest test running');
    await click('[data-action="change-settings"]');
    await waitFor(`!!document.querySelector('[data-action="resume-test"]') && !document.querySelector('[data-action="start-test"]')`, 'paused setup screen');
    const pausedTypeChips = await evaluate(`!!document.querySelector('[data-action="set"][data-key="mode"]')`);
    assert.equal(pausedTypeChips, false, 'the test type is not changeable while paused');
    await evaluate(`document.querySelector('[data-action="set"][data-key="color"][data-value="green"]').click()`);
    await click('[data-action="resume-test"]');
    await waitFor(`document.getElementById('hud-status')?.textContent.includes('Trial 1')`, 'resumed test');
    const pausedColour = await evaluate(`JSON.parse(localStorage.getItem('lowVisionShapeTest.settings')).color`);
    assert.equal(pausedColour, 'green', 'settings changed while paused are kept on resume');
    step('a test can be paused to change settings and resumed with them');

    // Fire TV remote keys: Menu opens the Adjust panel, Back closes it first, and Play/Pause pauses and resumes the test.
    await key('ContextMenu');
    await waitFor(`!document.getElementById('adjust').hidden`, 'Menu key opens the Adjust panel');
    await key('Escape');
    await waitFor(`document.getElementById('adjust').hidden`, 'Back closes the Adjust panel first');
    await waitFor(`document.getElementById('hud-status')?.textContent.includes('Trial 1')`, 'test still running after Back');
    await key('MediaPlayPause');
    await waitFor(`document.getElementById('btn-pause').textContent.includes('Resume')`, 'Play/Pause pauses the test');
    await key('MediaPlayPause');
    await waitFor(`document.getElementById('btn-pause').textContent.includes('Pause (P)')`, 'Play/Pause resumes the test');
    step('Fire TV keys: Menu opens Adjust, Back closes it, Play/Pause pauses and resumes');

    // End the guest test and discard it, so the run leaves no session behind. Confirm is answered yes, since the page cannot show it.
    await key('Escape');
    await waitFor(`!!document.querySelector('[data-action="discard-session"]')`, 'results screen for guest');
    await evaluate(`window.confirm = () => true`);
    await click('[data-action="discard-session"]');
    await waitFor(`!!document.querySelector('[data-action="setup"]')`, 'person screen after discard');
    const guestSessions = await evaluate(`JSON.parse(localStorage.getItem('lowVisionShapeTest.records.v1')).people[1].sessions.length`);
    assert.equal(guestSessions, 0, 'a discarded guest session is not saved');
    step('ending and discarding a guest test saves nothing');

    // The home screen links to the remote key check page, which lists each key press.
    await click('[data-action="nav-home"]');
    await waitFor(`!!document.querySelector('a[href="keys.html"]')`, 'home screen link to the key check page');
    await devtools.send('Page.navigate', { url: new URL('keys.html', indexUrl).href });
    await waitFor(`document.querySelector('h1')?.textContent === 'Remote key check'`, 'key check page');
    await key('ArrowDown');
    await waitFor(`document.getElementById('rows').textContent.includes('ArrowDown')`, 'key check page lists the press');
    step('home links to the remote key check page, which lists key presses');

    assert.deepEqual(errors, [],`browser reported errors: ${errors.join(' | ')}`);
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
