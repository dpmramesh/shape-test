/*
 * Low vision shape test: pure logic shared by the browser app and the tests.
 * No DOM access and no imports, so it loads as a plain <script> and works from file:// and GitHub Pages.
 * Exposes everything as window.LVST (or globalThis.LVST in Node tests).
 */
(function (root) {
  'use strict';

  // ---------- constants ----------

  const SHAPES = Object.freeze([
    { key: 'circle', label: 'Circle' },
    { key: 'square', label: 'Square' },
    { key: 'triangle', label: 'Triangle' },
    { key: 'diamond', label: 'Diamond' },
    { key: 'star', label: 'Star' },
    { key: 'hexagon', label: 'Hexagon' },
    { key: 'cross', label: 'Cross' },
    { key: 'heart', label: 'Heart' },
  ]);
  const SHAPE_KEYS = Object.freeze(SHAPES.map((shape) => shape.key));
  const RESPONSE_NONE = 'none';
  const RESPONSE_UNSURE = 'unsure';
  const RESPONSE_KEYS = Object.freeze([...SHAPE_KEYS, RESPONSE_NONE, RESPONSE_UNSURE]);
  // How the person answered a trial: counted shapes, saw nothing, or saw something but could not identify it.
  const ANSWERS = Object.freeze(['counted', 'none', 'unsure']);

  const COLORS = Object.freeze([
    { key: 'white', label: 'White', hex: '#ffffff' },
    { key: 'yellow', label: 'Yellow', hex: '#ffff00' },
    { key: 'red', label: 'Red', hex: '#ff3b30' },
    { key: 'green', label: 'Green', hex: '#34c759' },
    { key: 'blue', label: 'Blue', hex: '#0a84ff' },
    { key: 'cyan', label: 'Cyan', hex: '#00e5ff' },
    { key: 'magenta', label: 'Magenta', hex: '#ff00ff' },
    { key: 'orange', label: 'Orange', hex: '#ff9500' },
  ]);
  const BACKGROUNDS = Object.freeze([
    { key: 'black', label: 'Black', hex: '#000000' },
    { key: 'white', label: 'White', hex: '#ffffff' },
    { key: 'gray', label: 'Dark gray', hex: '#404040' },
    { key: 'navy', label: 'Navy', hex: '#000044' },
  ]);
  const COLOR_KEYS = Object.freeze(COLORS.map((color) => color.key));
  const BACKGROUND_KEYS = Object.freeze(BACKGROUNDS.map((background) => background.key));

  const FILL_MODES = Object.freeze(['filled', 'outline', 'mixed']);
  const MOTION_PATTERNS = Object.freeze(['bounce', 'sweep', 'orbit', 'wander']);
  const TEST_MODES = Object.freeze(['fixed', 'adaptive']);
  const GENDERS = Object.freeze(['female', 'male', 'other', 'prefer_not_to_say']);

  // Shape sizes as visual angle (degrees) at the viewing distance. Largest first.
  const SIZE_LEVELS_DEG = Object.freeze([30, 20, 15, 10, 7.5, 5, 4, 3, 2.5, 2, 1.5, 1.25, 1, 0.75, 0.5]);

  const LIMITS = Object.freeze({
    nameMaxLength: 100,
    visionLevelMaxLength: 200,
    issuesMaxLength: 1000,
    notesMaxLength: 2000,
    age: Object.freeze({ min: 0, max: 120 }),
    speedPxPerSec: Object.freeze({ min: 0, max: 2000 }),
    viewingDistanceCm: Object.freeze({ min: 10, max: 500 }),
    screenWidthCm: Object.freeze({ min: 5, max: 400 }),
    screenWidthPx: Object.freeze({ min: 320, max: 10000 }),
    sizeDeg: Object.freeze({ min: 0.1, max: 90 }),
    count: Object.freeze({ min: 1, max: 20 }),
    responseMs: Object.freeze({ min: 0, max: 600000 }),
    trialsPerSession: 2000,
  });

  // ---------- random ----------

  function secureRandom() {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return buffer[0] / 0x100000000;
  }

  function pickOne(items, rng = secureRandom) {
    if (!items.length) {
      throw new RangeError('Cannot pick from an empty list');
    }
    return items[Math.floor(rng() * items.length)];
  }

  // ---------- geometry ----------

  function assertPositive(name, value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive number`);
    }
  }

  function pixelsPerCm(screenWidthPx, screenWidthCm) {
    assertPositive('screenWidthPx', screenWidthPx);
    assertPositive('screenWidthCm', screenWidthCm);
    return screenWidthPx / screenWidthCm;
  }

  function degToPx(deg, viewingDistanceCm, pxPerCm) {
    assertPositive('deg', deg);
    assertPositive('viewingDistanceCm', viewingDistanceCm);
    assertPositive('pxPerCm', pxPerCm);
    const sizeCm = 2 * viewingDistanceCm * Math.tan((deg * Math.PI) / 360);
    return sizeCm * pxPerCm;
  }

  function pxToDeg(px, viewingDistanceCm, pxPerCm) {
    assertPositive('px', px);
    assertPositive('viewingDistanceCm', viewingDistanceCm);
    assertPositive('pxPerCm', pxPerCm);
    const sizeCm = px / pxPerCm;
    return (2 * Math.atan(sizeCm / (2 * viewingDistanceCm)) * 180) / Math.PI;
  }

  function pxPerSecToDegPerSec(speedPx, viewingDistanceCm, pxPerCm) {
    if (typeof speedPx !== 'number' || !Number.isFinite(speedPx) || speedPx < 0) {
      throw new RangeError('speedPx must not be negative');
    }
    assertPositive('viewingDistanceCm', viewingDistanceCm);
    assertPositive('pxPerCm', pxPerCm);
    const speedCm = speedPx / pxPerCm;
    return (speedCm / viewingDistanceCm) * (180 / Math.PI);
  }

  // ---------- shape outlines ----------

  const CIRCLE_SEGMENTS = 48;
  const HEART_SAMPLES = 64;

  function regularPolygon(sides, radius, startAngle = -Math.PI / 2) {
    const points = [];
    for (let i = 0; i < sides; i += 1) {
      const angle = startAngle + (2 * Math.PI * i) / sides;
      points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
    }
    return points;
  }

  function starPoints(spikes, outerRadius, innerRadius) {
    const points = [];
    for (let i = 0; i < spikes * 2; i += 1) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = -Math.PI / 2 + (Math.PI * i) / spikes;
      points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
    }
    return points;
  }

  // Moves points so their bounding box is centred on (0, 0), scaling first when `size` is given.
  function centreOnBox(points, size = null) {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const scale = size === null ? 1 : size / Math.max(maxX - minX, maxY - minY);
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    return points.map(([x, y]) => [(x - centreX) * scale, (y - centreY) * scale]);
  }

  function heartPoints(size) {
    const raw = [];
    for (let i = 0; i < HEART_SAMPLES; i += 1) {
      const t = (2 * Math.PI * i) / HEART_SAMPLES;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      raw.push([x, -y]); // canvas y grows downwards, so flip the heart upright
    }
    return centreOnBox(raw, size);
  }

  function outlinePoints(key, size) {
    if (!SHAPE_KEYS.includes(key)) {
      throw new RangeError(`Unknown shape: ${key}`);
    }
    assertPositive('size', size);
    const r = size / 2;
    switch (key) {
      case 'circle':
        return regularPolygon(CIRCLE_SEGMENTS, r, 0);
      case 'square':
        return [
          [-r, -r],
          [r, -r],
          [r, r],
          [-r, r],
        ];
      case 'triangle':
        return [
          [0, -r],
          [r, r],
          [-r, r],
        ];
      case 'diamond':
        return [
          [0, -r],
          [r, 0],
          [0, r],
          [-r, 0],
        ];
      case 'star':
        return centreOnBox(starPoints(5, r, r * 0.45));
      case 'hexagon':
        return regularPolygon(6, r, 0);
      case 'cross': {
        const t = r / 3;
        return [
          [-t, -r],
          [t, -r],
          [t, -t],
          [r, -t],
          [r, t],
          [t, t],
          [t, r],
          [-t, r],
          [-t, t],
          [-r, t],
          [-r, -t],
          [-t, -t],
        ];
      }
      case 'heart':
        return heartPoints(size);
      default:
        throw new RangeError(`Unknown shape: ${key}`);
    }
  }

  // ---------- layout ----------

  // Centres for `count` shapes of `size` on a width x height stage. Tries every row count and keeps the grid
  // whose smallest gap between neighbours is largest. Centres stay `size / 2` from each edge, so nothing is cropped.
  // If the shape cannot fit, every centre falls at the middle, as the single-shape test always did.
  // The grid with the largest smallest gap between neighbours. Needs count > 1 and a stage at least `size` in each direction.
  function bestGrid(count, width, height, size) {
    const spanX = width - size;
    const spanY = height - size;
    let best = null;
    for (let rows = 1; rows <= count; rows += 1) {
      const cols = Math.ceil(count / rows);
      const gapX = cols > 1 ? spanX / (cols - 1) : Infinity;
      const gapY = rows > 1 ? spanY / (rows - 1) : Infinity;
      const spacing = Math.min(gapX, gapY);
      if (!best || spacing > best.spacing) {
        best = { rows, cols, gapX, gapY, spacing };
      }
    }
    return best;
  }

  function gridPositions(count, width, height, size) {
    const half = size / 2;
    const spanX = width - size;
    const spanY = height - size;
    const centre = { x: width / 2, y: height / 2 };
    if (count === 1 || spanX < 0 || spanY < 0) {
      return Array.from({ length: count }, () => ({ ...centre }));
    }
    const best = bestGrid(count, width, height, size);
    const positions = [];
    for (let row = 0; positions.length < count; row += 1) {
      const inRow = Math.min(best.cols, count - positions.length);
      // Rows with fewer shapes are centred. Centring on half a gap keeps the smallest spacing unchanged.
      const offset = (best.cols - inRow) / 2;
      for (let col = 0; col < inRow; col += 1) {
        positions.push({
          x: best.cols > 1 ? half + (offset + col) * best.gapX : centre.x,
          y: best.rows > 1 ? half + row * best.gapY : centre.y,
        });
      }
    }
    return positions;
  }

  // Shapes keep a gap of a quarter of their size between them. Touching shapes count as overlapping.
  const SHAPE_GAP = 0.25;

  // Can `count` shapes of `size` be drawn on a width x height stage with the gap kept and nothing cut off?
  // Checked before anything is drawn. Returns { fits, reason } where reason is 'too-big' or 'overlap'.
  function layoutFit(count, width, height, size) {
    if (size > width || size > height) {
      return { fits: false, reason: 'too-big' };
    }
    if (count === 1) {
      return { fits: true, reason: null };
    }
    return bestGrid(count, width, height, size).spacing >= size * (1 + SHAPE_GAP)
      ? { fits: true, reason: null }
      : { fits: false, reason: 'overlap' };
  }

  // Shuffles in place so the shape types are spread across the stage, not grouped by type.
  function shuffleInPlace(items, rng = secureRandom) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  // shapes: [{ key, count }]. Returns [{ key, x, y }], one entry per shape to draw.
  function arrangeShapes(shapes, width, height, size, rng = secureRandom) {
    if (!shapes.length) {
      throw new RangeError('At least one shape is needed');
    }
    const keys = shapes.flatMap(({ key, count }) => {
      if (!SHAPE_KEYS.includes(key)) {
        throw new RangeError(`Unknown shape: ${key}`);
      }
      if (!Number.isInteger(count) || count < LIMITS.count.min || count > LIMITS.count.max) {
        throw new RangeError(`count must be a whole number from ${LIMITS.count.min} to ${LIMITS.count.max}`);
      }
      return Array(count).fill(key);
    });
    shuffleInPlace(keys, rng);
    const positions = gridPositions(keys.length, width, height, size);
    return keys.map((key, index) => ({ key, ...positions[index] }));
  }

  // ---------- drawing ----------

  function drawShape(ctx, key, cx, cy, size, { filled, color, lineWidth }) {
    const points = outlinePoints(key, size);
    ctx.save();
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) {
        ctx.moveTo(cx + x, cy + y);
      } else {
        ctx.lineTo(cx + x, cy + y);
      }
    });
    ctx.closePath();
    if (filled) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth ?? Math.max(2, size * 0.08);
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- motion ----------

  const WANDER_TURN_INTERVAL_S = 1.2;
  const MAX_STEP_S = 0.1;

  function assertFinite(name, value, min = 0) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
      throw new RangeError(`${name} must be a number >= ${min}`);
    }
  }

  // Returns { position, step(dt), setSpeed(px/s) }. Speed changes take effect on the next step.
  // `start` is where the shape begins (a layout position). Without it the start is random.
  function createMotion({ width, height, size, speed, pattern = 'bounce', start = null, rng = secureRandom }) {
    assertFinite('width', width);
    assertFinite('height', height);
    assertFinite('size', size);
    assertFinite('speed', speed);
    if (width <= 0 || height <= 0 || size <= 0) {
      throw new RangeError('width, height and size must be positive');
    }
    if (!MOTION_PATTERNS.includes(pattern)) {
      throw new RangeError(`Unknown motion pattern: ${pattern}`);
    }

    const half = size / 2;
    const centreX = width / 2;
    const centreY = height / 2;
    // A shape larger than the screen collapses the range to the centre, so it stays visible.
    const minX = width >= size ? half : centreX;
    const maxX = width >= size ? width - half : centreX;
    const minY = height >= size ? half : centreY;
    const maxY = height >= size ? height - half : centreY;

    const between = (low, high) => low + rng() * (high - low);
    const state = { x: 0, y: 0, dx: 1, dy: 0, heading: 0, turnIn: WANDER_TURN_INTERVAL_S, angle: 0, radius: 0 };
    let currentSpeed = speed;

    if (start !== null) {
      assertFinite('start.x', start.x, -Infinity);
      assertFinite('start.y', start.y, -Infinity);
    }
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

    if (pattern === 'orbit') {
      // A shape at the middle has no radius to start from, so it takes the default orbit.
      const maxRadius = Math.max(0, Math.min(centreX - half, centreY - half));
      const startRadius = start ? Math.hypot(start.x - centreX, start.y - centreY) : 0;
      state.radius = startRadius > 0 ? Math.min(startRadius, maxRadius) : maxRadius * 0.8;
      state.angle = startRadius > 0 ? Math.atan2(start.y - centreY, start.x - centreX) : rng() * 2 * Math.PI;
      state.x = centreX + state.radius * Math.cos(state.angle);
      state.y = centreY + state.radius * Math.sin(state.angle);
    } else if (pattern === 'sweep') {
      state.x = start ? clamp(start.x, minX, maxX) : between(minX, maxX);
      state.y = start ? clamp(start.y, minY, maxY) : centreY;
      state.dx = rng() < 0.5 ? -1 : 1;
      state.dy = 0;
    } else {
      state.x = start ? clamp(start.x, minX, maxX) : between(minX, maxX);
      state.y = start ? clamp(start.y, minY, maxY) : between(minY, maxY);
      state.heading = rng() * 2 * Math.PI;
      state.dx = Math.cos(state.heading);
      state.dy = Math.sin(state.heading);
    }

    function reflect() {
      if (state.x < minX) {
        state.x = Math.min(maxX, minX + (minX - state.x));
        state.dx = Math.abs(state.dx);
      } else if (state.x > maxX) {
        state.x = Math.max(minX, maxX - (state.x - maxX));
        state.dx = -Math.abs(state.dx);
      }
      if (state.y < minY) {
        state.y = Math.min(maxY, minY + (minY - state.y));
        state.dy = Math.abs(state.dy);
      } else if (state.y > maxY) {
        state.y = Math.max(minY, maxY - (state.y - maxY));
        state.dy = -Math.abs(state.dy);
      }
    }

    function position() {
      return { x: state.x, y: state.y };
    }

    function step(dt) {
      const h = Math.min(Math.max(dt, 0), MAX_STEP_S);

      if (pattern === 'orbit') {
        if (state.radius > 0 && currentSpeed > 0) {
          state.angle += (currentSpeed / state.radius) * h;
        }
        state.x = centreX + state.radius * Math.cos(state.angle);
        state.y = centreY + state.radius * Math.sin(state.angle);
        return position();
      }

      if (pattern === 'wander') {
        state.turnIn -= h;
        if (state.turnIn <= 0) {
          state.turnIn += WANDER_TURN_INTERVAL_S;
          state.heading += (rng() * 2 - 1) * (Math.PI / 2);
          state.dx = Math.cos(state.heading);
          state.dy = Math.sin(state.heading);
        }
      }

      state.x += state.dx * currentSpeed * h;
      state.y += state.dy * currentSpeed * h;
      reflect();
      return position();
    }

    function setSpeed(value) {
      assertFinite('speed', value);
      currentSpeed = value;
    }

    return {
      get position() {
        return position();
      },
      get speed() {
        return currentSpeed;
      },
      step,
      setSpeed,
    };
  }

  // ---------- adaptive staircase (2-down / 1-up) ----------

  function indexOfNearest(levels, deg) {
    let best = 0;
    for (let i = 1; i < levels.length; i += 1) {
      if (Math.abs(levels[i] - deg) < Math.abs(levels[best] - deg)) {
        best = i;
      }
    }
    return best;
  }

  function createStaircase({
    levels = SIZE_LEVELS_DEG,
    startDeg = 10,
    reversalsToStop = 8,
    correctToDescend = 2,
    maxTrials = 40,
  } = {}) {
    if (!Array.isArray(levels) || levels.length < 2) {
      throw new RangeError('levels must contain at least two sizes');
    }
    if (!Number.isInteger(reversalsToStop) || reversalsToStop < 3) {
      throw new RangeError('reversalsToStop must be an integer >= 3');
    }

    let index = indexOfNearest(levels, startDeg);
    let streak = 0;
    let lastDirection = 0; // +1 = last move made the target smaller, -1 = bigger
    let trials = 0;
    const reversalDegs = [];

    function currentDeg() {
      return levels[index];
    }

    function move(direction) {
      if (lastDirection !== 0 && direction !== lastDirection) {
        reversalDegs.push(levels[index]);
      }
      lastDirection = direction;
      index = Math.min(levels.length - 1, Math.max(0, index + direction));
    }

    function record(correct) {
      trials += 1;
      if (correct) {
        streak += 1;
        if (streak >= correctToDescend) {
          streak = 0;
          move(1);
        }
      } else {
        streak = 0;
        move(-1);
      }
    }

    // Manual adjustment by the operator. Moves the level without counting as a staircase reversal.
    // delta < 0 makes the target bigger, delta > 0 makes it smaller.
    function nudge(delta) {
      index = Math.min(levels.length - 1, Math.max(0, index + delta));
    }

    function isDone() {
      return reversalDegs.length >= reversalsToStop || trials >= maxTrials;
    }

    function threshold() {
      const used = reversalDegs.slice(2);
      if (used.length < 2) {
        return null;
      }
      return used.reduce((sum, deg) => sum + deg, 0) / used.length;
    }

    return {
      currentDeg,
      record,
      nudge,
      isDone,
      threshold,
      get trials() {
        return trials;
      },
      get reversals() {
        return [...reversalDegs];
      },
    };
  }

  // ---------- summaries ----------

  // Older sessions stored one shape per trial (target, response). Read them as one shape with a count of 1.
  function fromLegacy(target, response) {
    return {
      targets: { [target]: 1 },
      counts: SHAPE_KEYS.includes(response) ? { [response]: 1 } : {},
      answer: response === RESPONSE_NONE ? 'none' : response === RESPONSE_UNSURE ? 'unsure' : 'counted',
    };
  }

  // { targets: { shape: rendered count }, counts: { shape: named count }, answer }
  function trialCounts(trial) {
    if (isPlainObject(trial.targets)) {
      return { targets: trial.targets, counts: trial.counts ?? {}, answer: trial.answer ?? 'counted' };
    }
    return fromLegacy(trial.target, trial.response);
  }

  // Correct only when the person named every shape type shown with its exact count, and no other type.
  function isCorrect(trial) {
    const { targets, counts, answer } = trialCounts(trial);
    if (answer !== 'counted') {
      return false;
    }
    const shapes = new Set([...Object.keys(targets), ...Object.keys(counts)]);
    return [...shapes].every((shape) => (counts[shape] ?? 0) === (targets[shape] ?? 0));
  }

  // "star:5;circle:5", in shape order. Empty for no shapes. Used in the CSV.
  function countsText(counts) {
    return SHAPE_KEYS.filter((key) => counts[key]).map((key) => `${key}:${counts[key]}`).join(';');
  }

  function accuracyBySize(trials) {
    const rows = new Map();
    for (const trial of trials) {
      const row = rows.get(trial.sizeDeg) ?? { sizeDeg: trial.sizeDeg, shown: 0, correct: 0 };
      row.shown += 1;
      if (isCorrect(trial)) {
        row.correct += 1;
      }
      rows.set(trial.sizeDeg, row);
    }
    return [...rows.values()]
      .map((row) => ({ ...row, accuracy: row.correct / row.shown }))
      .sort((a, b) => b.sizeDeg - a.sizeDeg);
  }

  // Each shape type in a trial counts once: it was shown, and it was identified if the named count matched.
  function accuracyByShape(trials) {
    const rows = {};
    for (const trial of trials) {
      const { targets, counts } = trialCounts(trial);
      for (const [shape, expected] of Object.entries(targets)) {
        const row = rows[shape] ?? { shape, shown: 0, correct: 0 };
        row.shown += 1;
        if ((counts[shape] ?? 0) === expected) {
          row.correct += 1;
        }
        rows[shape] = row;
      }
    }
    return Object.values(rows)
      .map((row) => ({ ...row, accuracy: row.correct / row.shown }))
      .sort((a, b) => a.shape.localeCompare(b.shape));
  }

  function fixedThreshold(trials, { criterion = 0.5, minTrials = 3 } = {}) {
    const sizes = accuracyBySize(trials)
      .filter((row) => row.shown >= minTrials && row.accuracy >= criterion)
      .map((row) => row.sizeDeg);
    return sizes.length ? Math.min(...sizes) : null;
  }

  function summarizeTrials(trials) {
    const correctCount = trials.filter(isCorrect).length;
    const timed = trials.filter((trial) => typeof trial.responseMs === 'number');
    const meanResponseMs = timed.length
      ? Math.round(timed.reduce((sum, trial) => sum + trial.responseMs, 0) / timed.length)
      : null;
    return {
      trialCount: trials.length,
      correctCount,
      accuracy: trials.length ? correctCount / trials.length : null,
      meanResponseMs,
      bySize: accuracyBySize(trials),
      byShape: accuracyByShape(trials),
    };
  }

  function thresholdFor(session) {
    if (session.mode === 'adaptive') {
      return session.threshold ?? null;
    }
    return fixedThreshold(session.trials);
  }

  // ---------- validation ----------

  class ValidationError extends Error {
    constructor(details) {
      super('Invalid input');
      this.name = 'ValidationError';
      this.details = details;
    }
  }

  function createContext(errors, prefix = '') {
    return {
      fail(key, message) {
        errors.push(`${prefix}${key} ${message}`);
      },
      child(name) {
        return createContext(errors, `${prefix}${name}.`);
      },
    };
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function readText(input, key, maxLength, ctx, { required = false } = {}) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) {
        ctx.fail(key, 'is required');
      }
      return null;
    }
    if (typeof raw !== 'string') {
      ctx.fail(key, 'must be text');
      return null;
    }
    const value = raw.trim();
    if (!value) {
      if (required) {
        ctx.fail(key, 'is required');
      }
      return null;
    }
    if (value.length > maxLength) {
      ctx.fail(key, `must be at most ${maxLength} characters`);
      return null;
    }
    return value;
  }

  function readNumber(input, key, { min, max, integer = false }, ctx, { required = false } = {}) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) {
        ctx.fail(key, 'is required');
      }
      return null;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      ctx.fail(key, 'must be a number');
      return null;
    }
    if (integer && !Number.isInteger(raw)) {
      ctx.fail(key, 'must be a whole number');
      return null;
    }
    if (raw < min || raw > max) {
      ctx.fail(key, `must be between ${min} and ${max}`);
      return null;
    }
    return raw;
  }

  function readEnum(input, key, allowed, ctx, { required = false } = {}) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) {
        ctx.fail(key, 'is required');
      }
      return null;
    }
    if (!allowed.includes(raw)) {
      ctx.fail(key, `must be one of: ${allowed.join(', ')}`);
      return null;
    }
    return raw;
  }

  function readDate(input, key, ctx, { required = false } = {}) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) {
        ctx.fail(key, 'is required');
      }
      return null;
    }
    if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
      ctx.fail(key, 'must be an ISO 8601 date');
      return null;
    }
    return new Date(raw).toISOString();
  }

  function readBoolean(input, key, ctx) {
    const raw = input[key];
    if (typeof raw !== 'boolean') {
      ctx.fail(key, 'must be true or false');
      return null;
    }
    return raw;
  }

  function finish(errors, value) {
    if (errors.length) {
      throw new ValidationError(errors);
    }
    return value;
  }

  function validatePerson(input) {
    if (!isPlainObject(input)) {
      throw new ValidationError(['body must be an object']);
    }
    const errors = [];
    const ctx = createContext(errors);
    const value = {
      name: readText(input, 'name', LIMITS.nameMaxLength, ctx, { required: true }),
      age: readNumber(input, 'age', { ...LIMITS.age, integer: true }, ctx),
      gender: readEnum(input, 'gender', GENDERS, ctx),
      visionLevel: readText(input, 'visionLevel', LIMITS.visionLevelMaxLength, ctx),
      issues: readText(input, 'issues', LIMITS.issuesMaxLength, ctx),
      notes: readText(input, 'notes', LIMITS.notesMaxLength, ctx),
    };
    return finish(errors, value);
  }

  function validateSettings(input, ctx) {
    if (!isPlainObject(input)) {
      ctx.fail('settings', 'must be an object');
      return null;
    }
    const settingsCtx = ctx.child('settings');
    const shapes = input.shapes;
    let shapeList = null;
    if (!Array.isArray(shapes) || shapes.length === 0) {
      settingsCtx.fail('shapes', 'must be a non-empty list');
    } else if (new Set(shapes).size !== shapes.length || shapes.some((key) => !SHAPE_KEYS.includes(key))) {
      settingsCtx.fail('shapes', `must be unique values from: ${SHAPE_KEYS.join(', ')}`);
    } else {
      shapeList = [...shapes];
    }
    return {
      shapes: shapeList,
      fill: readEnum(input, 'fill', FILL_MODES, settingsCtx, { required: true }),
      color: readEnum(input, 'color', COLOR_KEYS, settingsCtx, { required: true }),
      background: readEnum(input, 'background', BACKGROUND_KEYS, settingsCtx, { required: true }),
      pattern: readEnum(input, 'pattern', MOTION_PATTERNS, settingsCtx, { required: true }),
      speed: readNumber(input, 'speed', LIMITS.speedPxPerSec, settingsCtx, { required: true }),
      viewingDistanceCm: readNumber(input, 'viewingDistanceCm', LIMITS.viewingDistanceCm, settingsCtx, { required: true }),
      screenWidthCm: readNumber(input, 'screenWidthCm', LIMITS.screenWidthCm, settingsCtx, { required: true }),
      screenWidthPx: readNumber(input, 'screenWidthPx', { ...LIMITS.screenWidthPx, integer: true }, settingsCtx),
      fixedSizeDeg: readNumber(input, 'fixedSizeDeg', LIMITS.sizeDeg, settingsCtx),
      count: readNumber(input, 'count', { ...LIMITS.count, integer: true }, settingsCtx),
    };
  }

  // Reads a { shape: whole number } map, such as the shapes shown in a trial or the counts the person named.
  function readCountMap(input, key, min, ctx) {
    const raw = input[key];
    if (!isPlainObject(raw)) {
      ctx.fail(key, 'must be an object');
      return null;
    }
    const map = {};
    for (const [shape, count] of Object.entries(raw)) {
      if (!SHAPE_KEYS.includes(shape)) {
        ctx.fail(`${key}.${shape}`, `must be a shape from: ${SHAPE_KEYS.join(', ')}`);
      } else if (!Number.isInteger(count) || count < min || count > LIMITS.count.max) {
        ctx.fail(`${key}.${shape}`, `must be a whole number from ${min} to ${LIMITS.count.max}`);
      } else {
        map[shape] = count;
      }
    }
    return map;
  }

  // Current format: targets, counts and answer. Older format: target and response, one shape per trial.
  function readTrialAnswer(trial, ctx) {
    if (trial.targets === undefined) {
      const target = readEnum(trial, 'target', SHAPE_KEYS, ctx, { required: true });
      const response = readEnum(trial, 'response', RESPONSE_KEYS, ctx, { required: true });
      return fromLegacy(target, response);
    }
    const targets = readCountMap(trial, 'targets', 1, ctx);
    if (targets && !Object.keys(targets).length) {
      ctx.fail('targets', 'must name at least one shape');
    }
    return {
      targets: targets ?? {},
      counts: (trial.counts === undefined ? {} : readCountMap(trial, 'counts', 0, ctx)) ?? {},
      answer: readEnum(trial, 'answer', ANSWERS, ctx, { required: true }),
    };
  }

  function validateTrials(input, ctx) {
    if (!Array.isArray(input)) {
      ctx.fail('trials', 'must be a list');
      return [];
    }
    if (input.length > LIMITS.trialsPerSession) {
      ctx.fail('trials', `must have at most ${LIMITS.trialsPerSession} entries`);
      return [];
    }
    return input.map((trial, index) => {
      if (!isPlainObject(trial)) {
        ctx.fail(`trials[${index}]`, 'must be an object');
        return null;
      }
      const trialCtx = ctx.child(`trials[${index}]`);
      const answer = readTrialAnswer(trial, trialCtx);
      return {
        sizeDeg: readNumber(trial, 'sizeDeg', LIMITS.sizeDeg, trialCtx, { required: true }),
        ...answer,
        correct: isCorrect(answer),
        filled: readBoolean(trial, 'filled', trialCtx),
        color: readEnum(trial, 'color', COLOR_KEYS, trialCtx, { required: true }),
        background: readEnum(trial, 'background', BACKGROUND_KEYS, trialCtx, { required: true }),
        pattern: readEnum(trial, 'pattern', MOTION_PATTERNS, trialCtx),
        speed: readNumber(trial, 'speed', LIMITS.speedPxPerSec, trialCtx),
        responseMs: readNumber(trial, 'responseMs', { ...LIMITS.responseMs, integer: true }, trialCtx),
        shownAt: readDate(trial, 'shownAt', trialCtx),
      };
    });
  }

  function validateSession(input) {
    if (!isPlainObject(input)) {
      throw new ValidationError(['body must be an object']);
    }
    const errors = [];
    const ctx = createContext(errors);
    const startedAt = readDate(input, 'startedAt', ctx, { required: true });
    const endedAt = readDate(input, 'endedAt', ctx, { required: true });
    if (startedAt && endedAt && Date.parse(endedAt) < Date.parse(startedAt)) {
      ctx.fail('endedAt', 'must not be earlier than startedAt');
    }
    const value = {
      mode: readEnum(input, 'mode', TEST_MODES, ctx, { required: true }),
      startedAt,
      endedAt,
      threshold: readNumber(input, 'threshold', LIMITS.sizeDeg, ctx),
      settings: validateSettings(input.settings, ctx),
      trials: validateTrials(input.trials, ctx),
    };
    return finish(errors, value);
  }

  // ---------- reports ----------

  const SHAPE_LABELS = Object.fromEntries(SHAPES.map((shape) => [shape.key, shape.label]));
  const GENDER_LABELS = {
    female: 'Female',
    male: 'Male',
    other: 'Other',
    prefer_not_to_say: 'Prefer not to say',
  };
  const REPORT_STYLE = `
  body { font-family: system-ui, Segoe UI, Arial, sans-serif; color: #111; margin: 2rem auto; max-width: 900px; line-height: 1.4; }
  h1 { margin-bottom: 0.2rem; }
  h2 { border-bottom: 2px solid #111; padding-bottom: 0.2rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
  th, td { border: 1px solid #999; padding: 0.35rem 0.5rem; text-align: left; font-size: 0.95rem; }
  th { background: #eee; }
  dl { display: grid; grid-template-columns: 12rem 1fr; gap: 0.3rem 1rem; }
  dt { font-weight: 600; }
  dd { margin: 0; white-space: pre-wrap; }
  .muted { color: #555; font-size: 0.9rem; }
  .disclaimer { border: 1px solid #999; padding: 0.6rem 0.8rem; background: #fafafa; font-size: 0.9rem; }
  svg { max-width: 100%; height: auto; }
  @media print { body { margin: 0.5in; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
`;
  const DISCLAIMER =
    'This is a screening aid that records what a person can see and identify at each shape size. ' +
    'It is not a diagnostic test. Interpret results together with a clinical assessment.';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        default:
          return '&#39;';
      }
    });
  }

  function formatDate(iso) {
    if (!iso) {
      return '-';
    }
    return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }

  function formatPercent(value) {
    return value === null || value === undefined ? '-' : `${Math.round(value * 100)}%`;
  }

  function formatDeg(value) {
    return value === null || value === undefined ? '-' : `${Number(value.toFixed(2))}°`;
  }

  function sessionRows(sessions) {
    return sessions
      .map((session, index) => {
        const summary = summarizeTrials(session.trials);
        return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(formatDate(session.startedAt))}</td>
        <td>${escapeHtml(session.mode)}</td>
        <td>${escapeHtml(formatDeg(thresholdFor(session)))}</td>
        <td>${summary.trialCount}</td>
        <td>${escapeHtml(formatPercent(summary.accuracy))}</td>
        <td>${summary.meanResponseMs === null ? '-' : `${summary.meanResponseMs} ms`}</td>
      </tr>`;
      })
      .join('\n');
  }

  function sizeRows(trials) {
    return summarizeTrials(trials)
      .bySize.map(
        (row) => `<tr>
        <td>${escapeHtml(formatDeg(row.sizeDeg))}</td>
        <td>${row.shown}</td>
        <td>${row.correct}</td>
        <td>${escapeHtml(formatPercent(row.accuracy))}</td>
      </tr>`,
      )
      .join('\n');
  }

  function shapeRows(trials) {
    return summarizeTrials(trials)
      .byShape.map(
        (row) => `<tr>
        <td>${escapeHtml(SHAPE_LABELS[row.shape] ?? row.shape)}</td>
        <td>${row.shown}</td>
        <td>${row.correct}</td>
        <td>${escapeHtml(formatPercent(row.accuracy))}</td>
      </tr>`,
      )
      .join('\n');
  }

  function progressChartSvg(sessions) {
    const points = sessions
      .map((session, index) => ({ index, threshold: thresholdFor(session) }))
      .filter((point) => point.threshold !== null);
    if (points.length < 2) {
      return '<p class="muted">At least two sessions with a threshold are needed to show progress.</p>';
    }
    const width = 640;
    const height = 260;
    const pad = { left: 56, right: 16, top: 16, bottom: 40 };
    const maxDeg = Math.max(...points.map((p) => p.threshold));
    const minDeg = Math.min(...points.map((p) => p.threshold));
    const top = maxDeg === minDeg ? minDeg * 0.9 : minDeg;
    const bottom = maxDeg === minDeg ? maxDeg * 1.1 : maxDeg;
    const xFor = (i) => pad.left + (i / (sessions.length - 1 || 1)) * (width - pad.left - pad.right);
    const yFor = (deg) => pad.top + ((deg - top) / (bottom - top)) * (height - pad.top - pad.bottom);
    const polyline = points.map((p) => `${xFor(p.index).toFixed(1)},${yFor(p.threshold).toFixed(1)}`).join(' ');
    const dots = points
      .map(
        (p) =>
          `<circle cx="${xFor(p.index).toFixed(1)}" cy="${yFor(p.threshold).toFixed(1)}" r="4" fill="#005a9c"><title>Session ${p.index + 1}: ${escapeHtml(formatDeg(p.threshold))}</title></circle>`,
      )
      .join('');
    const labels = sessions
      .map((_, i) => `<text x="${xFor(i).toFixed(1)}" y="${height - 14}" font-size="11" text-anchor="middle">${i + 1}</text>`)
      .join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Threshold by session">
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#333"/>
    <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#333"/>
    <text x="${pad.left - 6}" y="${(pad.top + 8).toFixed(1)}" font-size="11" text-anchor="end">${escapeHtml(formatDeg(top))}</text>
    <text x="${pad.left - 6}" y="${(height - pad.bottom).toFixed(1)}" font-size="11" text-anchor="end">${escapeHtml(formatDeg(bottom))}</text>
    <text x="${pad.left}" y="${height - 2}" font-size="11">Session number (lower on chart = larger threshold)</text>
    <polyline points="${polyline}" fill="none" stroke="#005a9c" stroke-width="2"/>
    ${dots}
    ${labels}
  </svg>`;
  }

  function trendText(sessions) {
    const values = sessions.map((s) => thresholdFor(s)).filter((v) => v !== null);
    if (values.length < 2) {
      return 'Not enough sessions to show a trend.';
    }
    const first = values[0];
    const last = values[values.length - 1];
    const change = first - last;
    if (Math.abs(change) < 0.01) {
      return `Threshold unchanged at ${formatDeg(last)} since the first session.`;
    }
    const direction = change > 0 ? 'improved' : 'worsened';
    return `Threshold ${direction} from ${formatDeg(first)} to ${formatDeg(last)} (${formatDeg(Math.abs(change))} change).`;
  }

  function buildPersonReport(person, { generatedAt = new Date() } = {}) {
    const sessions = person.sessions ?? [];
    const allTrials = sessions.flatMap((session) => session.trials);
    const sessionSections = sessions
      .map((session, index) => {
        const settings = session.settings ?? {};
        const shapes = (settings.shapes ?? []).map((key) => SHAPE_LABELS[key] ?? key).join(', ');
        const fill = { filled: 'Filled', outline: 'Outline', mixed: 'Mixed (filled and outline)' }[settings.fill] ?? settings.fill;
        return `<section>
        <h3>Session ${index + 1}: ${escapeHtml(formatDate(session.startedAt))}</h3>
        <dl>
          <dt>Mode</dt><dd>${escapeHtml(session.mode)}</dd>
          <dt>Shapes</dt><dd>${escapeHtml(shapes)}</dd>
          <dt>Count per shape</dt><dd>${escapeHtml(settings.count ?? 1)}</dd>
          <dt>Fill</dt><dd>${escapeHtml(fill)}</dd>
          <dt>Colour / background</dt><dd>${escapeHtml(settings.color)} on ${escapeHtml(settings.background)}</dd>
          <dt>Motion</dt><dd>${escapeHtml(settings.pattern)} at ${escapeHtml(settings.speed)} px/s</dd>
          <dt>Viewing distance</dt><dd>${escapeHtml(settings.viewingDistanceCm)} cm, screen width ${escapeHtml(settings.screenWidthCm)} cm</dd>
          <dt>Threshold</dt><dd>${escapeHtml(formatDeg(thresholdFor(session)))}</dd>
        </dl>
        <h4>Accuracy by size</h4>
        <table><thead><tr><th>Size</th><th>Shown</th><th>Identified</th><th>Accuracy</th></tr></thead>
        <tbody>${sizeRows(session.trials)}</tbody></table>
        <h4>Accuracy by shape</h4>
        <table><thead><tr><th>Shape</th><th>Shown</th><th>Identified</th><th>Accuracy</th></tr></thead>
        <tbody>${shapeRows(session.trials)}</tbody></table>
      </section>`;
      })
      .join('\n');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>Shape vision report: ${escapeHtml(person.name)}</title>
<style>${REPORT_STYLE}</style>
</head>
<body>
<h1>Shape vision screening report</h1>
<p class="muted">Generated ${escapeHtml(formatDate(generatedAt.toISOString()))}</p>

<h2>Person</h2>
<dl>
  <dt>Name</dt><dd>${escapeHtml(person.name)}</dd>
  <dt>Age</dt><dd>${escapeHtml(person.age ?? '-')}</dd>
  <dt>Gender</dt><dd>${escapeHtml(GENDER_LABELS[person.gender] ?? person.gender ?? '-')}</dd>
  <dt>Current vision level</dt><dd>${escapeHtml(person.visionLevel ?? '-')}</dd>
  <dt>Reported issues</dt><dd>${escapeHtml(person.issues ?? '-')}</dd>
  <dt>Notes</dt><dd>${escapeHtml(person.notes ?? '-')}</dd>
  <dt>Record created</dt><dd>${escapeHtml(formatDate(person.createdAt))}</dd>
</dl>

<h2>Progress</h2>
<p>${escapeHtml(trendText(sessions))}</p>
${progressChartSvg(sessions)}
<table>
  <thead><tr><th>#</th><th>Date</th><th>Mode</th><th>Threshold</th><th>Trials</th><th>Accuracy</th><th>Mean response</th></tr></thead>
  <tbody>${sessionRows(sessions)}</tbody>
</table>

<h2>All sessions combined</h2>
<table><thead><tr><th>Size</th><th>Shown</th><th>Identified</th><th>Accuracy</th></tr></thead>
<tbody>${sizeRows(allTrials)}</tbody></table>

<h2>Session details</h2>
${sessionSections || '<p class="muted">No sessions recorded yet.</p>'}

<h2>Notes on this report</h2>
<p class="disclaimer">${escapeHtml(DISCLAIMER)}</p>
<p class="muted">Size levels in degrees of visual angle: ${escapeHtml(SIZE_LEVELS_DEG.join(', '))}.</p>
</body>
</html>
`;
  }

  const CSV_HEADERS = [
    'session_id',
    'session_started',
    'mode',
    'trial',
    'shapes_shown',
    'answer',
    'correct',
    'size_deg',
    'response_ms',
    'fill',
    'color',
    'background',
    'motion',
    'speed_px_per_s',
    'shown_at',
  ];

  // Cells starting with = + - @ or a tab are formulas in spreadsheets. Prefix them so they show as text.
  function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    if (/[",\n\r]/.test(text)) {
      text = `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function buildTrialsCsv(person) {
    const lines = [CSV_HEADERS.join(',')];
    for (const session of person.sessions ?? []) {
      session.trials.forEach((trial, index) => {
        const { targets, counts, answer } = trialCounts(trial);
        lines.push(
          [
            session.id,
            session.startedAt,
            session.mode,
            index + 1,
            countsText(targets),
            answer === 'counted' ? countsText(counts) : answer,
            isCorrect(trial) ? 'yes' : 'no',
            trial.sizeDeg,
            trial.responseMs,
            trial.filled ? 'filled' : 'outline',
            trial.color,
            trial.background,
            trial.pattern ?? session.settings?.pattern ?? '',
            trial.speed ?? session.settings?.speed ?? '',
            trial.shownAt ?? '',
          ]
            .map(csvCell)
            .join(','),
        );
      });
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  // ---------- records (browser storage) ----------

  class StoreError extends Error {
    constructor(message) {
      super(message);
      this.name = 'StoreError';
    }
  }

  class NotFoundError extends Error {
    constructor(message = 'Person not found') {
      super(message);
      this.name = 'NotFoundError';
    }
  }

  const BACKUP_APP_NAME = 'shape-test';
  const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

  function summaryOf(record) {
    return {
      id: record.id,
      name: record.name,
      age: record.age ?? null,
      gender: record.gender ?? null,
      createdAt: record.createdAt,
      sessionCount: Array.isArray(record.sessions) ? record.sessions.length : 0,
    };
  }

  // All people and sessions live in one localStorage entry. `storage` is injected so tests can use a fake.
  function createRecordStore(
    storage,
    {
      key = 'lowVisionShapeTest.records.v1',
      now = () => new Date().toISOString(),
      newId = () => globalThis.crypto.randomUUID(),
    } = {},
  ) {
    function read() {
      const raw = storage.getItem(key);
      if (!raw) {
        return { version: 1, people: [] };
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new StoreError('Saved data is damaged and cannot be read. Restore a backup file to recover.');
      }
      if (!data || !Array.isArray(data.people)) {
        throw new StoreError('Saved data has an unexpected format. Restore a backup file to recover.');
      }
      return data;
    }

    function write(data) {
      try {
        storage.setItem(key, JSON.stringify(data));
      } catch {
        throw new StoreError('Browser storage is full or unavailable. Download a backup and remove old sessions.');
      }
    }

    function findIndex(data, id) {
      const index = data.people.findIndex((person) => person.id === id);
      if (index < 0) {
        throw new NotFoundError();
      }
      return index;
    }

    function listPeople() {
      return read()
        .people.map(summaryOf)
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    function getPerson(id) {
      const data = read();
      return data.people[findIndex(data, id)];
    }

    function createPerson(input) {
      const value = validatePerson(input);
      const timestamp = now();
      const record = { id: newId(), ...value, createdAt: timestamp, updatedAt: timestamp, sessions: [] };
      const data = read();
      data.people.push(record);
      write(data);
      return record;
    }

    function updatePerson(id, input) {
      const value = validatePerson(input);
      const data = read();
      const index = findIndex(data, id);
      const existing = data.people[index];
      data.people[index] = {
        ...existing,
        ...value,
        id: existing.id,
        createdAt: existing.createdAt,
        sessions: existing.sessions,
        updatedAt: now(),
      };
      write(data);
      return data.people[index];
    }

    function deletePerson(id) {
      const data = read();
      data.people.splice(findIndex(data, id), 1);
      write(data);
    }

    function addSession(id, input) {
      const session = validateSession(input);
      const data = read();
      const person = data.people[findIndex(data, id)];
      const saved = { id: newId(), ...session, savedAt: now() };
      person.sessions.push(saved);
      person.updatedAt = saved.savedAt;
      write(data);
      return saved;
    }

    function exportBackup() {
      return JSON.stringify({ app: BACKUP_APP_NAME, version: 1, exportedAt: now(), people: read().people }, null, 2);
    }

    // Merges people from a backup. Records with the same id are replaced, others are added.
    // Everything is validated before anything is written, so a bad file changes nothing.
    function importBackup(text) {
      let backup;
      try {
        backup = JSON.parse(text);
      } catch {
        throw new StoreError('The file is not valid JSON.');
      }
      if (!isPlainObject(backup) || backup.app !== BACKUP_APP_NAME || !Array.isArray(backup.people)) {
        throw new StoreError('This file is not a backup from this app.');
      }
      const incoming = backup.people.map((person) => {
        if (!isPlainObject(person) || typeof person.id !== 'string' || !ID_PATTERN.test(person.id)) {
          throw new StoreError('A person in the backup has a missing or invalid id.');
        }
        const sessions = Array.isArray(person.sessions) ? person.sessions : [];
        return {
          ...validatePerson(person),
          id: person.id,
          createdAt: typeof person.createdAt === 'string' ? person.createdAt : now(),
          updatedAt: now(),
          sessions: sessions.map((session) => {
            const saved = validateSession(session);
            return { id: typeof session.id === 'string' && ID_PATTERN.test(session.id) ? session.id : newId(), ...saved, savedAt: session.savedAt ?? now() };
          }),
        };
      });
      const data = read();
      let added = 0;
      let replaced = 0;
      for (const person of incoming) {
        const index = data.people.findIndex((existing) => existing.id === person.id);
        if (index >= 0) {
          data.people[index] = person;
          replaced += 1;
        } else {
          data.people.push(person);
          added += 1;
        }
      }
      write(data);
      return { added, replaced };
    }

    return {
      listPeople,
      getPerson,
      createPerson,
      updatePerson,
      deletePerson,
      addSession,
      exportBackup,
      importBackup,
    };
  }

  const LVST = Object.freeze({
    SHAPES,
    SHAPE_KEYS,
    RESPONSE_NONE,
    RESPONSE_UNSURE,
    RESPONSE_KEYS,
    ANSWERS,
    COLORS,
    BACKGROUNDS,
    COLOR_KEYS,
    BACKGROUND_KEYS,
    FILL_MODES,
    MOTION_PATTERNS,
    TEST_MODES,
    GENDERS,
    SIZE_LEVELS_DEG,
    LIMITS,
    secureRandom,
    pickOne,
    pixelsPerCm,
    degToPx,
    pxToDeg,
    pxPerSecToDegPerSec,
    outlinePoints,
    drawShape,
    gridPositions,
    layoutFit,
    arrangeShapes,
    createMotion,
    indexOfNearest,
    createStaircase,
    isCorrect,
    trialCounts,
    countsText,
    accuracyBySize,
    accuracyByShape,
    fixedThreshold,
    summarizeTrials,
    thresholdFor,
    ValidationError,
    validatePerson,
    validateSession,
    escapeHtml,
    csvCell,
    buildPersonReport,
    buildTrialsCsv,
    progressChartSvg,
    StoreError,
    NotFoundError,
    createRecordStore,
  });

  root.LVST = LVST;
})(typeof globalThis !== 'undefined' ? globalThis : window);
