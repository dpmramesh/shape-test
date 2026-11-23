/*
 * Browser UI for the low vision shape test. Runs from a static host (GitHub Pages) or by opening index.html.
 * All data stays in this browser's localStorage unless the operator downloads a backup file.
 */
(function () {
  'use strict';

  const L = window.LVST;
  const appEl = document.getElementById('app');
  const noticeEl = document.getElementById('notice');

  const SETTINGS_KEY = 'lowVisionShapeTest.settings';
  const MAX_ADAPTIVE_TRIALS = 40;
  const GAP_BETWEEN_TRIALS_MS = 700;
  const ARROW_DIRECTIONS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  const GENDER_LABELS = { female: 'Female', male: 'Male', other: 'Other', prefer_not_to_say: 'Prefer not to say' };
  const MOTION_LABELS = {
    bounce: 'Bounce (straight, reflects off edges)',
    sweep: 'Sweep (side to side)',
    orbit: 'Orbit (circle)',
    wander: 'Wander (random turns)',
  };
  const FILL_LABELS = { filled: 'Filled', outline: 'Outline', mixed: 'Mixed' };
  const SPEED_MAX = 1000;

  const DEFAULT_SETTINGS = {
    shapes: [...L.SHAPE_KEYS],
    fill: 'filled',
    color: 'yellow',
    background: 'black',
    pattern: 'bounce',
    speed: 150,
    mode: 'adaptive',
    fixedSizeDeg: 5,
    viewingDistanceCm: 300,
    screenWidthCm: 120,
  };

  // ---------- storage ----------

  // Some browsers block localStorage (private mode, strict settings). Fall back to memory so the app still runs.
  let storageBlocked = false;

  function pickStorage() {
    try {
      const probe = '__lvst_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch {
      storageBlocked = true;
      const memory = new Map();
      return {
        getItem: (key) => (memory.has(key) ? memory.get(key) : null),
        setItem: (key, value) => memory.set(key, String(value)),
        removeItem: (key) => memory.delete(key),
      };
    }
  }

  const storage = pickStorage();
  const store = L.createRecordStore(storage);

  function loadSettings() {
    try {
      const stored = JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}');
      const merged = { ...DEFAULT_SETTINGS, ...stored };
      merged.shapes = Array.isArray(stored.shapes) ? stored.shapes.filter((key) => L.SHAPE_KEYS.includes(key)) : [];
      if (!merged.shapes.length) {
        merged.shapes = [...DEFAULT_SETTINGS.shapes];
      }
      return merged;
    } catch {
      return { ...DEFAULT_SETTINGS, shapes: [...DEFAULT_SETTINGS.shapes] };
    }
  }

  function saveSettings() {
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch {
      // Settings then last only for this page load.
    }
  }

  // ---------- state ----------

  const state = {
    screen: 'home',
    people: [],
    person: null,
    settings: loadSettings(),
    test: null,
    result: null,
  };
  let trialView = null;

  // ---------- helpers ----------

  function esc(value) {
    return L.escapeHtml(value);
  }

  function formatDeg(value) {
    return value === null || value === undefined ? '-' : `${Number(value.toFixed(2))}°`;
  }

  function formatPct(value) {
    return value === null || value === undefined ? '-' : `${Math.round(value * 100)}%`;
  }

  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleString() : '-';
  }

  function setNotice(message, kind = 'error') {
    noticeEl.textContent = message;
    noticeEl.className = `notice ${kind}`;
    noticeEl.hidden = !message;
  }

  function errorText(err) {
    const details = err.details?.length ? ` ${err.details.join('; ')}` : '';
    return `${err.message}.${details}`;
  }

  function shapeLabel(key) {
    return L.SHAPES.find((shape) => shape.key === key)?.label ?? key;
  }

  function colorHex(key) {
    return L.COLORS.find((color) => color.key === key)?.hex ?? '#ffffff';
  }

  function backgroundHex(key) {
    return L.BACKGROUNDS.find((background) => background.key === key)?.hex ?? '#000000';
  }

  function downloadFile(fileName, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeFileStem(name) {
    return String(name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  // Renders a full screen and moves focus to the element with the same focus id, or to [autofocus].
  function render(html, { fallbackFocus = true } = {}) {
    const previousId = document.activeElement?.dataset?.focusId;
    appEl.innerHTML = html;
    for (const el of appEl.querySelectorAll('[data-swatch]')) {
      el.style.setProperty('--swatch', el.dataset.swatch);
    }
    const target =
      (previousId && appEl.querySelector(`[data-focus-id="${previousId}"]`)) ||
      appEl.querySelector('[autofocus]') ||
      (fallbackFocus ? appEl.querySelector('button, input, select, textarea, a[href]') : null);
    target?.focus({ preventScroll: true });
  }

  // Replaces part of the page without losing focus (used inside the test screen).
  function replaceKeepingFocus(container, html) {
    const active = document.activeElement;
    const id = active && container.contains(active) ? active.dataset.focusId : null;
    container.innerHTML = html;
    for (const el of container.querySelectorAll('[data-swatch]')) {
      el.style.setProperty('--swatch', el.dataset.swatch);
    }
    if (id) {
      container.querySelector(`[data-focus-id="${id}"]`)?.focus({ preventScroll: true });
    }
  }

  function chip({ action, key, value, label, selected, swatch }) {
    const focusId = `${action}:${key ?? ''}:${value}`;
    const swatchAttr = swatch ? ` data-swatch="${esc(swatch)}"` : '';
    return `<button type="button" class="chip${selected ? ' selected' : ''}" aria-pressed="${selected}"
      data-action="${action}" data-key="${esc(key ?? '')}" data-value="${esc(value)}" data-focus-id="${esc(focusId)}"${swatchAttr}>${esc(label)}</button>`;
  }

  function calibrationValid(settings) {
    return (
      Number.isFinite(settings.viewingDistanceCm) &&
      Number.isFinite(settings.screenWidthCm) &&
      settings.viewingDistanceCm >= L.LIMITS.viewingDistanceCm.min &&
      settings.viewingDistanceCm <= L.LIMITS.viewingDistanceCm.max &&
      settings.screenWidthCm >= L.LIMITS.screenWidthCm.min &&
      settings.screenWidthCm <= L.LIMITS.screenWidthCm.max
    );
  }

  function pxPerCmFor(settings) {
    return L.pixelsPerCm(window.innerWidth, settings.screenWidthCm);
  }

  function calibrationText(settings) {
    if (!calibrationValid(settings)) {
      return 'Enter a viewing distance and screen width to calibrate the sizes.';
    }
    const pxPerCm = pxPerCmFor(settings);
    const onePx = L.degToPx(1, settings.viewingDistanceCm, pxPerCm);
    const selectedPx = L.degToPx(settings.fixedSizeDeg, settings.viewingDistanceCm, pxPerCm);
    return `At this distance, 1° is ${onePx.toFixed(1)} px on this screen. The size of ${formatDeg(settings.fixedSizeDeg)} is ${Math.round(selectedPx)} px.`;
  }

  function speedLabel(speed, degPerSec) {
    return degPerSec === null ? `${speed} px/s` : `${speed} px/s (about ${degPerSec.toFixed(1)}° per second)`;
  }

  function speedLabelFor(settings) {
    const degPerSec = calibrationValid(settings)
      ? L.pxPerSecToDegPerSec(settings.speed, settings.viewingDistanceCm, pxPerCmFor(settings))
      : null;
    return speedLabel(settings.speed, degPerSec);
  }

  // ---------- home ----------

  function showHome() {
    state.screen = 'home';
    state.person = null;
    setNotice('');
    try {
      state.people = store.listPeople();
    } catch (err) {
      state.people = [];
      setNotice(err.message);
    }
    render(`
      <section class="screen">
        <h1>Low vision shape test</h1>
        <p class="muted">Choose a person to test, or add someone new. Use the arrow keys or the remote to move between buttons.</p>
        <p class="privacy">Records are saved only in this browser on this device. Nothing is uploaded. Download a backup to keep a copy or move records to another device.</p>
        <div class="row wrap">
          <button class="primary" data-action="new-person" data-focus-id="new-person" autofocus>+ New person</button>
          <button data-action="download-backup" data-focus-id="backup">Download backup</button>
          <button data-action="import-pick" data-focus-id="restore">Restore from backup</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>
        ${
          state.people.length
            ? `<ul class="list">${state.people
                .map(
                  (person) => `<li class="card">
                    <div class="card-text">
                      <strong>${esc(person.name)}</strong>
                      <span class="muted">${person.age ?? '-'} years · ${person.sessionCount} session${person.sessionCount === 1 ? '' : 's'}</span>
                    </div>
                    <div class="row">
                      <button data-action="open-person" data-id="${esc(person.id)}" data-focus-id="open:${esc(person.id)}">Open</button>
                      <button class="primary" data-action="setup" data-id="${esc(person.id)}" data-focus-id="test:${esc(person.id)}">Start test</button>
                    </div>
                  </li>`,
                )
                .join('')}</ul>`
            : '<p>No people yet. Add a person to start.</p>'
        }
      </section>`);
  }

  // ---------- person screens ----------

  function openPerson(id) {
    setNotice('');
    try {
      state.person = store.getPerson(id);
    } catch (err) {
      setNotice(err.message);
      return;
    }
    renderPersonDetail();
  }

  function renderPersonDetail() {
    state.screen = 'person';
    const person = state.person;
    const sessions = person.sessions ?? [];
    render(`
      <section class="screen">
        <h1>${esc(person.name)}</h1>
        <dl class="facts">
          <dt>Age</dt><dd>${esc(person.age ?? '-')}</dd>
          <dt>Gender</dt><dd>${esc(GENDER_LABELS[person.gender] ?? '-')}</dd>
          <dt>Current vision level</dt><dd>${esc(person.visionLevel ?? '-')}</dd>
          <dt>Issues</dt><dd>${esc(person.issues ?? '-')}</dd>
          <dt>Notes</dt><dd>${esc(person.notes ?? '-')}</dd>
        </dl>
        <div class="row wrap">
          <button class="primary" data-action="setup" data-id="${esc(person.id)}" autofocus>Start new test</button>
          <button data-action="edit-person">Edit details</button>
          <button data-action="download-report">Download report (HTML)</button>
          <button data-action="download-csv">Download trials (CSV)</button>
          <button class="danger" data-action="delete-person">Delete person</button>
          <button data-action="nav-home">Back to list</button>
        </div>
        <h2>Sessions</h2>
        ${
          sessions.length
            ? `<table><thead><tr><th>#</th><th>Date</th><th>Type</th><th>Threshold</th><th>Trials</th><th>Accuracy</th><th>Mean response</th></tr></thead>
              <tbody>${sessions
                .map((session, index) => {
                  const summary = L.summarizeTrials(session.trials);
                  return `<tr>
                    <td>${index + 1}</td>
                    <td>${esc(formatDate(session.startedAt))}</td>
                    <td>${esc(session.mode)}</td>
                    <td>${esc(formatDeg(L.thresholdFor(session)))}</td>
                    <td>${summary.trialCount}</td>
                    <td>${esc(formatPct(summary.accuracy))}</td>
                    <td>${summary.meanResponseMs === null ? '-' : `${summary.meanResponseMs} ms`}</td>
                  </tr>`;
                })
                .join('')}</tbody></table>`
            : '<p class="muted">No sessions yet.</p>'
        }
      </section>`);
  }

  function personFormView(person) {
    const p = person ?? {};
    return `
      <section class="screen">
        <h1>${p.id ? 'Edit person' : 'New person'}</h1>
        <form id="person-form" class="form" novalidate>
          <label>Full name
            <input name="name" required maxlength="${L.LIMITS.nameMaxLength}" value="${esc(p.name)}" autofocus>
          </label>
          <label>Age
            <input name="age" type="number" min="${L.LIMITS.age.min}" max="${L.LIMITS.age.max}" value="${esc(p.age ?? '')}">
          </label>
          <label>Gender
            <select name="gender">
              <option value="">Not recorded</option>
              ${L.GENDERS.map((g) => `<option value="${g}" ${p.gender === g ? 'selected' : ''}>${esc(GENDER_LABELS[g])}</option>`).join('')}
            </select>
          </label>
          <label>Current vision level
            <input name="visionLevel" maxlength="${L.LIMITS.visionLevelMaxLength}" value="${esc(p.visionLevel ?? '')}"
              placeholder="for example: 20/500 in the better eye">
          </label>
          <label>Issues or diagnosis
            <textarea name="issues" rows="3" maxlength="${L.LIMITS.issuesMaxLength}">${esc(p.issues ?? '')}</textarea>
          </label>
          <label>Notes
            <textarea name="notes" rows="3" maxlength="${L.LIMITS.notesMaxLength}">${esc(p.notes ?? '')}</textarea>
          </label>
          <div class="row">
            <button type="button" data-action="cancel-form">Cancel</button>
            <button type="button" class="primary" data-action="save-person">Save person</button>
          </div>
        </form>
      </section>`;
  }

  function showPersonForm(person) {
    state.screen = 'person-form';
    render(personFormView(person), { fallbackFocus: false });
  }

  function savePerson(button) {
    const form = document.getElementById('person-form');
    const data = Object.fromEntries(new FormData(form));
    const payload = {
      name: data.name?.trim() ?? '',
      age: data.age?.trim() ? Number(data.age) : null,
      gender: data.gender || null,
      visionLevel: data.visionLevel?.trim() || null,
      issues: data.issues?.trim() || null,
      notes: data.notes?.trim() || null,
    };
    try {
      const saved = state.person?.id ? store.updatePerson(state.person.id, payload) : store.createPerson(payload);
      openPerson(saved.id);
      setNotice('Person saved.', 'ok');
    } catch (err) {
      setNotice(err.details ? errorText(err) : err.message);
      button.disabled = false;
    }
  }

  function deletePersonAction() {
    const person = state.person;
    if (!person || !window.confirm(`Delete ${person.name} and all of their sessions? This cannot be undone.`)) {
      return;
    }
    try {
      store.deletePerson(person.id);
      setNotice('Person deleted.', 'ok');
      showHome();
    } catch (err) {
      setNotice(err.message);
    }
  }

  function downloadReport() {
    const person = state.person;
    if (!person) {
      return;
    }
    const html = L.buildPersonReport(person);
    downloadFile(`report-${safeFileStem(person.name)}-${today()}.html`, 'text/html', html);
    setNotice('Report downloaded. Open it in a browser and use Print to save it as PDF.', 'ok');
  }

  function downloadCsv() {
    const person = state.person;
    if (!person) {
      return;
    }
    downloadFile(`trials-${safeFileStem(person.name)}-${today()}.csv`, 'text/csv', L.buildTrialsCsv(person));
    setNotice('Trials CSV downloaded.', 'ok');
  }

  function downloadBackup() {
    try {
      downloadFile(`shape-test-backup-${today()}.json`, 'application/json', store.exportBackup());
      setNotice('Backup downloaded. Keep it somewhere safe.', 'ok');
    } catch (err) {
      setNotice(err.message);
    }
  }

  function importFile(file) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { added, replaced } = store.importBackup(String(reader.result));
        setNotice(`Restore complete: ${added} added, ${replaced} updated.`, 'ok');
        showHome();
      } catch (err) {
        setNotice(err.details ? errorText(err) : err.message);
      }
    };
    reader.onerror = () => setNotice('The backup file could not be read.');
    reader.readAsText(file);
  }

  // ---------- setup ----------

  function showSetup(personId) {
    setNotice('');
    if (!state.person || state.person.id !== personId) {
      try {
        state.person = store.getPerson(personId);
      } catch (err) {
        setNotice(err.message);
        return;
      }
    }
    state.screen = 'setup';
    renderSetup();
  }

  function renderSetup() {
    const s = state.settings;
    const adaptive = s.mode === 'adaptive';
    const pxPerCm = calibrationValid(s) ? pxPerCmFor(s) : null;
    render(`
      <section class="screen setup">
        <h1>Test setup for ${esc(state.person.name)}</h1>
        <fieldset>
          <legend>Shapes to show (choose one or more)</legend>
          <div class="chips">${L.SHAPES.map((shape) =>
            chip({ action: 'toggle-shape', value: shape.key, label: shape.label, selected: s.shapes.includes(shape.key) }),
          ).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>Fill</legend>
          <div class="chips">${L.FILL_MODES.map((fill) =>
            chip({ action: 'set', key: 'fill', value: fill, label: FILL_LABELS[fill], selected: s.fill === fill }),
          ).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>Shape colour</legend>
          <div class="chips">${L.COLORS.map((color) =>
            chip({ action: 'set', key: 'color', value: color.key, label: color.label, selected: s.color === color.key, swatch: color.hex }),
          ).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>Background</legend>
          <div class="chips">${L.BACKGROUNDS.map((bg) =>
            chip({ action: 'set', key: 'background', value: bg.key, label: bg.label, selected: s.background === bg.key, swatch: bg.hex }),
          ).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>Motion</legend>
          <div class="chips">${L.MOTION_PATTERNS.map((pattern) =>
            chip({ action: 'set', key: 'pattern', value: pattern, label: MOTION_LABELS[pattern], selected: s.pattern === pattern }),
          ).join('')}</div>
          <label class="slider-label">Speed
            <input type="range" min="0" max="${SPEED_MAX}" step="10" value="${s.speed}" data-input="speed">
            <output id="speed-label">${esc(speedLabelFor(s))}</output>
          </label>
        </fieldset>
        <fieldset>
          <legend>Test type</legend>
          <div class="chips">
            ${chip({ action: 'set', key: 'mode', value: 'adaptive', label: 'Adaptive: size changes automatically', selected: adaptive })}
            ${chip({ action: 'set', key: 'mode', value: 'fixed', label: 'Fixed: keep one size', selected: !adaptive })}
          </div>
          <label>${adaptive ? 'Starting size' : 'Size to test'}
            <select data-input="fixedSizeDeg">
              ${L.SIZE_LEVELS_DEG.map((deg) => {
                const px = pxPerCm ? Math.round(L.degToPx(deg, s.viewingDistanceCm, pxPerCm)) : '?';
                return `<option value="${deg}" ${deg === s.fixedSizeDeg ? 'selected' : ''}>${deg}° (${px} px)</option>`;
              }).join('')}
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Calibration</legend>
          <label>Viewing distance from the screen (cm)
            <input type="number" min="${L.LIMITS.viewingDistanceCm.min}" max="${L.LIMITS.viewingDistanceCm.max}" value="${s.viewingDistanceCm}" data-input="viewingDistanceCm">
          </label>
          <label>Physical width of the screen (cm)
            <input type="number" min="${L.LIMITS.screenWidthCm.min}" max="${L.LIMITS.screenWidthCm.max}" value="${s.screenWidthCm}" data-input="screenWidthCm">
          </label>
          <p id="calibration" class="muted">${esc(calibrationText(s))}</p>
        </fieldset>
        <p class="muted">During the test you can change shapes, colour, fill, speed and size with the Adjust panel, without leaving the test.</p>
        <div class="row">
          <button data-action="back-to-person">Back</button>
          <button class="primary" data-action="start-test" data-focus-id="start-test">Start test</button>
        </div>
      </section>`);
  }

  // Keeps setup labels in step with the inputs without re-rendering, so focus never jumps while typing.
  function refreshCalibration() {
    const s = state.settings;
    const pxPerCm = calibrationValid(s) ? pxPerCmFor(s) : null;
    for (const option of document.querySelectorAll('[data-input="fixedSizeDeg"] option')) {
      const deg = Number(option.value);
      const px = pxPerCm ? Math.round(L.degToPx(deg, s.viewingDistanceCm, pxPerCm)) : '?';
      option.textContent = `${deg}° (${px} px)`;
    }
    const speedOutput = document.getElementById('speed-label');
    if (speedOutput) {
      speedOutput.textContent = speedLabelFor(s);
    }
    const calibration = document.getElementById('calibration');
    if (calibration) {
      calibration.textContent = calibrationText(s);
    }
  }

  // ---------- test: canvas ----------

  function createTrialView(canvas) {
    const ctx = canvas.getContext('2d');
    let frameId = null;
    let lastTime = null;
    let trial = null;
    let motion = null;
    let paused = false;

    // The stage is sized to the area not covered by the operator panels, so a shape is never drawn underneath them.
    function resize(height = window.innerHeight, width = window.innerWidth) {
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
    }

    function paint() {
      ctx.fillStyle = trial ? trial.background : '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!trial || !motion) {
        return;
      }
      const { x, y } = motion.position;
      L.drawShape(ctx, trial.target, x, y, trial.sizePx, { filled: trial.filled, color: trial.color });
    }

    function frame(time) {
      const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
      lastTime = time;
      if (!paused && motion) {
        motion.step(dt);
      }
      paint();
      frameId = requestAnimationFrame(frame);
    }

    function ensureLoop() {
      if (frameId === null) {
        lastTime = null;
        frameId = requestAnimationFrame(frame);
      }
    }

    // params: { target, sizePx, filled, color, background, pattern, speed }
    function show(params) {
      trial = { ...params };
      motion = L.createMotion({
        width: canvas.width,
        height: canvas.height,
        size: params.sizePx,
        speed: params.speed,
        pattern: params.pattern,
      });
      paint();
      ensureLoop();
    }

    // Changes what is drawn right now: size, colour, fill, background.
    function update(partial) {
      if (trial) {
        Object.assign(trial, partial);
        paint();
      }
    }

    function setSpeed(value) {
      if (motion) {
        motion.setSpeed(value);
      }
    }

    function clear() {
      trial = null;
      motion = null;
      paint();
      ensureLoop();
    }

    function stop() {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    }

    return {
      resize,
      show,
      update,
      setSpeed,
      clear,
      stop,
      setPaused(value) {
        paused = value;
      },
      get paused() {
        return paused;
      },
    };
  }

  // ---------- test: session ----------

  function startTest() {
    const s = state.settings;
    if (!s.shapes.length) {
      setNotice('Select at least one shape.');
      return;
    }
    if (!calibrationValid(s)) {
      setNotice('Check the viewing distance and screen width. Both must be numbers within the allowed range.');
      return;
    }
    saveSettings();
    state.test = {
      personId: state.person.id,
      personName: state.person.name,
      mode: s.mode,
      startedAt: new Date().toISOString(),
      trials: [],
      current: null,
      sizeDeg: s.fixedSizeDeg,
      startSizeDeg: s.fixedSizeDeg,
      staircase: s.mode === 'adaptive' ? L.createStaircase({ startDeg: s.fixedSizeDeg, maxTrials: MAX_ADAPTIVE_TRIALS }) : null,
      pxPerCm: pxPerCmFor(s),
      nextTimer: null,
      hudVisible: true,
      adjustVisible: false,
      paused: false,
    };
    setNotice('');
    state.screen = 'test';
    renderTestScreen();
    nextTrial();
  }

  function renderTestScreen() {
    const shapeButtons = L.SHAPES.map(
      (shape, index) =>
        `<button type="button" data-action="respond" data-value="${shape.key}" data-focus-id="resp:${shape.key}">${index + 1} ${esc(shape.label)}</button>`,
    ).join('');
    render(
      `<div class="test-screen" id="test-screen">
        <canvas id="stage" aria-label="Moving shape display"></canvas>
        <div class="hud" id="hud">
          <div class="status" id="hud-status"></div>
          <div class="responses" aria-label="Person's answer">
            ${shapeButtons}
            <button type="button" data-action="respond" data-value="none" data-focus-id="resp:none">0 Nothing seen</button>
            <button type="button" data-action="respond" data-value="unsure" data-focus-id="resp:unsure">U Seen, not identified</button>
          </div>
          <div class="controls">
            <button type="button" data-action="toggle-pause" data-focus-id="ctl:pause" id="btn-pause">Pause (P)</button>
            <button type="button" data-action="toggle-adjust" data-focus-id="ctl:adjust" id="btn-adjust">Adjust (A)</button>
            <button type="button" data-action="toggle-hud" data-focus-id="ctl:hud">Hide controls (H)</button>
            <button type="button" class="danger" data-action="end-test" data-focus-id="ctl:end">End test (Esc)</button>
          </div>
          <p id="hud-message" class="hud-message" role="status"></p>
        </div>
        <div id="adjust" class="adjust" hidden></div>
      </div>`,
      { fallbackFocus: false },
    );
    trialView?.stop();
    trialView = createTrialView(document.getElementById('stage'));
    updateHud();
  }

  // Sizes the shape stage so it never sits under the response bar or the Adjust panel.
  // The panel is a column on the right; the response bar is a strip along the bottom.
  function layoutStage() {
    const t = state.test;
    if (!t || !trialView) {
      return;
    }
    const hud = document.getElementById('hud');
    const hudHeight = hud && t.hudVisible ? hud.offsetHeight : 0;
    const panelWidth = t.adjustVisible ? Math.min(Math.round(window.innerWidth * 0.4), 620) : 0;
    const cssVars = document.documentElement.style;
    cssVars.setProperty('--hud-h', `${hudHeight}px`);
    cssVars.setProperty('--panel-w', `${panelWidth}px`);
    trialView.resize(window.innerHeight - hudHeight, window.innerWidth - panelWidth);
  }

  function currentSizeDeg() {
    const t = state.test;
    return t.current ? t.current.sizeDeg : t.sizeDeg;
  }

  // Status line only. Cheap enough to call on every live change, so sliders stay smooth.
  function updateStatusLine() {
    const t = state.test;
    const status = document.getElementById('hud-status');
    if (!t || !status) {
      return;
    }
    const s = state.settings;
    const sizeDeg = currentSizeDeg();
    const px = Math.round(L.degToPx(sizeDeg, s.viewingDistanceCm, t.pxPerCm));
    const identified = t.trials.filter((trial) => trial.response === trial.target).length;
    const modeText = t.mode === 'adaptive' ? `Adaptive · ${t.staircase.reversals.length} reversals` : 'Fixed size';
    status.textContent =
      `${t.personName} · Trial ${t.trials.length + (t.current ? 1 : 0)} · ` +
      `Size ${formatDeg(sizeDeg)} (${px} px) · Speed ${s.speed} px/s · ` +
      `${identified} of ${t.trials.length} identified · ${modeText}`;
    const liveSize = document.getElementById('live-size');
    if (liveSize) {
      liveSize.textContent = formatDeg(sizeDeg);
    }
  }

  function updateHud() {
    const t = state.test;
    if (!t) {
      return;
    }
    updateStatusLine();
    document.getElementById('hud').classList.toggle('hidden-controls', !t.hudVisible);
    document.getElementById('btn-pause').textContent = t.paused ? 'Resume (P)' : 'Pause (P)';
    document.getElementById('btn-adjust').textContent = t.adjustVisible ? 'Hide adjust (A)' : 'Adjust (A)';
    const adjust = document.getElementById('adjust');
    adjust.hidden = !t.adjustVisible;
    if (t.adjustVisible) {
      renderAdjust();
    }
    // The bar height changes when the status text wraps, and the panel width when Adjust opens. Keep the stage in step.
    layoutStage();
  }

  // The Adjust panel. Colour, fill, speed, size and calibration apply to the shape on screen now.
  // Shapes and motion pattern apply from the next trial, so the person is not asked about a changed shape mid-answer.
  function renderAdjust() {
    const s = state.settings;
    const t = state.test;
    const pxPerCm = calibrationValid(s) ? pxPerCmFor(s) : null;
    const sizeNote = t.mode === 'adaptive' ? 'Moves the staircase level without counting as a reversal.' : 'Changes the fixed size.';
    replaceKeepingFocus(
      document.getElementById('adjust'),
      `<div class="adjust-grid">
        <fieldset>
          <legend>Shapes (from next trial)</legend>
          <div class="chips">${L.SHAPES.map((shape) =>
            chip({ action: 'live-toggle-shape', value: shape.key, label: shape.label, selected: s.shapes.includes(shape.key) }),
          ).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>Motion (from next trial)</legend>
          <div class="chips">${L.MOTION_PATTERNS.map((pattern) =>
            chip({ action: 'live-set', key: 'pattern', value: pattern, label: MOTION_LABELS[pattern], selected: s.pattern === pattern }),
          ).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>Fill (now)</legend>
          <div class="chips">${L.FILL_MODES.map((fill) =>
            chip({ action: 'live-set', key: 'fill', value: fill, label: FILL_LABELS[fill], selected: s.fill === fill }),
          ).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>Colour (now)</legend>
          <div class="chips">${L.COLORS.map((color) =>
            chip({ action: 'live-set', key: 'color', value: color.key, label: color.label, selected: s.color === color.key, swatch: color.hex }),
          ).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>Background (now)</legend>
          <div class="chips">${L.BACKGROUNDS.map((bg) =>
            chip({ action: 'live-set', key: 'background', value: bg.key, label: bg.label, selected: s.background === bg.key, swatch: bg.hex }),
          ).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>Speed (now)</legend>
          <label class="slider-label">
            <input type="range" min="0" max="${SPEED_MAX}" step="10" value="${s.speed}" data-input="speed" data-focus-id="input:speed">
            <output id="live-speed">${esc(speedLabelFor(s))}</output>
          </label>
        </fieldset>
        <fieldset>
          <legend>Size (now)</legend>
          <div class="chips">
            <button type="button" data-action="size-down" data-focus-id="size:down">Smaller (S)</button>
            <span id="live-size" class="live-value">${formatDeg(currentSizeDeg())}</span>
            <button type="button" data-action="size-up" data-focus-id="size:up">Bigger (B)</button>
          </div>
          <p class="muted">${esc(sizeNote)}</p>
        </fieldset>
        <fieldset>
          <legend>Calibration (now)</legend>
          <label>Viewing distance (cm)
            <input type="number" min="${L.LIMITS.viewingDistanceCm.min}" max="${L.LIMITS.viewingDistanceCm.max}" value="${s.viewingDistanceCm}" data-input="viewingDistanceCm" data-focus-id="input:distance">
          </label>
          <label>Screen width (cm)
            <input type="number" min="${L.LIMITS.screenWidthCm.min}" max="${L.LIMITS.screenWidthCm.max}" value="${s.screenWidthCm}" data-input="screenWidthCm" data-focus-id="input:width">
          </label>
          <p class="muted" id="live-px">${esc(pxPerCm ? `1° is ${L.degToPx(1, s.viewingDistanceCm, pxPerCm).toFixed(1)} px` : 'Enter valid values to calibrate.')}</p>
        </fieldset>
      </div>`,
    );
  }

  // Applies a live change from the Adjust panel to the shape on screen.
  function applyLive(key) {
    const t = state.test;
    if (!t) {
      return;
    }
    const s = state.settings;
    if (key === 'color') {
      trialView.update({ color: colorHex(s.color) });
    } else if (key === 'background') {
      trialView.update({ background: backgroundHex(s.background) });
    } else if (key === 'fill' && t.current && s.fill !== 'mixed') {
      t.current.filled = s.fill === 'filled';
      trialView.update({ filled: t.current.filled });
    } else if (key === 'speed') {
      trialView.setSpeed(s.speed);
    } else if (key === 'viewingDistanceCm' || key === 'screenWidthCm') {
      if (calibrationValid(s)) {
        t.pxPerCm = pxPerCmFor(s);
        if (t.current) {
          trialView.update({ sizePx: L.degToPx(t.current.sizeDeg, s.viewingDistanceCm, t.pxPerCm) });
        }
        const livePx = document.getElementById('live-px');
        if (livePx) {
          livePx.textContent = `1° is ${L.degToPx(1, s.viewingDistanceCm, t.pxPerCm).toFixed(1)} px`;
        }
      }
    }
    saveSettings();
    updateStatusLine();
  }

  function nextTrial() {
    const t = state.test;
    if (!t) {
      return;
    }
    if (t.mode === 'adaptive' && t.staircase.isDone()) {
      finishTest();
      return;
    }
    const s = state.settings;
    const sizeDeg = t.mode === 'adaptive' ? t.staircase.currentDeg() : t.sizeDeg;
    const target = L.pickOne(s.shapes);
    const filled = s.fill === 'mixed' ? L.secureRandom() < 0.5 : s.fill === 'filled';
    t.current = {
      target,
      sizeDeg,
      filled,
      pattern: s.pattern,
      shownAt: new Date().toISOString(),
      startedAt: performance.now(),
    };
    trialView.show({
      target,
      sizePx: L.degToPx(sizeDeg, s.viewingDistanceCm, t.pxPerCm),
      filled,
      color: colorHex(s.color),
      background: backgroundHex(s.background),
      pattern: s.pattern,
      speed: s.speed,
    });
    setHudMessage('Waiting for the answer.');
    updateHud();
  }

  function respond(value) {
    const t = state.test;
    if (!t || !t.current) {
      return;
    }
    const s = state.settings;
    const current = t.current;
    const sizeDeg = t.mode === 'fixed' ? t.sizeDeg : current.sizeDeg;
    const correct = value === current.target;
    t.trials.push({
      sizeDeg,
      target: current.target,
      response: value,
      filled: current.filled,
      color: s.color,
      background: s.background,
      pattern: current.pattern,
      speed: s.speed,
      responseMs: Math.round(performance.now() - current.startedAt),
      shownAt: current.shownAt,
    });
    if (t.staircase) {
      t.staircase.record(correct);
    }
    t.current = null;
    trialView.clear();
    const label = value === 'none' ? 'nothing seen' : value === 'unsure' ? 'seen, not identified' : shapeLabel(value);
    setHudMessage(`Recorded: ${label}. Get ready.`);
    updateHud();
    t.nextTimer = setTimeout(nextTrial, GAP_BETWEEN_TRIALS_MS);
  }

  // Bigger or smaller by one level. In fixed mode this changes the size; in adaptive mode it nudges the staircase.
  function changeSize(direction) {
    const t = state.test;
    if (!t) {
      return;
    }
    const delta = direction === 'bigger' ? -1 : 1;
    const s = state.settings;
    if (t.mode === 'adaptive') {
      t.staircase.nudge(delta);
      if (t.current) {
        t.current.sizeDeg = t.staircase.currentDeg();
        trialView.update({ sizePx: L.degToPx(t.current.sizeDeg, s.viewingDistanceCm, t.pxPerCm) });
      }
    } else {
      const index = L.indexOfNearest(L.SIZE_LEVELS_DEG, t.sizeDeg);
      const next = Math.min(L.SIZE_LEVELS_DEG.length - 1, Math.max(0, index + delta));
      t.sizeDeg = L.SIZE_LEVELS_DEG[next];
      if (t.current) {
        t.current.sizeDeg = t.sizeDeg;
        trialView.update({ sizePx: L.degToPx(t.sizeDeg, s.viewingDistanceCm, t.pxPerCm) });
      }
    }
    updateHud();
  }

  function setHudMessage(message) {
    const el = document.getElementById('hud-message');
    if (el) {
      el.textContent = message;
    }
  }

  function togglePause() {
    const t = state.test;
    if (!t) {
      return;
    }
    t.paused = !t.paused;
    trialView.setPaused(t.paused);
    setHudMessage(t.paused ? 'Paused. Press Pause again to continue.' : '');
    updateHud();
  }

  function toggleHud() {
    if (state.test) {
      state.test.hudVisible = !state.test.hudVisible;
      updateHud();
    }
  }

  function toggleAdjust() {
    if (state.test) {
      state.test.adjustVisible = !state.test.adjustVisible;
      updateHud();
    }
  }

  function endTest() {
    if (state.test) {
      finishTest();
    }
  }

  function finishTest() {
    const t = state.test;
    clearTimeout(t.nextTimer);
    trialView.clear();
    trialView.stop();
    trialView = null;
    const s = state.settings;
    state.result = {
      personId: t.personId,
      personName: t.personName,
      mode: t.mode,
      startedAt: t.startedAt,
      endedAt: new Date().toISOString(),
      threshold: t.staircase ? t.staircase.threshold() : null,
      settings: {
        shapes: [...s.shapes],
        fill: s.fill,
        color: s.color,
        background: s.background,
        pattern: s.pattern,
        speed: s.speed,
        viewingDistanceCm: s.viewingDistanceCm,
        screenWidthCm: s.screenWidthCm,
        screenWidthPx: Math.round(window.innerWidth),
        fixedSizeDeg: t.startSizeDeg,
      },
      trials: t.trials,
    };
    state.test = null;
    showResults();
  }

  function showResults() {
    state.screen = 'results';
    const result = state.result;
    const summary = L.summarizeTrials(result.trials);
    const threshold = L.thresholdFor(result);
    const thresholdLabel = result.mode === 'adaptive' ? 'Threshold (staircase average)' : 'Smallest size at 50% or better';
    render(`
      <section class="screen">
        <h1>Session results for ${esc(result.personName)}</h1>
        <div class="stats">
          <div class="stat"><span>Trials</span><strong>${summary.trialCount}</strong></div>
          <div class="stat"><span>Identified</span><strong>${esc(formatPct(summary.accuracy))}</strong></div>
          <div class="stat"><span>${esc(thresholdLabel)}</span><strong>${esc(formatDeg(threshold))}</strong></div>
          <div class="stat"><span>Mean response</span><strong>${summary.meanResponseMs === null ? '-' : `${summary.meanResponseMs} ms`}</strong></div>
        </div>
        ${
          result.mode === 'adaptive' && threshold === null
            ? '<p class="muted">Not enough reversals to estimate a threshold. Run the test again for a more reliable estimate.</p>'
            : ''
        }
        <h2>By size</h2>
        ${summary.bySize.length ? `<table><thead><tr><th>Size</th><th>Shown</th><th>Identified</th><th>Accuracy</th></tr></thead><tbody>${summary.bySize
          .map((row) => `<tr><td>${esc(formatDeg(row.sizeDeg))}</td><td>${row.shown}</td><td>${row.correct}</td><td>${esc(formatPct(row.accuracy))}</td></tr>`)
          .join('')}</tbody></table>` : '<p class="muted">No trials recorded.</p>'}
        <h2>By shape</h2>
        ${summary.byShape.length ? `<table><thead><tr><th>Shape</th><th>Shown</th><th>Identified</th><th>Accuracy</th></tr></thead><tbody>${summary.byShape
          .map((row) => `<tr><td>${esc(shapeLabel(row.shape))}</td><td>${row.shown}</td><td>${row.correct}</td><td>${esc(formatPct(row.accuracy))}</td></tr>`)
          .join('')}</tbody></table>` : ''}
        <div class="row wrap">
          <button class="primary" data-action="save-session" autofocus ${summary.trialCount ? '' : 'disabled'}>Save session</button>
          <button class="danger" data-action="discard-session">Discard</button>
        </div>
      </section>`);
  }

  function saveResult(button) {
    const result = state.result;
    if (!result) {
      return;
    }
    const { personId, personName, ...session } = result;
    try {
      store.addSession(personId, session);
      state.result = null;
      setNotice(`Session saved for ${personName}.`, 'ok');
      openPerson(personId);
    } catch (err) {
      setNotice(`Could not save the session: ${errorText(err)} Download a backup to keep a copy, then try again.`);
      if (button) {
        button.disabled = false;
      }
    }
  }

  // ---------- events ----------

  const actions = {
    'nav-home': () => showHome(),
    'new-person': () => showPersonForm(null),
    'open-person': (el) => openPerson(el.dataset.id),
    'edit-person': () => showPersonForm(state.person),
    'cancel-form': () => (state.person ? renderPersonDetail() : showHome()),
    'save-person': (el) => savePerson(el),
    'delete-person': () => deletePersonAction(),
    'download-report': () => downloadReport(),
    'download-csv': () => downloadCsv(),
    'download-backup': () => downloadBackup(),
    'import-pick': () => document.getElementById('import-file').click(),
    setup: (el) => showSetup(el.dataset.id),
    'back-to-person': () => (state.person ? renderPersonDetail() : showHome()),
    set: (el) => {
      const { key, value } = el.dataset;
      state.settings[key] = key === 'fixedSizeDeg' ? Number(value) : value;
      saveSettings();
      renderSetup();
    },
    'toggle-shape': (el) => {
      toggleShape(el.dataset.value);
      renderSetup();
    },
    'start-test': () => startTest(),
    respond: (el) => respond(el.dataset.value),
    'toggle-pause': () => togglePause(),
    'toggle-hud': () => toggleHud(),
    'toggle-adjust': () => toggleAdjust(),
    'size-up': () => changeSize('bigger'),
    'size-down': () => changeSize('smaller'),
    'end-test': () => endTest(),
    'save-session': (el) => saveResult(el),
    'discard-session': () => {
      if (window.confirm('Discard this session? The recorded trials will be lost.')) {
        state.result = null;
        if (state.person) {
          renderPersonDetail();
        } else {
          showHome();
        }
      }
    },
    'live-set': (el) => {
      const { key, value } = el.dataset;
      state.settings[key] = value;
      applyLive(key);
      renderAdjust();
    },
    'live-toggle-shape': (el) => {
      toggleShape(el.dataset.value);
      saveSettings();
      renderAdjust();
    },
  };

  function toggleShape(value) {
    const shapes = state.settings.shapes;
    if (shapes.includes(value) && shapes.length === 1) {
      setNotice('At least one shape must stay selected.');
      return;
    }
    state.settings.shapes = shapes.includes(value) ? shapes.filter((key) => key !== value) : [...shapes, value];
    saveSettings();
  }

  appEl.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) {
      return;
    }
    const handler = actions[target.dataset.action];
    if (handler) {
      handler(target, event);
    }
  });

  appEl.addEventListener('input', (event) => {
    const key = event.target.dataset.input;
    if (!key) {
      return;
    }
    const value = Number(event.target.value);
    if (Number.isFinite(value)) {
      state.settings[key] = value;
    }
    saveSettings();
    if (state.test) {
      applyLive(key);
      const liveSpeed = document.getElementById('live-speed');
      if (liveSpeed) {
        liveSpeed.textContent = speedLabelFor(state.settings);
      }
    } else {
      refreshCalibration();
    }
  });

  appEl.addEventListener('change', (event) => {
    if (event.target.id === 'import-file') {
      importFile(event.target.files[0]);
      event.target.value = '';
    }
  });

  // Spatial navigation for the D-pad and arrow keys: move to the nearest focusable element in that direction.
  function focusableElements() {
    return [...appEl.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select, textarea')].filter(
      (el) => el.getClientRects().length > 0 && !el.closest('[hidden]'),
    );
  }

  function centreOf(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function moveFocus(direction) {
    const items = focusableElements();
    if (!items.length) {
      return;
    }
    const current = document.activeElement;
    if (!items.includes(current)) {
      items[0].focus();
      return;
    }
    const from = centreOf(current);
    let best = null;
    let bestScore = Infinity;
    for (const item of items) {
      if (item === current) {
        continue;
      }
      const to = centreOf(item);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      let primary;
      let secondary;
      if (direction === 'right' && dx > 4) {
        primary = dx;
        secondary = Math.abs(dy);
      } else if (direction === 'left' && dx < -4) {
        primary = -dx;
        secondary = Math.abs(dy);
      } else if (direction === 'down' && dy > 4) {
        primary = dy;
        secondary = Math.abs(dx);
      } else if (direction === 'up' && dy < -4) {
        primary = -dy;
        secondary = Math.abs(dx);
      } else {
        continue;
      }
      const score = primary + secondary * 2;
      if (score < bestScore) {
        best = item;
        bestScore = score;
      }
    }
    if (best) {
      best.focus({ preventScroll: true });
      best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  const isTextEntry = (el) => el.matches('textarea, input:not([type]), input[type=text], input[type=number]');
  const isHorizontalControl = (el) => el.matches('input[type=range], select');

  function handleTestKey(event) {
    // While the operator is typing a number in calibration, keys go to the input.
    if (isTextEntry(document.activeElement) && event.key !== 'Escape') {
      return false;
    }
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction) {
      if (isHorizontalControl(document.activeElement) && (direction === 'left' || direction === 'right')) {
        return false;
      }
      moveFocus(direction);
      return true;
    }
    if (/^[1-9]$/.test(event.key)) {
      const shape = L.SHAPES[Number(event.key) - 1];
      if (shape) {
        respond(shape.key);
      }
      return Boolean(shape);
    }
    switch (event.key) {
      case '0':
        respond('none');
        return true;
      case 'u':
      case 'U':
        respond('unsure');
        return true;
      case 'p':
      case 'P':
        togglePause();
        return true;
      case 'h':
      case 'H':
        toggleHud();
        return true;
      case 'a':
      case 'A':
        toggleAdjust();
        return true;
      case 'b':
      case 'B':
        changeSize('bigger');
        return true;
      case 's':
      case 'S':
        changeSize('smaller');
        return true;
      case 'Escape':
      case 'Backspace':
      case 'BrowserBack':
      case 'GoBack':
        endTest();
        return true;
      default:
        return false;
    }
  }

  document.addEventListener('keydown', (event) => {
    if (state.screen === 'test' && state.test) {
      if (handleTestKey(event)) {
        event.preventDefault();
      }
      return;
    }
    const direction = ARROW_DIRECTIONS[event.key];
    if (!direction) {
      return;
    }
    const active = document.activeElement;
    if (active && isTextEntry(active) && (direction === 'left' || direction === 'right')) {
      return;
    }
    if (active && isHorizontalControl(active) && (direction === 'left' || direction === 'right')) {
      return;
    }
    if (active && active.matches('textarea') && (direction === 'up' || direction === 'down')) {
      return;
    }
    event.preventDefault();
    moveFocus(direction);
  });

  window.addEventListener('resize', () => {
    if (state.test && trialView) {
      layoutStage();
    } else if (state.screen === 'setup') {
      refreshCalibration();
    }
  });

  showHome();
  if (storageBlocked) {
    setNotice('Browser storage is blocked here. Records will last only until this page is closed. Download a backup before leaving.', 'warn');
  }
})();
