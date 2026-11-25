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
    shapes: ['circle'],
    count: 1,
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
      if (!Number.isInteger(merged.count) || merged.count < L.LIMITS.count.min || merged.count > L.LIMITS.count.max) {
        merged.count = DEFAULT_SETTINGS.count;
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

  function countOptions(selected) {
    return Array.from({ length: L.LIMITS.count.max - L.LIMITS.count.min + 1 }, (_, i) => i + L.LIMITS.count.min)
      .map((n) => `<option value="${n}" ${n === selected ? 'selected' : ''}>${n}</option>`)
      .join('');
  }

  // Shapes drawn in one trial: each selected type, `count` times.
  function shapesPerTrial(s) {
    return s.shapes.length * s.count;
  }

  // Explains why a trial cannot be drawn at this size. Empty when the shapes fit.
  function fitMessage(sizeDeg, px, count, fit) {
    if (fit.fits) {
      return '';
    }
    const at = `${formatDeg(sizeDeg)} (${Math.round(px)} px)`;
    const hint = 'Press S for a smaller size, or lower the count in the Adjust panel.';
    return fit.reason === 'too-big'
      ? `At ${at} one shape is wider than the screen. ${hint}`
      : `At ${at}, ${count} shapes cannot fit on this screen without overlapping. ${hint}`;
  }

  // Setup checks the full window. The test itself checks the real stage, which is smaller because of the controls.
  function setupFitMessage(s) {
    if (!calibrationValid(s)) {
      return '';
    }
    const px = L.degToPx(s.fixedSizeDeg, s.viewingDistanceCm, pxPerCmFor(s));
    const count = shapesPerTrial(s);
    return fitMessage(s.fixedSizeDeg, px, count, L.layoutFit(count, window.innerWidth, window.innerHeight, px));
  }

  // "Star 5, Circle 5" for the feedback line. Only shapes with a count above zero.
  function describeCounts(counts) {
    return L.SHAPES.filter((shape) => counts[shape.key])
      .map((shape) => `${shape.label} ${counts[shape.key]}`)
      .join(', ');
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
          <button data-action="guest-test" data-focus-id="guest-test">Guest test (no details)</button>
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

  // A guest profile needs only a name, which is filled in from the time, so the test can start straight away.
  // It is saved like any other person, so its trials are kept and it can be deleted later.
  function startGuestTest() {
    setNotice('');
    try {
      state.person = store.createPerson({ name: `Guest ${formatDate(new Date().toISOString())}` });
    } catch (err) {
      setNotice(err.details ? errorText(err) : err.message);
      return;
    }
    showSetup(state.person.id);
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
          <label>How many of each selected shape
            <select data-input="count">${countOptions(s.count)}</select>
          </label>
          <p class="muted">Star at 5 shows 5 stars. Star and Circle at 5 shows 5 stars and 5 circles.</p>
          <p id="fit-status" class="notice warn" role="status">${esc(setupFitMessage(s))}</p>
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
    const fitStatus = document.getElementById('fit-status');
    if (fitStatus) {
      fitStatus.textContent = setupFitMessage(s);
    }
  }

  // ---------- test: canvas ----------

  function createTrialView(canvas) {
    const ctx = canvas.getContext('2d');
    let frameId = null;
    let lastTime = null;
    let trial = null;
    let paused = false;

    // The stage is sized to the area not covered by the operator panels, so a shape is never drawn underneath them.
    function resize(height = window.innerHeight, width = window.innerWidth) {
      const nextWidth = Math.max(1, Math.round(width));
      const nextHeight = Math.max(1, Math.round(height));
      const changed = nextWidth !== canvas.width || nextHeight !== canvas.height;
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      // The shapes were placed for the old stage size, so they are laid out again for the new one.
      if (changed && trial) {
        build();
      }
    }

    function paint() {
      ctx.fillStyle = trial ? trial.background : '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!trial) {
        return;
      }
      for (const item of trial.items) {
        const { x, y } = item.motion.position;
        L.drawShape(ctx, item.key, x, y, trial.sizePx, { filled: trial.filled, color: trial.color });
      }
    }

    function frame(time) {
      const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
      lastTime = time;
      if (!paused && trial) {
        for (const item of trial.items) {
          item.motion.step(dt);
        }
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

    // Places every shape at its layout position. Each shape then moves on its own with the same pattern and speed.
    function build() {
      const placed = L.arrangeShapes(trial.shapes, canvas.width, canvas.height, trial.sizePx);
      trial.items = placed.map(({ key, x, y }) => ({
        key,
        motion: L.createMotion({
          width: canvas.width,
          height: canvas.height,
          size: trial.sizePx,
          speed: trial.speed,
          pattern: trial.pattern,
          start: { x, y },
        }),
      }));
    }

    // params: { shapes: [{ key, count }], sizePx, filled, color, background, pattern, speed }
    function show(params) {
      trial = { ...params, items: [] };
      build();
      paint();
      ensureLoop();
    }

    // Changes what is drawn right now: size, colour, fill, background. A new size re-lays out the shapes.
    function update(partial) {
      if (trial) {
        const resized = partial.sizePx !== undefined && partial.sizePx !== trial.sizePx;
        Object.assign(trial, partial);
        if (resized) {
          build();
        }
        paint();
      }
    }

    function setSpeed(value) {
      if (trial) {
        trial.speed = value;
        for (const item of trial.items) {
          item.motion.setSpeed(value);
        }
      }
    }

    function clear() {
      trial = null;
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
      stageSize: () => ({ width: canvas.width, height: canvas.height }),
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
    const fitProblem = setupFitMessage(s);
    if (fitProblem) {
      setNotice(fitProblem);
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
      blocked: false,
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
    render(
      `<div class="test-screen" id="test-screen">
        <canvas id="stage" aria-label="Moving shape display"></canvas>
        <div class="hud" id="hud">
          <div class="status" id="hud-status"></div>
          <div class="responses" id="responses" aria-label="Person's answer"></div>
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
    renderResponses();
    updateHud();
  }

  // Buttons for the person's answer: one per shape type on the current trial, then record, clear, and the two no-shape answers.
  // Pressing a shape button adds one to its count. The number keys do the same.
  function renderResponses() {
    const container = document.getElementById('responses');
    const t = state.test;
    if (!container || !t) {
      return;
    }
    const shown = t.current ? t.current.targets : {};
    const counts = t.current ? t.current.counts : {};
    const shapeButtons = L.SHAPES.filter((shape) => shown[shape.key])
      .map((shape) => {
        const index = L.SHAPE_KEYS.indexOf(shape.key);
        const named = counts[shape.key] ? ` (${counts[shape.key]})` : '';
        return `<button type="button" data-action="count" data-value="${shape.key}" data-focus-id="resp:${shape.key}">${index + 1} ${esc(shape.label)}${named}</button>`;
      })
      .join('');
    replaceKeepingFocus(
      container,
      `${shapeButtons}
        <button type="button" class="primary" data-action="record" data-focus-id="resp:record">Record answer (R)</button>
        <button type="button" data-action="clear-answer" data-focus-id="resp:clear">Clear count (C)</button>
        <button type="button" data-action="respond" data-value="none" data-focus-id="resp:none">0 Nothing seen</button>
        <button type="button" data-action="respond" data-value="unsure" data-focus-id="resp:unsure">U Seen, not identified</button>`,
    );
  }

  // Sizes the shape stage so it never sits under the response bar or the Adjust panel.
  // The panel is a column on the right; the response bar is a strip along the bottom.
  function sizeStage() {
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

  // Sizes the stage, then holds the shown trial if its shapes no longer fit the smaller stage.
  function layoutStage() {
    const t = state.test;
    sizeStage();
    if (!t || !trialView || !t.current) {
      return;
    }
    const count = Object.values(t.current.targets).reduce((sum, n) => sum + n, 0);
    const px = L.degToPx(t.current.sizeDeg, state.settings.viewingDistanceCm, t.pxPerCm);
    const fit = stageFit(px, count);
    if (!fit.fits) {
      holdTrial(t, fitMessage(t.current.sizeDeg, px, count, fit));
    }
  }

  // Takes the shapes off the screen and waits. Nothing is drawn until the size or count changes so the trial fits.
  function holdTrial(t, message) {
    t.blocked = true;
    t.current = null;
    trialView.clear();
    renderResponses();
    setHudMessage(message);
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
    const identified = t.trials.filter(L.isCorrect).length;
    const modeText = t.mode === 'adaptive' ? `Adaptive · ${t.staircase.reversals.length} reversals` : 'Fixed size';
    status.textContent =
      `${t.personName} · Trial ${t.trials.length + 1} · ` +
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
  // Shapes, count and motion pattern apply from the next trial, so the person is not asked about a changed shape mid-answer.
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
          <legend>How many of each (from next trial)</legend>
          <select data-input="count" data-focus-id="input:count">${countOptions(s.count)}</select>
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
    } else if (key === 'count' && t.blocked) {
      // A lower count may make the blocked trial fit now.
      nextTrial();
    } else if (key === 'viewingDistanceCm' || key === 'screenWidthCm') {
      if (calibrationValid(s)) {
        t.pxPerCm = pxPerCmFor(s);
        if (t.current) {
          const px = L.degToPx(t.current.sizeDeg, s.viewingDistanceCm, t.pxPerCm);
          const count = Object.values(t.current.targets).reduce((sum, n) => sum + n, 0);
          const fit = stageFit(px, count);
          if (fit.fits) {
            trialView.update({ sizePx: px });
          } else {
            setHudMessage(`${fitMessage(t.current.sizeDeg, px, count, fit)} The new calibration is not applied to this shape.`);
          }
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

  // Stage check for the shapes on screen. Used before drawing, so overlapping shapes are never drawn.
  function stageFit(px, count) {
    const { width, height } = trialView.stageSize();
    return L.layoutFit(count, width, height, px);
  }

  function nextTrial() {
    const t = state.test;
    if (!t) {
      return;
    }
    clearTimeout(t.nextTimer);
    if (t.mode === 'adaptive' && t.staircase.isDone()) {
      finishTest();
      return;
    }
    const s = state.settings;
    const sizeDeg = t.mode === 'adaptive' ? t.staircase.currentDeg() : t.sizeDeg;
    const px = L.degToPx(sizeDeg, s.viewingDistanceCm, t.pxPerCm);
    const count = shapesPerTrial(s);
    const filled = s.fill === 'mixed' ? L.secureRandom() < 0.5 : s.fill === 'filled';
    // Every selected shape type is drawn `count` times. The count is read now, so changes made later apply from the next trial.
    const shapes = s.shapes.map((key) => ({ key, count: s.count }));
    const targets = Object.fromEntries(shapes.map(({ key, count }) => [key, count]));
    t.current = {
      targets,
      counts: {},
      sizeDeg,
      filled,
      pattern: s.pattern,
      shownAt: new Date().toISOString(),
      startedAt: performance.now(),
    };
    // The response bar is laid out first, because its height sets the stage height. Only then is the stage checked.
    renderResponses();
    sizeStage();
    const fit = stageFit(px, count);
    if (!fit.fits) {
      // Nothing is drawn. Wait here until the operator makes the size smaller or the count lower.
      holdTrial(t, fitMessage(sizeDeg, px, count, fit));
      updateHud();
      return;
    }
    t.blocked = false;
    trialView.show({
      shapes,
      sizePx: px,
      filled,
      color: colorHex(s.color),
      background: backgroundHex(s.background),
      pattern: s.pattern,
      speed: s.speed,
    });
    setHudMessage('Waiting for the answer.');
    updateHud();
  }

  // Adds one to the count for a shape type shown on this trial.
  function countShape(key) {
    const current = state.test?.current;
    if (!current || !(key in current.targets)) {
      return;
    }
    const named = current.counts[key] ?? 0;
    if (named < L.LIMITS.count.max) {
      current.counts[key] = named + 1;
    }
    setHudMessage(`Named so far: ${describeCounts(current.counts)}.`);
    renderResponses();
  }

  function clearCount() {
    const current = state.test?.current;
    if (!current) {
      return;
    }
    current.counts = {};
    setHudMessage('Count cleared.');
    renderResponses();
  }

  // Records the counts the person named. Needs at least one count, or use 0 for nothing seen.
  function recordAnswer() {
    const current = state.test?.current;
    if (!current) {
      return;
    }
    if (!Object.keys(current.counts).length) {
      setHudMessage('Press a shape number to count it, or 0 for nothing seen.');
      return;
    }
    finishTrial('counted', current.counts);
  }

  // The person saw nothing ('none') or saw something but could not identify it ('unsure').
  function respond(answer) {
    if (state.test?.current) {
      finishTrial(answer, {});
    }
  }

  function finishTrial(answer, counts) {
    const t = state.test;
    const s = state.settings;
    const current = t.current;
    const sizeDeg = t.mode === 'fixed' ? t.sizeDeg : current.sizeDeg;
    const trial = {
      sizeDeg,
      targets: current.targets,
      counts,
      answer,
      filled: current.filled,
      color: s.color,
      background: s.background,
      pattern: current.pattern,
      speed: s.speed,
      responseMs: Math.round(performance.now() - current.startedAt),
      shownAt: current.shownAt,
    };
    t.trials.push(trial);
    if (t.staircase) {
      t.staircase.record(L.isCorrect(trial));
    }
    t.current = null;
    trialView.clear();
    const label = answer === 'none' ? 'nothing seen' : answer === 'unsure' ? 'seen, not identified' : describeCounts(counts);
    setHudMessage(`Recorded: ${label}. Get ready.`);
    renderResponses();
    updateHud();
    t.nextTimer = setTimeout(nextTrial, GAP_BETWEEN_TRIALS_MS);
  }

  // The next size level up (delta -1) or down (delta +1) from `deg`.
  function neighbourSizeDeg(deg, delta) {
    const levels = L.SIZE_LEVELS_DEG;
    const index = L.indexOfNearest(levels, deg);
    return levels[Math.min(levels.length - 1, Math.max(0, index + delta))];
  }

  // Bigger or smaller by one level. In fixed mode this changes the size; in adaptive mode it nudges the staircase.
  // While shapes are on screen, a size where they would overlap is refused. While a trial is held back, any size can be
  // chosen, because the held trial is checked again once the size changes.
  function changeSize(direction) {
    const t = state.test;
    if (!t) {
      return;
    }
    const s = state.settings;
    const delta = direction === 'bigger' ? -1 : 1;
    const nextDeg = neighbourSizeDeg(currentSizeDeg(), delta);
    const px = L.degToPx(nextDeg, s.viewingDistanceCm, t.pxPerCm);
    if (t.current) {
      const count = Object.values(t.current.targets).reduce((sum, n) => sum + n, 0);
      const fit = stageFit(px, count);
      if (!fit.fits) {
        setHudMessage(fitMessage(nextDeg, px, count, fit));
        return;
      }
    }
    if (t.mode === 'adaptive') {
      t.staircase.nudge(delta);
    } else {
      t.sizeDeg = nextDeg;
    }
    if (t.current) {
      t.current.sizeDeg = nextDeg;
      trialView.update({ sizePx: px });
    } else if (t.blocked) {
      nextTrial();
    }
    updateHud();
  }

  // A message can wrap onto more lines, which makes the response bar taller. The stage and panel are sized from the bar's
  // height, so they are laid out again after every message change.
  function setHudMessage(message) {
    const el = document.getElementById('hud-message');
    if (el) {
      el.textContent = message;
    }
    if (state.test) {
      layoutStage();
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
        count: s.count,
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
    'guest-test': () => startGuestTest(),
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
    count: (el) => countShape(el.dataset.value),
    record: () => recordAnswer(),
    'clear-answer': () => clearCount(),
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
      if (shape && state.test.current && shape.key in state.test.current.targets) {
        countShape(shape.key);
        return true;
      }
      return false;
    }
    switch (event.key) {
      case '0':
        respond('none');
        return true;
      case 'u':
      case 'U':
        respond('unsure');
        return true;
      case 'r':
      case 'R':
        recordAnswer();
        return true;
      case 'c':
      case 'C':
        clearCount();
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
