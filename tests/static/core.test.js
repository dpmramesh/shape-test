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
    assert.match(lines[1], /,circle,circle,yes,/);
    assert.match(lines[2], /,square,none,no,/);
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
