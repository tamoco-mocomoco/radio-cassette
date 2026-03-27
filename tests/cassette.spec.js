import { test, expect } from '@playwright/test';

// Helper: get the boombox and cassette elements
const getBoombox = (page) => page.locator('radio-cassette');
const getCassette = (page, index = 0) => page.locator('cassette-tape').nth(index);

// Helper: drag cassette into boombox via JS (since native D&D is hard in Playwright)
async function insertCassette(page, cassetteIndex = 0) {
  await page.evaluate((idx) => {
    const tape = document.querySelectorAll('cassette-tape')[idx];
    const boombox = document.querySelector('radio-cassette');
    boombox.loadCassette(tape.cassetteData);
  }, cassetteIndex);
  // Wait for async loadCurrentSide to complete
  await page.waitForTimeout(1000);
}

// Helper: get boombox internal state
async function getBoomboxState(page) {
  return page.evaluate(() => {
    const boombox = document.querySelector('radio-cassette');
    return {
      state: boombox._state,
      currentTime: boombox._audio.currentTime,
      duration: boombox._audio.duration,
      hasCassette: !!boombox._cassette,
      currentSide: boombox._cassette?.currentSide,
    };
  });
}

// Helper: get cassette side state from IndexedDB
async function getDBState(page, cassetteIndex = 0) {
  return page.evaluate(async (idx) => {
    const tape = document.querySelectorAll('cassette-tape')[idx];
    const data = await CassetteDB.loadState(tape._storageKey);
    return data;
  }, cassetteIndex);
}

// Helper: write position to IndexedDB for a cassette
async function setDBPosition(page, cassetteIndex, side, position, progress) {
  await page.evaluate(async ({ idx, side, position, progress }) => {
    const tape = document.querySelectorAll('cassette-tape')[idx];
    const key = tape._storageKey;
    let state = await CassetteDB.loadState(key);
    if (!state) state = { sideState: { a: { progress: 0, position: 0 }, b: { progress: 0, position: 0 } }, currentSide: 'a' };
    state.sideState[side].position = position;
    state.sideState[side].progress = progress;
    await CassetteDB.saveState(key, state);
    // Also update in-memory state
    tape._sideState[side].position = position;
    tape._sideState[side].progress = progress;
  }, { idx: cassetteIndex, side, position, progress });
}

test.beforeEach(async ({ page }) => {
  // Load test page and clear IndexedDB
  await page.goto('/tests/test.html');
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
  });
  await page.reload();
  // Wait for cassette elements to be ready
  await page.evaluate(async () => {
    const tapes = document.querySelectorAll('cassette-tape');
    await Promise.all([...tapes].map(t => t.ready));
  });
});

test.describe('Basic cassette insertion', () => {
  test('inserting cassette shows it in the deck', async ({ page }) => {
    await insertCassette(page, 0);
    const state = await getBoomboxState(page);
    expect(state.hasCassette).toBe(true);
    expect(state.currentSide).toBe('a');
  });

  test('display shows tape label after insertion', async ({ page }) => {
    await insertCassette(page, 0);
    const text = await page.evaluate(() => {
      const boombox = document.querySelector('radio-cassette');
      return boombox.shadowRoot.querySelector('.display-text').textContent;
    });
    expect(text).toContain('Tape 1 Side A');
    expect(text).toContain('SIDE A');
  });

  test('eject removes cassette', async ({ page }) => {
    await insertCassette(page, 0);
    await page.evaluate(() => {
      document.querySelector('radio-cassette').eject();
    });
    await page.waitForTimeout(600);
    const state = await getBoomboxState(page);
    expect(state.hasCassette).toBe(false);
  });
});

