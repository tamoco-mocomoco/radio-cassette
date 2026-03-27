// ============================================================
// IndexedDB helper - stores cassette state & audio blobs
// ============================================================

const CassetteDB = (() => {
  const DB_NAME = 'radio-cassette';
  const DB_VERSION = 1;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('state')) {
          db.createObjectStore('state');
        }
        if (!db.objectStoreNames.contains('audio')) {
          db.createObjectStore('audio');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(store, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(store, key, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  const api = {
    saveState: (key, state) => put('state', key, state),
    loadState: (key) => get('state', key),
    saveAudio: (key, blob) => put('audio', key, blob),
    loadAudio: (key) => get('audio', key),
  };
  // Expose for testing
  window.CassetteDB = api;
  return api;
})();


// ============================================================
// Locale helper
// ============================================================

const _isJa = navigator.language.startsWith('ja');
const _L = (en, ja) => _isJa ? ja : en;


// ============================================================
// <cassette-tape> - Draggable cassette tape element
// ============================================================

class CassetteTape extends HTMLElement {
  static get observedAttributes() {
    return ['side-a-src', 'side-b-src', 'label-a', 'label-b', 'current-side', 'color'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._currentSide = 'a';
    this._flipping = false;
    this._sideState = { a: { progress: 0, position: 0 }, b: { progress: 0, position: 0 } };
    this._labels = { a: '', b: '' };
    this._locked = false;
    this._ready = false;
    this.ready = new Promise(r => { this._resolveReady = r; });
  }

  async connectedCallback() {
    if (!this.id) this.id = 'cassette-' + Math.random().toString(36).slice(2, 8);
    this._currentSide = this.getAttribute('current-side') || 'a';
    this._labels = {
      a: this.getAttribute('label-a') || 'Untitled',
      b: this.getAttribute('label-b') || 'Untitled',
    };
    // Fix storage key at connect time from initial attributes (never changes)
    const aSrc = this.getAttribute('side-a-src') || '';
    const bSrc = this.getAttribute('side-b-src') || '';
    this._fixedStorageKey = `${this._labels.a}:${aSrc}:${bSrc}`;
    this._locked = this.hasAttribute('locked');
    this.draggable = true;

    // Render hidden, load from DB, then show
    this._render();
    this.style.visibility = 'hidden';
    await this._loadFromDB();
    this._updateTapeVisual();
    this._updateSideLabel();
    this._updateLabelDisplay();
    this.style.visibility = '';
    this._ready = true;
    this._resolveReady();

    this._setupDrag();
    this._setupFlip();
  }

  attributeChangedCallback(name) {
    if (name === 'current-side' && !this._flipping) {
      this._currentSide = this.getAttribute('current-side') || 'a';
    }
  }

  // --- Storage key ---

  get _storageKey() {
    return this._fixedStorageKey;
  }

  // --- DB read/write ---

  _saveToDB() {
    CassetteDB.saveState(this._storageKey, {
      sideState: this._sideState,
      currentSide: this._currentSide,
      labels: this._labels,
      locked: this._locked,
    }).catch(() => {});
  }

  async _loadFromDB() {
    try {
      const data = await CassetteDB.loadState(this._storageKey);
      if (!data) return;
      if (data.sideState) this._sideState = data.sideState;
      if (data.currentSide) this._currentSide = data.currentSide;
      if (data.labels) this._labels = data.labels;
      if (data.locked != null) this._locked = data.locked;
      this._updateLabelDisplay();
      this._updateLockDisplay();
    } catch (_) {}
  }

  async saveAudio(side, blob) {
    await CassetteDB.saveAudio(`${this._storageKey}:side-${side}`, blob);
  }

  async getAudioUrl(side) {
    const blob = await CassetteDB.loadAudio(`${this._storageKey}:side-${side}`);
    if (blob) return URL.createObjectURL(blob);
    return side === 'a'
      ? this.getAttribute('side-a-src') || ''
      : this.getAttribute('side-b-src') || '';
  }

  // --- Public API for boombox ---

  get cassetteData() {
    return {
      sideASrc: this.getAttribute('side-a-src') || '',
      sideBSrc: this.getAttribute('side-b-src') || '',
      label: this._labels[this._currentSide] || 'Untitled',
      currentSide: this._currentSide,
      color: this.getAttribute('color') || '#c8b89a',
      elementId: this.id,
      storageKey: this._storageKey,
      locked: this._locked,
    };
  }

  updateSideProgress(side, progress, position) {
    this._sideState[side].progress = progress;
    this._sideState[side].position = position;
    if (side === this._currentSide) this._updateTapeVisual();
    this._saveToDB();
  }

  getPositionForSide(side) {
    return this._sideState[side]?.position || 0;
  }

  flipSide() {
    this._currentSide = this._currentSide === 'a' ? 'b' : 'a';
    this._updateTapeVisual();
    this._updateSideLabel();
    this._updateLabelDisplay();
    this._saveToDB();
    return this._currentSide;
  }

  // --- Cassette UI flip (standalone) ---

  flip() {
    if (this._flipping) return;
    this._flipping = true;

    const cassette = this.shadowRoot.querySelector('.cassette');
    cassette.classList.add('flipping');

    setTimeout(() => {
      this.flipSide();
      cassette.classList.remove('flipping');
      this._flipping = false;
    }, 400);

    this.dispatchEvent(new CustomEvent('cassette-flip', {
      bubbles: true, composed: true,
      detail: { currentSide: this._currentSide },
    }));
  }

  // --- Visual ---

  _updateSideLabel() {
    const sideEl = this.shadowRoot?.querySelector('.side-indicator');
    if (sideEl) sideEl.textContent = `SIDE ${this._currentSide.toUpperCase()}`;
  }

  _updateTapeVisual() {
    const progress = this._sideState[this._currentSide]?.progress || 0;
    const minSize = 17;
    const maxSize = 32;
    const range = maxSize - minSize;
    const leftSize = maxSize - (progress * range);
    const rightSize = minSize + (progress * range);

    const left = this.shadowRoot?.querySelector('.tape-left');
    const right = this.shadowRoot?.querySelector('.tape-right');
    if (left) left.style.setProperty('--tape-size', `${leftSize}px`);
    if (right) right.style.setProperty('--tape-size', `${rightSize}px`);
  }

  _setupDrag() {
    // Native drag & drop (desktop)
    this.addEventListener('dragstart', (e) => {
      const data = this.cassetteData;
      e.dataTransfer.setData('application/x-cassette-tape', JSON.stringify(data));
      e.dataTransfer.effectAllowed = 'copy';
      this.shadowRoot.querySelector('.cassette').classList.add('dragging');
    });

    this.addEventListener('dragend', () => {
      this.shadowRoot.querySelector('.cassette').classList.remove('dragging');
    });

    // Touch drag (mobile / devtools touch simulation)
    let ghost = null;
    let startX, startY, moved;

    this.addEventListener('touchstart', (e) => {
      if (this._flipping) return;
      moved = false;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
    }, { passive: true });

    this.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 10) return;
      moved = true;
      e.preventDefault();

      if (!ghost) {
        const rect = this.getBoundingClientRect();
        ghost = this.cloneNode(true);
        ghost.style.cssText = `position:fixed;pointer-events:none;opacity:0.7;z-index:9999;width:${rect.width}px;height:${rect.height}px;`;
        ghost._offsetX = rect.width / 2;
        ghost._offsetY = rect.height / 2;
        document.body.appendChild(ghost);
        this.shadowRoot.querySelector('.cassette').classList.add('dragging');
      }
      ghost.style.left = `${touch.clientX - ghost._offsetX}px`;
      ghost.style.top = `${touch.clientY - ghost._offsetY}px`;
    }, { passive: false });

    this.addEventListener('touchend', (e) => {
      this.shadowRoot.querySelector('.cassette').classList.remove('dragging');
      if (!ghost) return;
      ghost.remove();
      ghost = null;

      const touch = e.changedTouches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const deck = target?.closest('radio-cassette');
      if (deck) {
        deck.loadCassette(this.cassetteData);
      }
    });
  }

  _setupFlip() {
    this.shadowRoot.querySelector('.cassette').addEventListener('dblclick', () => {
      this.flip();
    });
    this.shadowRoot.querySelector('.flip-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.flip();
    });
    this.shadowRoot.querySelector('.reset-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.reset();
    });
    this.shadowRoot.querySelector('.rename-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.rename();
    });
    this.shadowRoot.querySelector('.lock-area')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleLock();
    });
  }

  toggleLock() {
    this._locked = !this._locked;
    this._updateLockDisplay();
    this._saveToDB();
  }

  _updateLockDisplay() {
    const tab = this.shadowRoot?.querySelector('.lock-tab');
    if (tab) tab.classList.toggle('locked', this._locked);
  }

  rename() {
    const current = this._labels[this._currentSide] || 'Untitled';
    const side = this._currentSide.toUpperCase();
    const msg = _L(`Enter name for side ${side}:`, `SIDE ${side} の名前を入力:`);
    const name = prompt(msg, current);
    if (name === null || name === current) return;
    this._labels[this._currentSide] = name;
    this._updateLabelDisplay();
    this._saveToDB();
  }

  _updateLabelDisplay() {
    const labelEl = this.shadowRoot?.querySelector('.label-text');
    if (labelEl) labelEl.textContent = this._labels[this._currentSide] || 'Untitled';
  }

  async reset() {
    const msg = _L('Reset this tape? All uploaded audio and position will be cleared.', 'このテープをリセットしますか？アップロードした音声と再生位置がクリアされます。');
    if (!confirm(msg)) return;
    this._sideState = { a: { progress: 0, position: 0 }, b: { progress: 0, position: 0 } };
    this._labels = {
      a: this.getAttribute('label-a') || 'Untitled',
      b: this.getAttribute('label-b') || 'Untitled',
    };
    this._currentSide = 'a';
    this._updateTapeVisual();
    this._updateSideLabel();
    this._updateLabelDisplay();
    const key = this._storageKey;
    await Promise.all([
      CassetteDB.saveState(key, null),
      CassetteDB.saveAudio(`${key}:side-a`, null),
      CassetteDB.saveAudio(`${key}:side-b`, null),
    ]).catch(() => {});
  }

  _render() {
    const data = this.cassetteData;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
        }

        :host(:active) {
          cursor: grabbing;
        }

        .cassette {
          width: 200px;
          height: 128px;
          background: ${data.color};
          border-radius: 8px 8px 4px 4px;
          position: relative;
          box-shadow:
            0 2px 8px rgba(0,0,0,0.5),
            inset 0 1px 0 rgba(255,255,255,0.3),
            inset 0 -1px 0 rgba(0,0,0,0.2);
          transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
          perspective: 600px;
        }

        .cassette.flipping {
          animation: flip-anim 0.4s ease-in-out;
        }

        @keyframes flip-anim {
          0% { transform: rotateY(0deg) scale(1); }
          50% { transform: rotateY(90deg) scale(0.9); }
          100% { transform: rotateY(0deg) scale(1); }
        }

        .cassette.dragging {
          opacity: 0.5;
          transform: scale(0.95);
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }

        .cassette:hover {
          transform: translateY(-2px);
          box-shadow:
            0 4px 12px rgba(0,0,0,0.6),
            inset 0 1px 0 rgba(255,255,255,0.3),
            inset 0 -1px 0 rgba(0,0,0,0.2);
        }

        .label-area {
          position: absolute;
          top: 6px;
          left: 16px;
          right: 16px;
          height: 40px;
          background: #fff;
          border-radius: 3px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
          overflow: hidden;
        }

        .label-area::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: repeating-linear-gradient(
            90deg,
            #e44 0px, #e44 2px,
            transparent 2px, transparent 4px
          );
        }

        .label-area::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: repeating-linear-gradient(
            90deg,
            #44e 0px, #44e 2px,
            transparent 2px, transparent 4px
          );
        }

        .label-text {
          font-family: 'Courier New', monospace;
          font-size: 10px;
          font-weight: bold;
          color: #333;
          text-transform: uppercase;
          letter-spacing: 1px;
          text-align: center;
          padding: 0 4px;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .lock-area {
          position: absolute;
          top: 2px;
          left: 4px;
          cursor: pointer;
          z-index: 2;
        }

        .lock-tab {
          width: 16px;
          height: 5px;
          background: ${data.color};
          border-radius: 3px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.3);
          transition: height 0.2s, border-radius 0.2s;
          filter: brightness(0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .lock-tab.locked {
          height: 14px;
          border-radius: 3px;
        }

        .lock-icon {
          font-size: 8px;
          line-height: 1;
          user-select: none;
          opacity: 0;
          transition: opacity 0.2s;
          margin-top: 2px;
          filter: brightness(0) invert(1);
        }

        .lock-tab.locked .lock-icon {
          opacity: 1;
        }

        .rename-btn {
          position: absolute;
          right: 3px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          font-size: 10px;
          color: #aaa;
          padding: 2px;
          line-height: 1;
          z-index: 1;
        }

        .rename-btn:hover {
          color: #333;
        }

        .side-indicator {
          font-family: 'Courier New', monospace;
          font-size: 8px;
          color: #888;
          letter-spacing: 2px;
          margin-top: 1px;
        }

        .tape-window {
          position: absolute;
          top: 52px;
          left: 30px;
          right: 30px;
          height: 44px;
          background: rgba(30, 20, 10, 0.7);
          border-radius: 4px 4px 20px 20px;
          box-shadow: inset 0 2px 6px rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: space-around;
          padding: 0 15px;
          overflow: hidden;
        }

        .spool {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .tape {
          position: absolute;
          width: var(--tape-size, 30px);
          height: var(--tape-size, 30px);
          border-radius: 50%;
          background: #1a1008;
          box-shadow: 0 0 2px rgba(0,0,0,0.5);
          transition: width 0.3s, height 0.3s;
        }

        .reel {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #e8ddd0;
          position: relative;
          z-index: 1;
        }

        .reel-hub {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 7px;
          height: 7px;
          transform: translate(-50%, -50%);
          background: #555;
          border-radius: 50%;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);
        }

        .reel-hole {
          position: absolute;
          width: 3px;
          height: 3px;
          background: rgba(30, 20, 10, 0.7);
          border-radius: 50%;
        }

        .reel-hole:nth-child(1) { top: 1px; left: 50%; transform: translateX(-50%); }
        .reel-hole:nth-child(2) { bottom: 1px; left: 50%; transform: translateX(-50%); }
        .reel-hole:nth-child(3) { top: 50%; left: 1px; transform: translateY(-50%); }
        .reel-hole:nth-child(4) { top: 50%; right: 1px; transform: translateY(-50%); }

        .screw {
          position: absolute;
          width: 8px;
          height: 8px;
          background: radial-gradient(circle at 3px 3px, #999, #555);
          border-radius: 50%;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.3);
        }

        .screw::after {
          content: '';
          position: absolute;
          top: 3px;
          left: 1px;
          width: 6px;
          height: 2px;
          background: rgba(0,0,0,0.3);
        }

        .screw.tl { top: 100px; left: 12px; }
        .screw.tr { top: 100px; right: 12px; }
        .screw.bl { top: 114px; left: 50px; }
        .screw.br { top: 114px; right: 50px; }

        .cassette-btns {
          position: absolute;
          bottom: 4px;
          left: 6px;
          right: 6px;
          display: flex;
          justify-content: space-between;
        }

        .cassette-btn {
          background: rgba(0,0,0,0.2);
          border: none;
          color: rgba(255,255,255,0.7);
          font-size: 10px;
          cursor: pointer;
          padding: 2px 5px;
          border-radius: 3px;
          font-family: 'Courier New', monospace;
          line-height: 1;
        }

        .cassette-btn:hover {
          background: rgba(0,0,0,0.4);
          color: #fff;
        }

        .teeth {
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 2px;
        }

        .tooth {
          width: 4px;
          height: 6px;
          background: ${data.color};
          border-radius: 0 0 1px 1px;
        }
      </style>

      <div class="cassette">
        <div class="lock-area" title="Lock/Unlock">
          <div class="lock-tab">
            <span class="lock-icon">\uD83D\uDD12</span>
          </div>
        </div>
        <div class="label-area">
          <span class="label-text">${data.label}</span>
          <button class="rename-btn" title="Rename">\u270E</button>
          <span class="side-indicator">SIDE ${this._currentSide.toUpperCase()}</span>
        </div>
        <div class="tape-window">
          <div class="spool spool-left">
            <div class="tape tape-left"></div>
            <div class="reel left-reel">
              <div class="reel-hole"></div>
              <div class="reel-hole"></div>
              <div class="reel-hole"></div>
              <div class="reel-hole"></div>
              <div class="reel-hub"></div>
            </div>
          </div>
          <div class="spool spool-right">
            <div class="tape tape-right"></div>
            <div class="reel right-reel">
              <div class="reel-hole"></div>
              <div class="reel-hole"></div>
              <div class="reel-hole"></div>
              <div class="reel-hole"></div>
              <div class="reel-hub"></div>
            </div>
          </div>
        </div>
        <div class="screw tl"></div>
        <div class="screw tr"></div>
        <div class="screw bl"></div>
        <div class="screw br"></div>
        <div class="teeth">
          <div class="tooth"></div>
          <div class="tooth"></div>
          <div class="tooth"></div>
          <div class="tooth"></div>
          <div class="tooth"></div>
        </div>
        <div class="cassette-btns">
          <button class="cassette-btn reset-btn" title="Reset tape">RESET</button>
          <button class="cassette-btn flip-btn" title="Flip tape">FLIP</button>
        </div>
      </div>
    `;
  }
}

customElements.define('cassette-tape', CassetteTape);


// ============================================================
// <cassette-tray> - Grid container for cassette tapes
// ============================================================

class CassetteTray extends HTMLElement {
  static get observedAttributes() {
    return ['columns'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._render();
    this._onResize = () => this._autoScale();
    window.addEventListener('resize', this._onResize);
    requestAnimationFrame(() => this._autoScale());
  }

  disconnectedCallback() {
    if (this._onResize) window.removeEventListener('resize', this._onResize);
  }

  attributeChangedCallback() {
    this._render();
    requestAnimationFrame(() => this._autoScale());
  }

  _autoScale() {
    const wrapper = this.shadowRoot?.querySelector('.wrapper');
    if (!wrapper) return;
    const hostWidth = this.clientWidth;
    const cols = parseInt(this.getAttribute('columns')) || 3;
    const trayWidth = cols * 200 + (cols - 1) * 20;

    if (hostWidth < trayWidth) {
      const scale = hostWidth / trayWidth;
      wrapper.style.transform = `scale(${scale})`;
      wrapper.style.transformOrigin = 'top center';
      this.style.height = `${wrapper.scrollHeight * scale}px`;
      this.style.overflow = 'hidden';
    } else {
      wrapper.style.transform = '';
      this.style.height = '';
      this.style.overflow = '';
    }
  }

  _render() {
    const cols = parseInt(this.getAttribute('columns')) || 3;
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }
        .wrapper {
          width: 100%;
          display: flex;
          justify-content: center;
        }
        .tray {
          display: grid;
          grid-template-columns: repeat(${cols}, 200px);
          gap: 20px;
          justify-content: center;
          justify-items: center;
        }
      </style>
      <div class="wrapper">
        <div class="tray">
          <slot></slot>
        </div>
      </div>
    `;
  }
}

