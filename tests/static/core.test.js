// Tests for the static app's shared logic (docs/js/core.js). Uses fake storage, never real browser data.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../../docs/js/core.js';

const L = globalThis.LVST;

// In-memory stand-in for window.localStorage.
function fakeStorage({ failWrites = false } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      if (failWrites) {
        throw new Error('QuotaExceededError (fake)');
      }
      data.set(key, String(value));
    },
    removeItem: (key) => data.delete(key),
  };
}

let counter = 0;
const idSource = () => `id-${String(++counter).padStart(6, '0')}-test`;
const fixedNow = () => '2026-02-01T10:00:00.000Z';

const PERSON = Object.freeze({
  name: 'Fake Person',
  age: 70,
  gender: 'other',
  visionLevel: 'Fake vision level',
  issues: 'Fake issue',
  notes: 'Fake note',
});

function sampleSession(overrides = {}) {
  return {
    mode: 'fixed',
    startedAt: '2026-02-01T10:00:00.000Z',
    endedAt: '2026-02-01T10:05:00.000Z',
    threshold: null,
    settings: {
      shapes: ['circle', 'square'],
      fill: 'filled',
      color: 'yellow',
      background: 'black',
      pattern: 'bounce',
      speed: 150,
      viewingDistanceCm: 300,
      screenWidthCm: 120,
      screenWidthPx: 1920,
      fixedSizeDeg: 5,
    },
    trials: [
      { sizeDeg: 5, target: 'circle', response: 'circle', filled: true, color: 'yellow', background: 'black', pattern: 'bounce', speed: 150, responseMs: 900 },
      { sizeDeg: 5, target: 'square', response: 'none', filled: true, color: 'yellow', background: 'black', pattern: 'bounce', speed: 150, responseMs: 2000 },
    ],
    ...overrides,
  };
}

function newStore(storage = fakeStorage()) {
  return { storage, store: L.createRecordStore(storage, { now: fixedNow, newId: idSource }) };
}

describe('geometry and shapes', () => {
  test('degToPx and pxToDeg are inverses', () => {
    const px = L.degToPx(4, 250, 12.5);
    assert.ok(Math.abs(L.pxToDeg(px, 250, 12.5) - 4) < 1e-9);
  });

  test('every shape fits its bounding box', () => {
    for (const key of L.SHAPE_KEYS) {
      const points = L.outlinePoints(key, 60);
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      assert.ok(Math.max(...xs) - Math.min(...xs) <= 60 + 1e-6, key);
      assert.ok(Math.max(...ys) - Math.min(...ys) <= 60 + 1e-6, key);
    }
  });

  test('unknown shape is rejected', () => {
    assert.throws(() => L.outlinePoints('blob', 10), RangeError);
  });
});

describe('motion with live speed changes', () => {
  function seeded(seed = 0.4) {
    let value = seed;
    return () => {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280;
    };
  }

  test('setSpeed changes the distance covered on the next step', () => {
    const motion = L.createMotion({ width: 1000, height: 1000, size: 10, speed: 100, pattern: 'bounce', rng: () => 0.5 });
    motion.setSpeed(300);
    const start = motion.position;
    const after = motion.step(0.1);
    assert.ok(Math.abs(Math.hypot(after.x - start.x, after.y - start.y) - 30) < 1e-6);
    assert.equal(motion.speed, 300);
  });

  test('speed can be set to zero and back without losing direction', () => {
    const motion = L.createMotion({ width: 1000, height: 1000, size: 10, speed: 100, pattern: 'bounce', rng: () => 0.5 });
    motion.setSpeed(0);
    const still = motion.step(0.5);
    assert.deepEqual(still, motion.position);
    motion.setSpeed(100);
    const moved = motion.step(0.1);
    assert.ok(moved.x < still.x, 'still moving in the original direction');
  });

  for (const pattern of ['bounce', 'sweep', 'orbit', 'wander']) {
    test(`${pattern} stays on screen after a speed increase`, () => {
      const motion = L.createMotion({ width: 800, height: 600, size: 80, speed: 100, pattern, rng: seeded() });
      motion.setSpeed(1000);
      for (let i = 0; i < 3000; i += 1) {
        const { x, y } = motion.step(1 / 60);
        assert.ok(x >= 40 - 1e-6 && x <= 760 + 1e-6, `${pattern} x=${x}`);
        assert.ok(y >= 40 - 1e-6 && y <= 560 + 1e-6, `${pattern} y=${y}`);
      }
    });
  }

  test('invalid speed is rejected', () => {
    const motion = L.createMotion({ width: 100, height: 100, size: 10, speed: 1, rng: () => 0.5 });
    assert.throws(() => motion.setSpeed(-1), RangeError);
    assert.throws(() => motion.setSpeed(Number.NaN), RangeError);
  });
});