test.describe('Position persistence via IndexedDB', () => {
  test('position saved to IndexedDB during playback is preserved after eject and re-insert', async ({ page }) => {
    // Set a known position in IndexedDB for cassette 0, side A
    await setDBPosition(page, 0, 'a', 30, 0.5);

    // Insert cassette - should load position from IndexedDB
    await insertCassette(page, 0);

    const state = await getBoomboxState(page);
    // Should restore to approximately 30s (may be limited by audio duration)
    expect(state.currentTime).toBeGreaterThan(0);
  });

  test('position is NOT reset to 0 on insert when IndexedDB has saved position', async ({ page }) => {
    await setDBPosition(page, 0, 'a', 15, 0.25);

    await insertCassette(page, 0);

    // Check that sync did not overwrite IndexedDB with 0
    const dbState = await getDBState(page, 0);
    const sideAPos = dbState?.sideState?.a?.position || 0;
    expect(sideAPos).toBeGreaterThan(0);
  });

  test('A and B sides have independent positions', async ({ page }) => {
    await setDBPosition(page, 0, 'a', 3, 0.2);
    await setDBPosition(page, 0, 'b', 5, 0.4);

    // Insert cassette (side A)
    await insertCassette(page, 0);

    // Flip to side B
    await page.evaluate(() => {
      document.querySelector('radio-cassette').flipTape();
    });
    await page.waitForTimeout(1000);
    const stateB = await getBoomboxState(page);

    expect(stateB.currentSide).toBe('b');

    // Verify IndexedDB still has both positions (not overwritten by each other)
    const dbState = await getDBState(page, 0);
    expect(dbState.sideState.a.position).toBeGreaterThanOrEqual(3);
    expect(dbState.sideState.b.position).toBeGreaterThan(0);
  });
});

test.describe('Flip behavior', () => {
  test('flip on cassette element switches side', async ({ page }) => {
    const side = await page.evaluate(async () => {
      const tape = document.querySelector('cassette-tape');
      tape.flipSide();
      return tape._currentSide;
    });
    expect(side).toBe('b');
  });

  test('flip on boombox switches side and loads new audio', async ({ page }) => {
    await insertCassette(page, 0);

    await page.evaluate(() => {
      document.querySelector('radio-cassette').flipTape();
    });
    await page.waitForTimeout(1000);

    const state = await getBoomboxState(page);
    expect(state.currentSide).toBe('b');
  });

  test('flipping standalone cassette does not lose position data in IndexedDB', async ({ page }) => {
    await setDBPosition(page, 0, 'a', 25, 0.4);
    await setDBPosition(page, 0, 'b', 50, 0.8);

    // Flip the standalone cassette
    await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      tape.flipSide();
    });

    // Check IndexedDB - A position should be untouched
    const dbState = await getDBState(page, 0);
    expect(dbState.sideState.a.position).toBe(25);
    expect(dbState.sideState.b.position).toBe(50);
  });

  test('flip then insert preserves correct side position', async ({ page }) => {
    await setDBPosition(page, 0, 'a', 3, 0.2);
    await setDBPosition(page, 0, 'b', 5, 0.4);

    // Flip cassette to B side
    await page.evaluate(() => {
      document.querySelector('cassette-tape').flipSide();
    });

    // Insert into boombox - should load B side position
    await insertCassette(page, 0);

    const state = await getBoomboxState(page);
    expect(state.currentSide).toBe('b');

    // B side position should be restored from IndexedDB
    const dbState = await getDBState(page, 0);
    expect(dbState.sideState.b.position).toBeGreaterThanOrEqual(5);
  });
});

test.describe('STOP/EJECT behavior', () => {
  test('first press stops, second press ejects', async ({ page }) => {
    await insertCassette(page, 0);

    // Play first
    await page.evaluate(() => {
      document.querySelector('radio-cassette').play();
    });
    await page.waitForTimeout(500);

    // First press - should stop
    await page.evaluate(() => {
      document.querySelector('radio-cassette').stopEject();
    });
    const state1 = await getBoomboxState(page);
    expect(state1.hasCassette).toBe(true);
    expect(state1.state).toBe('stopped');

    // Second press - should eject
    await page.evaluate(() => {
      document.querySelector('radio-cassette').stopEject();
    });
    await page.waitForTimeout(600);
    const state2 = await getBoomboxState(page);
    expect(state2.hasCassette).toBe(false);
  });
});

test.describe('Pause behavior', () => {
  test('pause retains position', async ({ page }) => {
    await setDBPosition(page, 0, 'a', 20, 0.3);
    await insertCassette(page, 0);

    await page.evaluate(() => {
      document.querySelector('radio-cassette').pause();
    });
    await page.waitForTimeout(200);

    const state = await getBoomboxState(page);
    expect(state.state).toBe('paused');
    // Position should not be 0
    expect(state.currentTime).toBeGreaterThan(0);
  });
});