customElements.define('cassette-tray', CassetteTray);


// ============================================================
// <radio-cassette> - The boombox player
// ============================================================

class RadioCassette extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._audio = new Audio();
    this._cassette = null;
    this._state = 'stopped';
    this._ffInterval = null;
    this._rewInterval = null;
    this._reelRAF = null;
    this._rewAudioCtx = null;
    this._rewOscillator = null;
    this._rewGain = null;
    this._savedVolume = 1;
  }

  connectedCallback() {
    this._render();
    this._setupDropZone();
    this._setupButtons();
    this._setupAudio();
  }

  disconnectedCallback() {
    this._audio.pause();
    this._audio.src = '';
    cancelAnimationFrame(this._reelRAF);
    clearInterval(this._ffInterval);
    clearInterval(this._rewInterval);
    this._stopRewindSound();
    if (this._onResize) window.removeEventListener('resize', this._onResize);
  }

  _autoScale() {
    const wrapper = this.shadowRoot.querySelector('.wrapper');
    if (!wrapper) return;
    const hostWidth = this.clientWidth;
    const boomboxWidth = 700;

    if (hostWidth < boomboxWidth) {
      const scale = hostWidth / boomboxWidth;
      wrapper.style.transform = `scale(${scale})`;
      wrapper.style.transformOrigin = 'top center';
      this.style.height = `${wrapper.scrollHeight * scale}px`;
      this.style.overflow = 'hidden';
    } else {
      wrapper.style.transform = '';
      this.style.height = '';
      this.style.overflow = '';
    }
  }

  // --- Public API ---

  loadCassette(data) {
    const hadCassette = !!this._cassette;

    // Stop and reset audio
    this._stopSeek();
    this._audio.pause();
    this._audio.currentTime = 0;
    this._audio.src = '';
    this._state = 'stopped';
    this._stopReels();
    this._setLED(false);
    this._updateButtonStates();

    const insertNew = async () => {
      this._cassette = { ...data };
      // Wait for cassette element to finish loading from IndexedDB
      const srcEl = document.getElementById(data.elementId);
      if (srcEl?.ready) await srcEl.ready;
      await this._loadCurrentSide();
      this._showCassetteInDeck(true);
      this._updateDisplay();
      this.dispatchEvent(new CustomEvent('cassette-loaded', {
        bubbles: true, composed: true,
        detail: this._cassette,
      }));
    };

    if (hadCassette) {
      // Eject first, then insert new cassette after animation
      const el = this.shadowRoot.querySelector('.deck-cassette');
      if (el) {
        el.classList.remove('inserted');
        el.classList.add('ejecting');
        this._cassette = null;
        this._updateDisplay();
        setTimeout(() => {
          el.classList.remove('ejecting');
          insertNew();
        }, 500);
      } else {
        insertNew();
      }
    } else {
      insertNew();
    }
  }

  play() {
    if (!this._cassette) return;
    this._wasPlaying = false;
    if (this._state === 'ff' || this._state === 'rew') {
      this._stopSeek();
    }
    this._audio.playbackRate = 1;
    this._audio.volume = this.shadowRoot.querySelector('.volume-slider')?.value ?? 0.7;
    this._audio.play().then(() => {
      this._state = 'playing';
      this._startReels();
      this._updateButtonStates();
      this._setLED(true);
    }).catch(() => {});
  }

  pause() {
    if (!this._cassette) return;
    this._wasPlaying = false;
    this._stopSeek();
    this._audio.pause();
    this._state = 'paused';
    this._stopReels();
    this._updateButtonStates();
    this._setLED(false);
    this._syncToSourceCassette();
  }

  stopEject() {
    if (!this._cassette) return;
    this._wasPlaying = false;
    if (this._state === 'playing' || this._state === 'ff' || this._state === 'rew') {
      // First press: stop (keep position)
      this._stopSeek();
      this._audio.pause();
      this._state = 'stopped';
      this._stopReels();
      this._updateButtonStates();
      this._setLED(false);
      this._syncToSourceCassette();
    } else {
      // Second press (already stopped/paused): eject
      this.eject();
    }
  }

  fastForward() {
    if (!this._cassette) return;
    const wasPlaying = this._state === 'playing';
    if (this._state === 'rew') {
      wasPlaying || (this._wasPlaying = this._wasPlaying || false);
      this._stopSeek();
    } else {
      this._wasPlaying = wasPlaying;
    }
    if (wasPlaying) this._audio.pause();

    this._state = 'ff';
    this._startReels('ff');
    this._updateButtonStates();

    // Play audio at high speed = authentic fast-forward sound
    this._savedVolume = this._audio.volume;
    this._audio.volume = this._savedVolume * 0.3;
    this._audio.playbackRate = 8;
    this._audio.play().catch(() => {});

    this._ffInterval = setInterval(() => {
      if (this._audio.currentTime >= this._audio.duration - 0.5) {
        this._audio.currentTime = this._audio.duration;
        this._stopFF();
        return;
      }
      this._updateReelSizes();
    }, 200);
  }

  stopFF() { this._stopFF(); }

  _stopFF() {
    clearInterval(this._ffInterval);
    this._ffInterval = null;
    this._audio.pause();
    this._audio.playbackRate = 1;
    this._audio.volume = this._savedVolume;
    if (this._wasPlaying) {
      this._wasPlaying = false;
      this.play();
    } else {
      this._state = 'stopped';
      this._stopReels();
      this._updateButtonStates();
    }
  }

  rewind() {
    if (!this._cassette) return;
    const wasPlaying = this._state === 'playing';
    if (this._state === 'ff') {
      wasPlaying || (this._wasPlaying = this._wasPlaying || false);
      this._stopSeek();
    } else {
      this._wasPlaying = wasPlaying;
    }
    if (wasPlaying) this._audio.pause();
    this._state = 'rew';
    this._startReels('rew');
    this._updateButtonStates();

    // Mechanical rewind whirring sound via Web Audio API
    this._startRewindSound();

    this._rewInterval = setInterval(() => {
      if (this._audio.currentTime - 5 <= 0) {
        this._audio.currentTime = 0;
        this._stopREW();
        return;
      }
      this._audio.currentTime -= 5;
      this._updateReelSizes();

      // Pitch changes as tape winds: higher when less tape remains
      if (this._rewOscillator) {
        const progress = this._audio.currentTime / this._audio.duration;
        this._rewOscillator.frequency.value = 300 + (1 - progress) * 400;
      }
    }, 200);
  }

  stopREW() { this._stopREW(); }

  _stopREW() {
    clearInterval(this._rewInterval);
    this._rewInterval = null;
    this._stopRewindSound();
    if (this._wasPlaying) {
      this._wasPlaying = false;
      this.play();
    } else {
      this._state = 'stopped';
      this._stopReels();
      this._updateButtonStates();
    }
  }

  _startRewindSound() {
    this._stopRewindSound();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._rewAudioCtx = ctx;

    // Main whirring tone
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 400;

    // Tremolo for the "kyuru kyuru" flutter
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 150;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start();

    // Volume envelope - follow the volume slider
    const vol = parseFloat(this.shadowRoot.querySelector('.volume-slider')?.value ?? 0.7);
    const gain = ctx.createGain();
    gain.gain.value = 0.08 * vol;

    // Filter to soften the tone
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    this._rewOscillator = osc;
    this._rewGain = gain;
    this._rewLfo = lfo;
  }

  _stopRewindSound() {
    if (this._rewOscillator) {
      this._rewOscillator.stop();
      this._rewOscillator = null;
    }
    if (this._rewLfo) {
      this._rewLfo.stop();
      this._rewLfo = null;
    }
    if (this._rewAudioCtx) {
      this._rewAudioCtx.close();
      this._rewAudioCtx = null;
    }
    this._rewGain = null;
  }

  _stopSeek() {
    if (this._ffInterval) {
      clearInterval(this._ffInterval);
      this._ffInterval = null;
      this._audio.pause();
      this._audio.playbackRate = 1;
      this._audio.volume = this._savedVolume;
    }
    if (this._rewInterval) {
      clearInterval(this._rewInterval);
      this._rewInterval = null;
      this._stopRewindSound();
    }
  }

  eject(animate = true) {
    this._stopSeek();
    this._audio.pause();

    // Save position back to source cassette element
    if (this._cassette?.elementId) {
      const duration = this._audio.duration || 0;
      const progress = duration > 0 ? this._audio.currentTime / duration : 0;
      const srcEl = document.getElementById(this._cassette.elementId);
      srcEl?.updateSideProgress?.(this._cassette.currentSide, progress, this._audio.currentTime);
    }

    this._audio.currentTime = 0;
    this._audio.src = '';
    this._state = 'stopped';
    this._stopReels();
    this._setLED(false);
    this._updateButtonStates();

    if (this._cassette && animate) {
      this._showCassetteInDeck(false);
    } else if (!animate) {
      const deckCassette = this.shadowRoot.querySelector('.deck-cassette');
      if (deckCassette) deckCassette.classList.remove('inserted');
    }

    this._cassette = null;
    this._updateDisplay();

    this.dispatchEvent(new CustomEvent('cassette-ejected', {
      bubbles: true, composed: true,
    }));
  }

  flipTape() {
    if (!this._cassette) return;
    this._flipping = true;
    this._stopSeek();
    this._audio.pause();

    // Save current side's position, then flip
    const srcEl = document.getElementById(this._cassette.elementId);
    const duration = this._audio.duration || 0;
    const progress = duration > 0 ? this._audio.currentTime / duration : 0;
    srcEl?.updateSideProgress(this._cassette.currentSide, progress, this._audio.currentTime);

    this._audio.currentTime = 0;
    this._audio.src = '';
    this._state = 'stopped';
    this._stopReels();
    this._updateButtonStates();
    this._setLED(false);

    // Flip via cassette element API
    this._cassette.currentSide = srcEl?.flipSide() || (this._cassette.currentSide === 'a' ? 'b' : 'a');

    const deckCassette = this.shadowRoot.querySelector('.deck-cassette');
    if (deckCassette) {
      deckCassette.classList.add('flipping');
      setTimeout(() => {
        deckCassette.classList.remove('flipping');
        this._updateDeckCassetteSide();
      }, 400);
    }

    this._loadCurrentSide();
    this._updateDisplay();
    this._flipping = false;
  }

  // --- Internal ---

  async _loadCurrentSide() {
    if (!this._cassette) return;
    this._loading = true;
    const side = this._cassette.currentSide;
    const key = this._cassette.storageKey;

    // Audio: IndexedDB blob first, then attribute src, then silent fallback
    const blob = await CassetteDB.loadAudio(`${key}:side-${side}`).catch(() => null);
    let src;
    if (blob) {
      src = URL.createObjectURL(blob);
    } else {
      src = side === 'a' ? this._cassette.sideASrc : this._cassette.sideBSrc;
    }
    if (!src) {
      src = this._createSilentAudioUrl(300); // 5 minutes
    }

    // Position: read directly from IndexedDB
    const state = await CassetteDB.loadState(key).catch(() => null);
    const pos = state?.sideState?.[side]?.position || 0;

    this._audio.src = src;
    this._audio.load();

    return new Promise((resolve) => {
      this._audio.addEventListener('loadedmetadata', () => {
        if (pos > 0) {
          this._audio.currentTime = Math.min(pos, this._audio.duration);
        }
        this._loading = false;
        this._updateReelSizes();
        this._updateCounter();
        resolve();
      }, { once: true });
    });
  }

  _createSilentAudioUrl(seconds) {
    const sampleRate = 8000;
    const numSamples = sampleRate * seconds;
    const numChannels = 1;
    const bitsPerSample = 8;
    const dataSize = numSamples * numChannels;
    const headerSize = 44;
    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);

    // WAV header
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, headerSize + dataSize - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
    view.setUint16(32, numChannels * bitsPerSample / 8, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    // Silent samples (128 = silence for 8-bit PCM)
    for (let i = 0; i < dataSize; i++) view.setUint8(headerSize + i, 128);

    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  }

  _setupAudio() {
    this._audio.addEventListener('timeupdate', () => {
      this._updateReelSizes();
      this._updateCounter();
      this._syncToSourceCassette();
    });

    this._audio.addEventListener('ended', () => {
      this._state = 'stopped';
      this._stopReels();
      this._updateButtonStates();
      this._setLED(false);
    });

    this._audio.addEventListener('loadedmetadata', () => {
      this._updateReelSizes();
      this._updateCounter();
    });
  }

  _setupDropZone() {
    const deck = this.shadowRoot.querySelector('.deck');

    deck.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-cassette-tape')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        deck.classList.add('drag-over');
      }
    });

    deck.addEventListener('dragenter', (e) => {
      if (e.dataTransfer.types.includes('application/x-cassette-tape')) {
        e.preventDefault();
        deck.classList.add('drag-over');
      }
    });

    deck.addEventListener('dragleave', () => {
      deck.classList.remove('drag-over');
    });

    deck.addEventListener('drop', (e) => {
      e.preventDefault();
      deck.classList.remove('drag-over');
      const raw = e.dataTransfer.getData('application/x-cassette-tape');
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        this.loadCassette(data);
      } catch (_) {}
    });
  }

  _setupButtons() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);

    $('.btn-play').addEventListener('click', () => this.play());
    $('.btn-pause').addEventListener('click', () => this.pause());
    $('.btn-stop-eject').addEventListener('click', () => this.stopEject());

    // FF - hold behavior
    const ffBtn = $('.btn-ff');
    ffBtn.addEventListener('mousedown', () => this.fastForward());
    ffBtn.addEventListener('mouseup', () => { if (this._state === 'ff') this._stopFF(); });
    ffBtn.addEventListener('mouseleave', () => { if (this._state === 'ff') this._stopFF(); });
    ffBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.fastForward(); });
    ffBtn.addEventListener('touchend', () => { if (this._state === 'ff') this._stopFF(); });

    // REW - hold behavior
    const rewBtn = $('.btn-rew');
    rewBtn.addEventListener('mousedown', () => this.rewind());
    rewBtn.addEventListener('mouseup', () => { if (this._state === 'rew') this._stopREW(); });
    rewBtn.addEventListener('mouseleave', () => { if (this._state === 'rew') this._stopREW(); });
    rewBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.rewind(); });
    rewBtn.addEventListener('touchend', () => { if (this._state === 'rew') this._stopREW(); });

    // REC
    $('.btn-rec').addEventListener('click', () => this.record());
  }

  record() {
    if (!this._cassette) return;
    // Check lock on cassette element
    const srcEl = document.getElementById(this._cassette.elementId);
    if (srcEl?._locked) {
      alert(_L('This tape is locked. Unlock it first.', 'このテープはロックされています。先にロックを解除してください。'));
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mp3,audio/mpeg,audio/*';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const side = this._cassette.currentSide;
      const srcEl = document.getElementById(this._cassette.elementId);
      if (srcEl?.saveAudio) {
        await srcEl.saveAudio(side, file);
      }
      // Reload current side with the new audio
      this._cassette.position = 0;
      await this._loadCurrentSide();
      this._updateReelSizes();
      this._updateCounter();
    });
    input.click();
  }

  _showCassetteInDeck(show) {
    const el = this.shadowRoot.querySelector('.deck-cassette');
    if (!el) return;
    if (show) {
      this._updateDeckCassetteColor();
      this._updateDeckCassetteSide();
      requestAnimationFrame(() => {
        el.classList.add('inserted');
      });
    } else {
      el.classList.remove('inserted');
      el.classList.add('ejecting');
      setTimeout(() => {
        el.classList.remove('ejecting');
      }, 500);
    }
  }

  _syncToSourceCassette() {
    if (this._flipping || this._loading || !this._cassette?.elementId) return;
    const duration = this._audio.duration || 0;
    const progress = duration > 0 ? this._audio.currentTime / duration : 0;
    const srcEl = document.getElementById(this._cassette.elementId);
    if (srcEl?.updateSideProgress) {
      srcEl.updateSideProgress(this._cassette.currentSide, progress, this._audio.currentTime);
    }
  }

  _updateDeckCassetteColor() {
    const inner = this.shadowRoot.querySelector('.deck-cassette-inner');
    if (!inner || !this._cassette) return;
    const c = this._cassette.color || '#c8b89a';
    inner.style.background = `linear-gradient(180deg, ${c}, ${this._darken(c)})`;

    // Label text: light color on dark cassette, dark on light
    const label = this.shadowRoot.querySelector('.deck-cassette-label');
    if (label) label.style.color = this._isLight(c) ? '#555' : '#ccc';
  }

  _darken(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (n >> 16) - 30);
    const g = Math.max(0, ((n >> 8) & 0xff) - 30);
    const b = Math.max(0, (n & 0xff) - 30);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  _isLight(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = n >> 16, g = (n >> 8) & 0xff, b = n & 0xff;
    return (r * 299 + g * 587 + b * 114) / 1000 > 128;
  }

  _updateDeckCassetteSide() {
    const label = this.shadowRoot.querySelector('.deck-cassette-label');
    if (label && this._cassette) {
      label.textContent = `SIDE ${this._cassette.currentSide.toUpperCase()}`;
    }
  }

  _startReels(mode = 'play') {
    const left = this.shadowRoot.querySelector('.deck-reel-left');
    const right = this.shadowRoot.querySelector('.deck-reel-right');
    if (!left || !right) return;

    left.classList.remove('spin', 'spin-fast', 'spin-reverse', 'spin-fast-reverse');
    right.classList.remove('spin', 'spin-fast', 'spin-reverse', 'spin-fast-reverse');

    void left.offsetWidth; // force reflow

    if (mode === 'play') {
      left.classList.add('spin');
      right.classList.add('spin');
    } else if (mode === 'ff') {
      left.classList.add('spin-fast');
      right.classList.add('spin-fast');
    } else if (mode === 'rew') {
      left.classList.add('spin-fast-reverse');
      right.classList.add('spin-fast-reverse');
    }
  }

  _stopReels() {
    const left = this.shadowRoot.querySelector('.deck-reel-left');
    const right = this.shadowRoot.querySelector('.deck-reel-right');
    if (!left || !right) return;
    left.classList.remove('spin', 'spin-fast', 'spin-reverse', 'spin-fast-reverse');
    right.classList.remove('spin', 'spin-fast', 'spin-reverse', 'spin-fast-reverse');
  }

  _updateReelSizes() {
    if (!this._audio.duration) return;
    const progress = this._audio.currentTime / this._audio.duration;
    const minSize = 20; // just slightly larger than the reel
    const maxSize = 42; // full tape spool
    const range = maxSize - minSize;

    // Left tape (supply): starts full, shrinks
    const leftSize = maxSize - (progress * range);
    // Right tape (takeup): starts empty, grows
    const rightSize = minSize + (progress * range);

    const left = this.shadowRoot.querySelector('.deck-tape-left');
    const right = this.shadowRoot.querySelector('.deck-tape-right');
    if (left) left.style.setProperty('--tape-size', `${leftSize}px`);
    if (right) right.style.setProperty('--tape-size', `${rightSize}px`);
  }

  _updateCounter() {
    const counter = this.shadowRoot.querySelector('.counter');
    if (!counter) return;
    const t = this._audio.currentTime || 0;
    const m = Math.floor(t / 60).toString().padStart(3, '0');
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    counter.textContent = `${m}:${s}`;
  }

  _updateDisplay() {
    const display = this.shadowRoot.querySelector('.display-text');
    if (!display) return;
    if (this._cassette) {
      // Read latest label from cassette element
      const srcEl = document.getElementById(this._cassette.elementId);
      const label = srcEl?._labels?.[this._cassette.currentSide] || this._cassette.label || 'Untitled';
      display.textContent = `${label} - SIDE ${this._cassette.currentSide.toUpperCase()}`;
    } else {
      display.textContent = 'NO TAPE';
    }
  }

  _updateButtonStates() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    const hasTape = !!this._cassette;

    $('.btn-play').classList.toggle('active', this._state === 'playing');
    $('.btn-ff').classList.toggle('active', this._state === 'ff');
    $('.btn-rew').classList.toggle('active', this._state === 'rew');
    $('.btn-pause').classList.toggle('active', this._state === 'paused');
    $('.btn-stop-eject').classList.toggle('active', this._state === 'stopped' && hasTape);
  }

  _setLED(on) {
    const led = this.shadowRoot.querySelector('.led');
    if (led) led.classList.toggle('on', on);
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          max-width: 700px;
        }

        .wrapper {
          width: 100%;
          display: flex;
          justify-content: center;
        }

        .boombox {
          width: 660px;
          background: linear-gradient(180deg, #999 0%, #777 40%, #666 100%);
          border-radius: 24px 24px 12px 12px;
          padding: 20px;
          box-shadow:
            0 8px 32px rgba(0,0,0,0.6),
            inset 0 2px 0 rgba(255,255,255,0.3),
            inset 0 -2px 0 rgba(0,0,0,0.3);
          position: relative;
        }

        .top-section {
          display: flex;
          justify-content: center;
          align-items: center;
          margin-bottom: 12px;
          gap: 16px;
        }

        .handle {
          width: 120px;
          height: 8px;
          background: linear-gradient(180deg, #aaa, #666);
          border-radius: 4px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.4), 0 1px 2px rgba(0,0,0,0.3);
        }

        .brand {
          font-family: 'Courier New', monospace;
          font-size: 11px;
          font-weight: bold;
          letter-spacing: 3px;
          color: #ddd;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
          text-transform: uppercase;
        }

        .main-section {
          display: flex;
          gap: 12px;
          align-items: stretch;
        }

        .speaker {
          width: 140px;
          min-height: 200px;
          background: #333;
          border-radius: 12px;
          box-shadow:
            inset 0 2px 8px rgba(0,0,0,0.6),
            0 1px 0 rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .speaker-grille {
          width: 110px;
          height: 110px;
          border-radius: 50%;
          background:
            radial-gradient(circle, transparent 30%, rgba(0,0,0,0.3) 70%),
            radial-gradient(circle, #333 1.5px, transparent 1.5px);
          background-size: 100% 100%, 8px 8px;
          position: relative;
        }

        .speaker-grille::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 40px;
          height: 40px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: radial-gradient(circle, #222 30%, #444 70%, #333 100%);
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);
        }

        .center-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .display {
          background: #1a2a1a;
          border-radius: 6px;
          padding: 6px 12px;
          box-shadow: inset 0 2px 6px rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 36px;
        }

        .display-text {
          font-family: 'Courier New', monospace;
          font-size: 11px;
          color: #4a4;
          letter-spacing: 1px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }

        .counter {
          font-family: 'Courier New', monospace;
          font-size: 13px;
          color: #4a4;
          letter-spacing: 2px;
          min-width: 60px;
          text-align: right;
        }

        .led {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #131;
          margin-right: 8px;
          box-shadow: 0 0 2px rgba(0,0,0,0.5);
          transition: background 0.2s, box-shadow 0.2s;
        }

        .led.on {
          background: #4f4;
          box-shadow: 0 0 6px #4f4, 0 0 12px rgba(68, 255, 68, 0.4);
        }

        .deck {
          background: #111;
          border-radius: 8px;
          height: 120px;
          box-shadow: inset 0 3px 10px rgba(0,0,0,0.7);
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: box-shadow 0.3s;
          overflow: hidden;
        }

        .deck.drag-over {
          box-shadow:
            inset 0 3px 10px rgba(0,0,0,0.7),
            inset 0 0 20px rgba(100, 200, 255, 0.3),
            0 0 15px rgba(100, 200, 255, 0.2);
        }

        .deck-empty-text {
          font-family: 'Courier New', monospace;
          font-size: 10px;
          color: #444;
          letter-spacing: 2px;
          text-transform: uppercase;
          pointer-events: none;
        }

        .deck-cassette {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transform: translateY(-120%);
          transition: transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          pointer-events: none;
        }

        .deck-cassette.inserted {
          transform: translateY(0);
        }

        .deck-cassette.ejecting {
          transform: translateY(-120%);
          transition: transform 0.5s cubic-bezier(0.55, 0.06, 0.68, 0.19);
        }

        .deck-cassette.flipping {
          animation: deck-flip 0.4s ease-in-out;
        }

        @keyframes deck-flip {
          0% { transform: rotateY(0deg); }
          50% { transform: rotateY(90deg); }
          100% { transform: rotateY(0deg); }
        }

        .deck-cassette-inner {
          width: 280px;
          height: 90px;
          background: linear-gradient(180deg, #d4c4a8, #b8a888);
          border-radius: 6px;
          position: relative;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .deck-window {
          width: 180px;
          height: 50px;
          background: rgba(30, 20, 10, 0.65);
          border-radius: 4px 4px 20px 20px;
          display: flex;
          align-items: center;
          justify-content: space-around;
          padding: 0 25px;
          box-shadow: inset 0 2px 5px rgba(0,0,0,0.5);
          position: relative;
        }

        .deck-spool {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .deck-tape {
          position: absolute;
          width: var(--tape-size, 38px);
          height: var(--tape-size, 38px);
          border-radius: 50%;
          background: #1a1008;
          box-shadow: 0 0 3px rgba(0,0,0,0.6);
          transition: width 0.3s, height 0.3s;
        }

        .deck-reel {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #e8ddd0;
          position: relative;
          z-index: 1;
        }

        .deck-reel-hub {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 8px;
          height: 8px;
          transform: translate(-50%, -50%);
          background: #555;
          border-radius: 50%;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.5);
        }

        .deck-reel-hole {
          position: absolute;
          width: 3px;
          height: 3px;
          background: rgba(30, 20, 10, 0.8);
          border-radius: 50%;
        }

        .deck-reel-hole:nth-child(1) { top: 1px; left: 50%; transform: translateX(-50%); }
        .deck-reel-hole:nth-child(2) { bottom: 1px; left: 50%; transform: translateX(-50%); }
        .deck-reel-hole:nth-child(3) { top: 50%; left: 1px; transform: translateY(-50%); }
        .deck-reel-hole:nth-child(4) { top: 50%; right: 1px; transform: translateY(-50%); }

        .deck-reel.spin {
          animation: reel-spin 1.5s linear infinite;
        }

        .deck-reel.spin-fast {
          animation: reel-spin 0.3s linear infinite;
        }

        .deck-reel.spin-fast-reverse {
          animation: reel-spin-reverse 0.3s linear infinite;
        }

        @keyframes reel-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes reel-spin-reverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }

        .deck-cassette-label {
          position: absolute;
          top: 6px;
          font-family: 'Courier New', monospace;
          font-size: 9px;
          color: #666;
          letter-spacing: 2px;
        }

        .button-row {
          display: flex;
          gap: 6px;
          justify-content: center;
        }

        .button-row .btn {
          flex: 1;
        }

        .btn {
          border: none;
          cursor: pointer;
          font-family: 'Courier New', monospace;
          font-size: 11px;
          font-weight: bold;
          padding: 6px 14px;
          height: 52px;
          border-radius: 4px;
          color: #fff;
          text-transform: uppercase;
          letter-spacing: 1px;
          position: relative;
          transition: transform 0.05s, box-shadow 0.05s;
          user-select: none;
          -webkit-user-select: none;
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .btn:active, .btn.active {
          transform: translateY(2px);
          box-shadow: 0 1px 2px rgba(0,0,0,0.5) !important;
        }

        .btn-play {
          background: linear-gradient(180deg, #5a9a5a, #3a7a3a);
          box-shadow: 0 3px 0 #2a5a2a, 0 4px 8px rgba(0,0,0,0.3);
        }

        .btn-pause {
          background: linear-gradient(180deg, #d55, #b33);
          box-shadow: 0 3px 0 #922, 0 4px 8px rgba(0,0,0,0.3);
        }

        .btn-rew {
          background: linear-gradient(180deg, #666, #444);
          box-shadow: 0 3px 0 #333, 0 4px 8px rgba(0,0,0,0.3);
        }

        .btn-ff {
          background: linear-gradient(180deg, #666, #444);
          box-shadow: 0 3px 0 #333, 0 4px 8px rgba(0,0,0,0.3);
        }

        .btn-stop-eject {
          background: linear-gradient(180deg, #999, #777);
          box-shadow: 0 3px 0 #555, 0 4px 8px rgba(0,0,0,0.3);
          color: #333;
        }

        .btn-rec {
          background: linear-gradient(180deg, #c33, #911);
          box-shadow: 0 3px 0 #700, 0 4px 8px rgba(0,0,0,0.3);
        }

        .btn-symbol {
          display: block;
          font-size: 20px;
          line-height: 1;
          margin-bottom: 2px;
        }

        .btn-label {
          display: block;
          font-size: 8px;
          opacity: 0.8;
        }

        .volume-section {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 4px;
          padding-right: 8px;
        }

        .volume-label {
          font-family: 'Courier New', monospace;
          font-size: 9px;
          color: #aaa;
          letter-spacing: 1px;
        }

        .volume-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 80px;
          height: 6px;
          background: #333;
          border-radius: 3px;
          outline: none;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);
        }

        .volume-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: linear-gradient(180deg, #ccc, #888);
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.4);
        }

        .bottom-strip {
          height: 8px;
          background: linear-gradient(90deg, #555, #777, #555);
          border-radius: 0 0 8px 8px;
          margin: 8px -8px -8px;
        }

        .feet {
          display: flex;
          justify-content: space-between;
          padding: 0 30px;
          margin: -4px -8px -8px;
        }

        .foot {
          width: 30px;
          height: 8px;
          background: #333;
          border-radius: 0 0 4px 4px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
      </style>

      <div class="wrapper">
      <div class="boombox">
        <div class="top-section">
          <div class="handle"></div>
          <span class="brand">Radio Cassette</span>
          <div class="handle"></div>
        </div>

        <div class="main-section">
          <div class="speaker">
            <div class="speaker-grille"></div>
          </div>

          <div class="center-section">
            <div class="display">
              <div class="led"></div>
              <span class="display-text">NO TAPE</span>
              <span class="counter">000:00</span>
            </div>

            <div class="deck">
              <span class="deck-empty-text">\u25BC ${_L('Drop cassette here', 'カセットをここにドロップ')} \u25BC</span>
              <div class="deck-cassette">
                <div class="deck-cassette-inner">
                  <span class="deck-cassette-label">SIDE A</span>
                  <div class="deck-window">
                    <div class="deck-spool deck-spool-left">
                      <div class="deck-tape deck-tape-left"></div>
                      <div class="deck-reel deck-reel-left">
                        <div class="deck-reel-hole"></div>
                        <div class="deck-reel-hole"></div>
                        <div class="deck-reel-hole"></div>
                        <div class="deck-reel-hole"></div>
                        <div class="deck-reel-hub"></div>
                      </div>
                    </div>
                    <div class="deck-spool deck-spool-right">
                      <div class="deck-tape deck-tape-right"></div>
                      <div class="deck-reel deck-reel-right">
                        <div class="deck-reel-hole"></div>
                        <div class="deck-reel-hole"></div>
                        <div class="deck-reel-hole"></div>
                        <div class="deck-reel-hole"></div>
                        <div class="deck-reel-hub"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="button-row">
              <button class="btn btn-rew">
                <span class="btn-symbol">\u25C0\u25C0</span>
                <span class="btn-label">REW</span>
              </button>
              <button class="btn btn-play">
                <span class="btn-symbol">\u25B6</span>
                <span class="btn-label">PLAY</span>
              </button>
              <button class="btn btn-pause">
                <span class="btn-symbol">\u2759\u2759</span>
                <span class="btn-label">PAUSE</span>
              </button>
              <button class="btn btn-ff">
                <span class="btn-symbol">\u25B6\u25B6</span>
                <span class="btn-label">FF</span>
              </button>
            </div>
            <div class="button-row">
              <button class="btn btn-stop-eject">
                <span class="btn-symbol" style="font-size:28px;line-height:20px">\u23CF</span>
                <span class="btn-label">STOP/EJECT</span>
              </button>
              <button class="btn btn-rec">
                <span class="btn-symbol">\u26AB</span>
                <span class="btn-label">REC</span>
              </button>
            </div>

            <div class="volume-section">
              <span class="volume-label">VOL</span>
              <input type="range" class="volume-slider" min="0" max="1" step="0.05" value="0.7">
            </div>
          </div>

          <div class="speaker">
            <div class="speaker-grille"></div>
          </div>
        </div>

        <div class="bottom-strip"></div>
        <div class="feet">
          <div class="foot"></div>
          <div class="foot"></div>
        </div>
      </div>
      </div>
    `;

    // Auto-scale to fit container width
    this._onResize = () => this._autoScale();
    window.addEventListener('resize', this._onResize);
    requestAnimationFrame(() => this._autoScale());

    const vol = this.shadowRoot.querySelector('.volume-slider');
    this._audio.volume = parseFloat(vol.value);
    vol.addEventListener('input', () => {
      this._audio.volume = parseFloat(vol.value);
      if (this._rewGain) {
        this._rewGain.gain.value = 0.08 * parseFloat(vol.value);
      }
    });
  }
}

customElements.define('radio-cassette', RadioCassette);