describe('staircase with manual nudges', () => {
  test('nudge moves the level without recording a reversal', () => {
    const stair = L.createStaircase({ startDeg: 10 });
    const before = stair.currentDeg();
    stair.nudge(-1); // bigger
    assert.equal(stair.currentDeg(), 15);
    assert.notEqual(stair.currentDeg(), before);
    assert.deepEqual(stair.reversals, []);
  });

  test('nudge is clamped at the ends of the scale', () => {
    const stair = L.createStaircase({ startDeg: 30 });
    stair.nudge(-5);
    assert.equal(stair.currentDeg(), 30);
  });
});

describe('summaries', () => {
  test('correctness comes from the response, not a stored flag', () => {
    assert.equal(L.isCorrect({ target: 'star', response: 'star' }), true);
    assert.equal(L.isCorrect({ target: 'star', response: 'none' }), false);
  });

  test('summarizeTrials counts correct answers', () => {
    const summary = L.summarizeTrials(sampleSession().trials);
    assert.equal(summary.correctCount, 1);
    assert.equal(summary.accuracy, 0.5);
  });
});

describe('validation', () => {
  test('happy path: a session keeps the per-trial speed', () => {
    const session = L.validateSession(sampleSession());
    assert.equal(session.trials[0].speed, 150);
    assert.equal(session.trials[0].correct, true);
  });

  test('invalid: bad person name', () => {
    assert.throws(() => L.validatePerson({ name: '' }), (err) => err instanceof L.ValidationError && err.details.length > 0);
  });

  test('invalid: session with an unknown shape in a trial', () => {
    const session = sampleSession();
    session.trials[0].target = 'blob';
    assert.throws(() => L.validateSession(session), L.ValidationError);
  });

  test('invalid: session with end before start', () => {
    assert.throws(() => L.validateSession(sampleSession({ endedAt: '2026-01-01T00:00:00Z' })), L.ValidationError);
  });
});

describe('reports and CSV', () => {
  test('HTML report escapes user text', () => {
    const html = L.buildPersonReport({ ...PERSON, name: '<img src=x onerror=alert(1)>', sessions: [] });
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&lt;img src=x/);
  });

  test('CSV neutralises spreadsheet formulas', () => {
    assert.ok(L.csvCell('=HYPERLINK("x")').includes("'=HYPERLINK"));
  });

  test('CSV has one row per trial with speed in it', () => {
    const csv = L.buildTrialsCsv({ ...PERSON, sessions: [{ id: 's1', ...sampleSession() }] });
    const lines = csv.trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /speed_px_per_s/);
    assert.match(lines[1], /,circle:1,circle:1,yes,/);
    assert.match(lines[2], /,square:1,none,no,/);
  });

  test('CSV shows every shape type and its count for a multi-shape trial', () => {
    const trial = sampleSession().trials[0];
    const multi = { ...trial, targets: { star: 5, circle: 5 }, counts: { star: 5, circle: 4 }, answer: 'counted' };
    delete multi.target;
    delete multi.response;
    const csv = L.buildTrialsCsv({ ...PERSON, sessions: [{ id: 's3', ...sampleSession({ trials: [multi] }) }] });
    const lines = csv.trim().split('\r\n');
    assert.match(lines[0], /^session_id,session_started,mode,trial,shapes_shown,answer,correct,/);
    // Shapes are listed in the app's shape order, so circle comes before star.
    assert.match(lines[1], /,circle:5;star:5,circle:4;star:5,no,/);
  });
});