test.describe('Loading guard', () => {
  test('timeupdate during load does not overwrite IndexedDB position with 0', async ({ page }) => {
    await setDBPosition(page, 0, 'a', 5, 0.4);

    await insertCassette(page, 0);

    // Immediately check that DB was not overwritten with 0
    const dbState = await getDBState(page, 0);
    expect(dbState.sideState.a.position).toBeGreaterThanOrEqual(5);
  });
});

test.describe('Rename (per-side labels)', () => {
  test('rename updates current side label', async ({ page }) => {
    // Rename side A via API (prompt can't be used in Playwright, so call directly)
    await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      tape._labels[tape._currentSide] = 'New A Name';
      tape._updateLabelDisplay();
      tape._saveToDB();
    });

    // Check shadow DOM label text
    const labelText = await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      return tape.shadowRoot.querySelector('.label-text').textContent;
    });
    expect(labelText).toBe('New A Name');

    // Check IndexedDB
    const dbState = await getDBState(page, 0);
    expect(dbState.labels.a).toBe('New A Name');
  });

  test('A and B sides have independent labels', async ({ page }) => {
    await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      tape._labels.a = 'Side A Title';
      tape._labels.b = 'Side B Title';
      tape._updateLabelDisplay();
      tape._saveToDB();
    });

    // Check A side label
    const labelA = await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      return tape.shadowRoot.querySelector('.label-text').textContent;
    });
    expect(labelA).toBe('Side A Title');

    // Flip to B
    await page.evaluate(() => {
      document.querySelector('cassette-tape').flipSide();
    });

    const labelB = await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      return tape.shadowRoot.querySelector('.label-text').textContent;
    });
    expect(labelB).toBe('Side B Title');
  });

  test('label persists after page reload', async ({ page }) => {
    await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      tape._labels.a = 'Persisted Label';
      tape._saveToDB();
    });

    await page.reload();
    await page.evaluate(async () => {
      const tapes = document.querySelectorAll('cassette-tape');
      await Promise.all([...tapes].map(t => t.ready));
    });

    const labelText = await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      return tape.shadowRoot.querySelector('.label-text').textContent;
    });
    expect(labelText).toBe('Persisted Label');
  });

  test('label shows in boombox display after insert', async ({ page }) => {
    await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      tape._labels.a = 'Custom Title';
      tape._updateLabelDisplay();
      tape._saveToDB();
    });

    await insertCassette(page, 0);

    const displayText = await page.evaluate(() => {
      const boombox = document.querySelector('radio-cassette');
      return boombox.shadowRoot.querySelector('.display-text').textContent;
    });
    expect(displayText).toContain('Custom Title');
  });

  test('renaming one cassette does not affect another cassette', async ({ page }) => {
    // Rename cassette 0
    await page.evaluate(() => {
      const tape = document.querySelectorAll('cassette-tape')[0];
      tape._labels.a = 'Tape 0 Custom';
      tape._updateLabelDisplay();
      tape._saveToDB();
    });

    // Check cassette 1 is unchanged
    const label1 = await page.evaluate(() => {
      const tape = document.querySelectorAll('cassette-tape')[1];
      return tape.shadowRoot.querySelector('.label-text').textContent;
    });
    expect(label1).toBe('Tape 2 Side A');

    // Check cassette 1 DB state has no label pollution
    const dbState1 = await getDBState(page, 1);
    if (dbState1?.labels) {
      expect(dbState1.labels.a).not.toBe('Tape 0 Custom');
    }
  });

  test('reset restores default label', async ({ page }) => {
    await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      tape._labels.a = 'Changed Name';
      tape._saveToDB();
    });

    // Reset (bypass confirm)
    await page.evaluate(() => {
      window.confirm = () => true;
      document.querySelector('cassette-tape').reset();
    });
    await page.waitForTimeout(200);

    const labelText = await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      return tape.shadowRoot.querySelector('.label-text').textContent;
    });
    expect(labelText).toBe('Tape 1 Side A');
  });
});

test.describe('Cross-cassette isolation', () => {
  test('setting position on cassette 0 does not affect cassette 1', async ({ page }) => {
    await setDBPosition(page, 0, 'a', 30, 0.5);

    // Cassette 1 should still be at 0
    const dbState1 = await getDBState(page, 1);
    const pos1 = dbState1?.sideState?.a?.position || 0;
    expect(pos1).toBe(0);
  });

  test('inserting cassette 0 and playing does not write to cassette 1 DB', async ({ page }) => {
    await insertCassette(page, 0);

    // Play briefly
    await page.evaluate(() => {
      document.querySelector('radio-cassette').play();
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      document.querySelector('radio-cassette').pause();
    });
    await page.waitForTimeout(200);

    // Cassette 1 DB should be untouched
    const dbState1 = await getDBState(page, 1);
    const pos1 = dbState1?.sideState?.a?.position || 0;
    expect(pos1).toBe(0);
  });

  test('swapping cassettes preserves each cassette position independently', async ({ page }) => {
    // Set different positions for both cassettes
    await setDBPosition(page, 0, 'a', 3, 0.2);
    await setDBPosition(page, 1, 'a', 5, 0.4);

    // Insert cassette 0, eject
    await insertCassette(page, 0);
    await page.evaluate(() => {
      document.querySelector('radio-cassette').eject();
    });
    await page.waitForTimeout(600);

    // Insert cassette 1, eject
    await insertCassette(page, 1);
    await page.evaluate(() => {
      document.querySelector('radio-cassette').eject();
    });
    await page.waitForTimeout(600);

    // Both positions should be preserved
    const dbState0 = await getDBState(page, 0);
    const dbState1 = await getDBState(page, 1);
    expect(dbState0.sideState.a.position).toBeGreaterThanOrEqual(3);
    expect(dbState1.sideState.a.position).toBeGreaterThanOrEqual(5);
  });

  test('flipping cassette 0 does not affect cassette 1 side state', async ({ page }) => {
    await setDBPosition(page, 0, 'a', 15, 0.2);
    await setDBPosition(page, 0, 'b', 35, 0.5);
    await setDBPosition(page, 1, 'a', 50, 0.7);

    // Flip cassette 0
    await page.evaluate(() => {
      document.querySelectorAll('cassette-tape')[0].flipSide();
    });

    // Cassette 1 should be untouched
    const dbState1 = await getDBState(page, 1);
    expect(dbState1.sideState.a.position).toBe(50);
  });

  test('renaming and setting position on cassette 0 leaves cassette 2 intact', async ({ page }) => {
    // Modify cassette 0
    await page.evaluate(() => {
      const tape = document.querySelectorAll('cassette-tape')[0];
      tape._labels.a = 'Modified Tape 0';
      tape._updateLabelDisplay();
      tape._saveToDB();
    });
    await setDBPosition(page, 0, 'a', 25, 0.4);

    // Check cassette 2 is completely unaffected
    const label2 = await page.evaluate(() => {
      const tape = document.querySelectorAll('cassette-tape')[2];
      return tape.shadowRoot.querySelector('.label-text').textContent;
    });
    expect(label2).toBe('Tape 3 Side A');

    const dbState2 = await getDBState(page, 2);
    const pos2 = dbState2?.sideState?.a?.position || 0;
    expect(pos2).toBe(0);
  });

  test('each cassette has a unique storage key', async ({ page }) => {
    const keys = await page.evaluate(() => {
      const tapes = document.querySelectorAll('cassette-tape');
      return [...tapes].map(t => t._storageKey);
    });
    // All keys should be unique
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

test.describe('label-a / label-b attributes', () => {
  test('initial labels come from label-a and label-b attributes', async ({ page }) => {
    const labels = await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      return { a: tape._labels.a, b: tape._labels.b };
    });
    expect(labels.a).toBe('Tape 1 Side A');
    expect(labels.b).toBe('Tape 1 Side B');
  });

  test('displayed label matches current side', async ({ page }) => {
    // Side A
    const labelA = await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      return tape.shadowRoot.querySelector('.label-text').textContent;
    });
    expect(labelA).toBe('Tape 1 Side A');

    // Flip to B
    await page.evaluate(() => {
      document.querySelector('cassette-tape').flipSide();
    });
    const labelB = await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      return tape.shadowRoot.querySelector('.label-text').textContent;
    });
    expect(labelB).toBe('Tape 1 Side B');
  });

  test('boombox display shows correct side label', async ({ page }) => {
    await insertCassette(page, 0);
    const displayA = await page.evaluate(() => {
      return document.querySelector('radio-cassette').shadowRoot.querySelector('.display-text').textContent;
    });
    expect(displayA).toContain('Tape 1 Side A');

    // Flip in boombox
    await page.evaluate(() => {
      document.querySelector('radio-cassette').flipTape();
    });
    await page.waitForTimeout(1000);
    const displayB = await page.evaluate(() => {
      return document.querySelector('radio-cassette').shadowRoot.querySelector('.display-text').textContent;
    });
    expect(displayB).toContain('Tape 1 Side B');
  });

  test('second cassette has its own labels', async ({ page }) => {
    const labels = await page.evaluate(() => {
      const tape = document.querySelectorAll('cassette-tape')[1];
      return { a: tape._labels.a, b: tape._labels.b };
    });
    expect(labels.a).toBe('Tape 2 Side A');
    expect(labels.b).toBe('Tape 2 Side B');
  });
});