describe('multiple shapes per trial', () => {
  const exact = { targets: { star: 5, circle: 5 }, counts: { star: 5, circle: 5 }, answer: 'counted' };
  const minGap = (points) => {
    let best = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        best = Math.min(best, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
      }
    }
    return best;
  };

  test('one shape type with a count of 5 gives 5 shapes of that type', () => {
    const placed = L.arrangeShapes([{ key: 'star', count: 5 }], 1000, 800, 60, () => 0.3);
    assert.equal(placed.length, 5);
    assert.ok(placed.every((item) => item.key === 'star'));
  });

  test('two shape types with a count of 5 give 5 of each', () => {
    const placed = L.arrangeShapes([{ key: 'star', count: 5 }, { key: 'circle', count: 5 }], 1000, 800, 60);
    assert.equal(placed.filter((item) => item.key === 'star').length, 5);
    assert.equal(placed.filter((item) => item.key === 'circle').length, 5);
  });

  test('a count of 20 keeps every shape fully on screen', () => {
    const placed = L.arrangeShapes([{ key: 'heart', count: 20 }], 800, 600, 50);
    for (const { x, y } of placed) {
      assert.ok(x >= 25 - 1e-9 && x <= 775 + 1e-9, `x=${x}`);
      assert.ok(y >= 25 - 1e-9 && y <= 575 + 1e-9, `y=${y}`);
    }
  });

  test('the grid spreads shapes as far apart as it can', () => {
    // Four shapes on a 1000 x 1000 stage: a 2 x 2 grid of 500 x 500 cells beats a 1 x 4 row (cells of 250).
    assert.equal(Math.round(minGap(L.gridPositions(4, 1000, 1000, 100))), 500);
  });

  test('shapes are spread evenly: the same margin at each edge and the same space between rows', () => {
    // Six shapes on a wide stage: three in each row, each in the middle of its cell.
    const placed = L.gridPositions(6, 1800, 800, 60);
    const xs = [...new Set(placed.map((p) => Math.round(p.x)))];
    const ys = [...new Set(placed.map((p) => Math.round(p.y)))];
    assert.deepEqual(xs, [300, 900, 1500]);
    assert.deepEqual(ys, [200, 600]);
  });

  test('a short last row is centred, so the layout stays symmetric', () => {
    const placed = L.gridPositions(5, 1000, 600, 40);
    const xs = placed.map((p) => p.x);
    assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs) - 1000) < 1e-9);
  });

  test('no two shapes overlap when there is room for them', () => {
    for (let count = 1; count <= 20; count += 1) {
      const placed = L.gridPositions(count, 1280, 800, 30);
      if (count > 1) {
        assert.ok(minGap(placed) >= 30, `count ${count}`);
      }
    }
  });

  test('layoutFit says whether shapes can be drawn without overlap, before drawing', () => {
    assert.deepEqual(L.layoutFit(4, 1000, 1000, 100), { fits: true, reason: null });
    assert.deepEqual(L.layoutFit(20, 800, 600, 300), { fits: false, reason: 'overlap' });
    assert.deepEqual(L.layoutFit(1, 800, 600, 700), { fits: false, reason: 'too-big' });
    assert.deepEqual(L.layoutFit(1, 800, 600, 600), { fits: true, reason: null });
  });

  test('touching shapes are refused: a gap of a quarter of the size is kept', () => {
    // Two shapes of 100 on a 200 x 100 stage touch with no gap, so they do not fit.
    assert.deepEqual(L.layoutFit(2, 200, 100, 100), { fits: false, reason: 'overlap' });
    assert.deepEqual(L.layoutFit(2, 300, 100, 100), { fits: true, reason: null });
  });

  test('when layoutFit says shapes fit, the drawn layout keeps the gap', () => {
    for (const count of [2, 3, 5, 8, 13, 20]) {
      for (const size of [20, 40, 60, 90, 120]) {
        if (L.layoutFit(count, 800, 600, size).fits) {
          const placed = L.gridPositions(count, 800, 600, size);
          assert.ok(minGap(placed) >= size * 1.25 - 1e-9, `count ${count} size ${size}`);
        }
      }
    }
  });

  test('a single shape is centred', () => {
    assert.deepEqual(L.gridPositions(1, 800, 600, 60), [{ x: 400, y: 300 }]);
  });

  test('a shape too big for the stage sits in the middle, as before', () => {
    assert.deepEqual(L.gridPositions(2, 100, 100, 300), [{ x: 50, y: 50 }, { x: 50, y: 50 }]);
  });

  test('an invalid count or unknown shape is rejected by the layout', () => {
    assert.throws(() => L.arrangeShapes([{ key: 'star', count: 0 }], 100, 100, 10), RangeError);
    assert.throws(() => L.arrangeShapes([{ key: 'star', count: 21 }], 100, 100, 10), RangeError);
    assert.throws(() => L.arrangeShapes([{ key: 'blob', count: 2 }], 100, 100, 10), RangeError);
    assert.throws(() => L.arrangeShapes([], 100, 100, 10), RangeError);
  });

  test('a shape starts at its layout position and moves from there', () => {
    for (const pattern of ['bounce', 'sweep', 'wander']) {
      const motion = L.createMotion({ width: 800, height: 600, size: 60, speed: 100, pattern, start: { x: 200, y: 150 }, rng: () => 0.5 });
      assert.deepEqual(motion.position, { x: 200, y: 150 }, pattern);
    }
    const orbit = L.createMotion({ width: 800, height: 600, size: 60, speed: 100, pattern: 'orbit', start: { x: 600, y: 300 }, rng: () => 0.5 });
    assert.ok(Math.abs(orbit.position.x - 600) < 1e-6 && Math.abs(orbit.position.y - 300) < 1e-6);
  });

  test('an orbit shape starting near an edge moves onto the largest orbit that stays on screen', () => {
    // Centre (400, 300); the largest orbit that keeps size 60 on screen has radius 270. A start at x = 30 is radius 370.
    const orbit = L.createMotion({ width: 800, height: 600, size: 60, speed: 100, pattern: 'orbit', start: { x: 30, y: 300 }, rng: () => 0.5 });
    assert.ok(Math.abs(orbit.position.x - 130) < 1e-6 && Math.abs(orbit.position.y - 300) < 1e-6);
    for (let i = 0; i < 2000; i += 1) {
      const { x, y } = orbit.step(1 / 60);
      assert.ok(x >= 30 - 1e-6 && x <= 770 + 1e-6 && y >= 30 - 1e-6 && y <= 570 + 1e-6, `x=${x} y=${y}`);
    }
  });

  test('a correct answer names every shape type with its exact count', () => {
    assert.equal(L.isCorrect(exact), true);
  });

  test('a wrong count, a missing type, an extra type or "nothing seen" is not correct', () => {
    assert.equal(L.isCorrect({ ...exact, counts: { star: 4, circle: 5 } }), false);
    assert.equal(L.isCorrect({ ...exact, counts: { star: 5 } }), false);
    assert.equal(L.isCorrect({ ...exact, counts: { star: 5, circle: 5, square: 1 } }), false);
    assert.equal(L.isCorrect({ ...exact, counts: {}, answer: 'none' }), false);
  });

  test('accuracy by shape counts each shape type in a trial separately', () => {
    const trials = [
      { ...exact, sizeDeg: 5 },
      { ...exact, counts: { star: 4, circle: 5 }, sizeDeg: 5 },
    ];
    const rows = Object.fromEntries(L.accuracyByShape(trials).map((row) => [row.shape, row]));
    assert.deepEqual([rows.star.shown, rows.star.correct], [2, 1]);
    assert.deepEqual([rows.circle.shown, rows.circle.correct], [2, 2]);
  });

  test('a trial with counts validates, keeps its counts and is marked correct', () => {
    const session = L.validateSession(sampleSession({ trials: [{ ...exact, sizeDeg: 5, filled: true, color: 'yellow', background: 'black', shownAt: '2026-02-01T10:00:01.000Z' }] }));
    assert.equal(session.trials[0].correct, true);
    assert.deepEqual(session.trials[0].targets, { star: 5, circle: 5 });
  });

  test('invalid: a count of 0 or 21 in a trial is rejected', () => {
    const zero = { ...exact, targets: { star: 0, circle: 5 } };
    const tooMany = { ...exact, targets: { star: 21, circle: 5 } };
    assert.throws(() => L.validateSession(sampleSession({ trials: [{ ...zero, sizeDeg: 5, filled: true, color: 'yellow', background: 'black' }] })), L.ValidationError);
    assert.throws(() => L.validateSession(sampleSession({ trials: [{ ...tooMany, sizeDeg: 5, filled: true, color: 'yellow', background: 'black' }] })), L.ValidationError);
  });

  test('invalid: an unknown shape in counts, or a missing answer, is rejected', () => {
    const base = { sizeDeg: 5, filled: true, color: 'yellow', background: 'black' };
    assert.throws(() => L.validateSession(sampleSession({ trials: [{ ...base, ...exact, counts: { blob: 1 } }] })), L.ValidationError);
    assert.throws(() => L.validateSession(sampleSession({ trials: [{ ...base, targets: exact.targets, counts: exact.counts }] })), L.ValidationError);
  });

  test('the count setting accepts 1 to 20 and rejects 21', () => {
    const settings = sampleSession().settings;
    assert.equal(L.validateSession(sampleSession({ settings: { ...settings, count: 20 } })).settings.count, 20);
    assert.throws(() => L.validateSession(sampleSession({ settings: { ...settings, count: 21 } })), L.ValidationError);
  });

  test('the HTML report shows the count per shape', () => {
    const session = { id: 's4', ...sampleSession({ settings: { ...sampleSession().settings, count: 3 } }) };
    const html = L.buildPersonReport({ ...PERSON, sessions: [session] });
    assert.match(html, /Count per shape<\/dt><dd>3</);
  });
});