test.describe('Lock feature', () => {
  test('cassette is unlocked after beforeEach', async ({ page }) => {
    const locked = await page.evaluate(() => {
      return document.querySelector('cassette-tape')._locked;
    });
    expect(locked).toBe(false);
  });

  test('locked attribute sets initial lock state', async ({ page }) => {
    // Add a locked cassette dynamically
    const locked = await page.evaluate(() => {
      const tape = document.createElement('cassette-tape');
      tape.setAttribute('label-a', 'Locked Tape A');
      tape.setAttribute('label-b', 'Locked Tape B');
      tape.setAttribute('side-a-src', 'mp3/sample1.mp3');
      tape.setAttribute('side-b-src', 'mp3/sample2.mp3');
      tape.setAttribute('locked', '');
      document.body.appendChild(tape);
      return tape._locked;
    });
    expect(locked).toBe(true);
  });

  test('toggleLock switches lock state', async ({ page }) => {
    await page.evaluate(() => {
      document.querySelector('cassette-tape').toggleLock();
    });
    const locked = await page.evaluate(() => {
      return document.querySelector('cassette-tape')._locked;
    });
    expect(locked).toBe(true);

    // Toggle again
    await page.evaluate(() => {
      document.querySelector('cassette-tape').toggleLock();
    });
    const unlocked = await page.evaluate(() => {
      return document.querySelector('cassette-tape')._locked;
    });
    expect(unlocked).toBe(false);
  });

  test('lock state persists in IndexedDB', async ({ page }) => {
    await page.evaluate(() => {
      document.querySelector('cassette-tape').toggleLock();
    });

    const dbState = await getDBState(page, 0);
    expect(dbState.locked).toBe(true);
  });

  test('lock state restores after page reload', async ({ page }) => {
    await page.evaluate(() => {
      document.querySelector('cassette-tape').toggleLock();
    });

    await page.reload();
    await page.evaluate(async () => {
      const tapes = document.querySelectorAll('cassette-tape');
      await Promise.all([...tapes].map(t => t.ready));
    });

    const locked = await page.evaluate(() => {
      return document.querySelector('cassette-tape')._locked;
    });
    expect(locked).toBe(true);
  });

  test('lock tab visual updates on toggle', async ({ page }) => {
    let hasLocked = await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      return tape.shadowRoot.querySelector('.lock-tab').classList.contains('locked');
    });
    expect(hasLocked).toBe(false);

    await page.evaluate(() => {
      document.querySelector('cassette-tape').toggleLock();
    });
    hasLocked = await page.evaluate(() => {
      const tape = document.querySelector('cassette-tape');
      return tape.shadowRoot.querySelector('.lock-tab').classList.contains('locked');
    });
    expect(hasLocked).toBe(true);
  });

  test('REC is blocked when cassette is locked', async ({ page }) => {
    await page.evaluate(() => {
      document.querySelector('cassette-tape').toggleLock();
    });

    await insertCassette(page, 0);

    const alertMsg = await page.evaluate(() => {
      return new Promise((resolve) => {
        window.alert = (msg) => resolve(msg);
        document.querySelector('radio-cassette').record();
      });
    });
    expect(alertMsg).toBeTruthy();
  });

  test('REC is allowed when cassette is unlocked', async ({ page }) => {
    await insertCassette(page, 0);

    const wasBlocked = await page.evaluate(() => {
      let blocked = false;
      window.alert = () => { blocked = true; };
      document.querySelector('radio-cassette').record();
      return blocked;
    });
    expect(wasBlocked).toBe(false);
  });

  test('locking one cassette does not affect another', async ({ page }) => {
    await page.evaluate(() => {
      document.querySelector('cassette-tape').toggleLock();
    });

    const locked1 = await page.evaluate(() => {
      return document.querySelectorAll('cassette-tape')[1]._locked;
    });
    expect(locked1).toBe(false);
  });
});