describe('record store (browser storage)', () => {
  beforeEach(() => {
    counter = 0;
  });

  test('happy path: create, read, update, add a session, and delete', () => {
    const { store } = newStore();
    const created = store.createPerson(PERSON);
    assert.equal(created.id, 'id-000001-test');
    assert.equal(store.getPerson(created.id).name, 'Fake Person');

    const updated = store.updatePerson(created.id, { ...PERSON, age: 71 });
    assert.equal(updated.age, 71);
    assert.equal(updated.createdAt, created.createdAt);

    const saved = store.addSession(created.id, sampleSession());
    assert.ok(saved.id);
    assert.equal(saved.savedAt, fixedNow());
    assert.equal(store.getPerson(created.id).sessions.length, 1);
    assert.equal(store.listPeople()[0].sessionCount, 1);

    store.deletePerson(created.id);
    assert.deepEqual(store.listPeople(), []);
  });

  test('invalid: creating a person without a name is rejected and nothing is saved', () => {
    const { store, storage } = newStore();
    assert.throws(() => store.createPerson({ age: 40 }), L.ValidationError);
    assert.equal(storage.data.size, 0);
  });

  test('invalid: a session with a bad mode is rejected and not saved', () => {
    const { store } = newStore();
    const person = store.createPerson(PERSON);
    assert.throws(() => store.addSession(person.id, sampleSession({ mode: 'magic' })), L.ValidationError);
    assert.equal(store.getPerson(person.id).sessions.length, 0);
  });

  test('missing person: get, update, delete and addSession report not found', () => {
    const { store } = newStore();
    const id = 'does-not-exist-1';
    assert.throws(() => store.getPerson(id), L.NotFoundError);
    assert.throws(() => store.updatePerson(id, PERSON), L.NotFoundError);
    assert.throws(() => store.deletePerson(id), L.NotFoundError);
    assert.throws(() => store.addSession(id, sampleSession()), L.NotFoundError);
  });

  test('failure: damaged saved data gives a clear error instead of silently emptying', () => {
    const storage = fakeStorage();
    storage.setItem('lowVisionShapeTest.records.v1', '{not json');
    const { store } = newStore(storage);
    assert.throws(() => store.listPeople(), (err) => err instanceof L.StoreError && /damaged/.test(err.message));
  });

  test('failure: a full browser storage gives an error and keeps the old data', () => {
    const storage = fakeStorage();
    const { store } = newStore(storage);
    store.createPerson(PERSON);
    const before = storage.getItem('lowVisionShapeTest.records.v1');
    storage.setItem = () => {
      throw new Error('QuotaExceededError (fake)');
    };
    assert.throws(() => store.createPerson({ name: 'Second' }), (err) => err instanceof L.StoreError && /full/.test(err.message));
    assert.equal(storage.getItem('lowVisionShapeTest.records.v1'), before);
  });

  test('backup round trip restores people and sessions into empty storage', () => {
    const source = newStore();
    const person = source.store.createPerson(PERSON);
    source.store.addSession(person.id, sampleSession());
    const backup = source.store.exportBackup();

    const target = newStore();
    const result = target.store.importBackup(backup);
    assert.deepEqual(result, { added: 1, replaced: 0 });
    const restored = target.store.getPerson(person.id);
    assert.equal(restored.sessions.length, 1);
    assert.equal(restored.name, 'Fake Person');
  });

  test('importing the same backup again replaces rather than duplicates', () => {
    const { store } = newStore();
    const person = store.createPerson(PERSON);
    const backup = store.exportBackup();
    const result = store.importBackup(backup);
    assert.deepEqual(result, { added: 0, replaced: 1 });
    assert.equal(store.listPeople().length, 1);
    assert.equal(store.listPeople()[0].id, person.id);
  });

  test('invalid: a file that is not from this app is rejected', () => {
    const { store } = newStore();
    assert.throws(() => store.importBackup('{"people": []}'), (err) => err instanceof L.StoreError && /not a backup/.test(err.message));
  });

  test('invalid: a file that is not JSON is rejected', () => {
    const { store } = newStore();
    assert.throws(() => store.importBackup('hello'), (err) => err instanceof L.StoreError && /not valid JSON/.test(err.message));
  });

  test('failure: a backup with one bad record changes nothing', () => {
    const { store, storage } = newStore();
    store.createPerson(PERSON);
    const before = storage.getItem('lowVisionShapeTest.records.v1');
    const badBackup = JSON.stringify({
      app: 'shape-test',
      people: [{ id: 'valid-id-0001', name: 'Good' }, { id: 'valid-id-0002', name: '' }],
    });
    assert.throws(() => store.importBackup(badBackup), L.ValidationError);
    assert.equal(storage.getItem('lowVisionShapeTest.records.v1'), before);
  });

  test('invalid: a person id with unsafe characters is rejected', () => {
    const { store } = newStore();
    const badBackup = JSON.stringify({
      app: 'shape-test',
      people: [{ id: '../../etc', name: 'Bad id' }],
    });
    assert.throws(() => store.importBackup(badBackup), (err) => err instanceof L.StoreError && /invalid id/.test(err.message));
  });
});
