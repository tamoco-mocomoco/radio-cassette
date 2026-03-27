# Radio Cassette Player

> **[日本語はこちら (README.ja.md)](./README.ja.md)**

A Web Component that recreates the retro experience of a radio-cassette player.
Drag a cassette tape into the boombox to play music. No seek bar — just fast-forward, rewind, and flip the tape like the good old days.

---

## Features

- **Drag & Drop** — Drag a cassette into the boombox to load it
- **PLAY / PAUSE** — Play and pause with position retained
- **FF / REW** — Fast-forward and rewind by holding the button
- **STOP/EJECT** — First press stops, second press ejects
- **Side A / Side B** — Flip the tape via button or double-click
- **FF Sound** — Authentic fast-forward sound from the actual audio
- **REW Sound** — Mechanical rewind whirring via Web Audio API
- **Reel Animation** — Reel spin with tape amount visualization
- **Cassette Color** — Per-cassette color, reflected in the deck
- **REC** — Upload an MP3 to overwrite the current side
- **Rename** — Rename each side independently via the pencil icon
- **Lock** — Lock tab on cassette prevents recording over the tape
- **Blank Tape** — No MP3 needed; generates 5 minutes of silence as a blank tape
- **IndexedDB** — Playback position, uploaded audio, labels, and lock state persist across page reloads
- **Responsive** — Auto-scales to fit any screen width
- **Touch Support** — Touch drag support for mobile devices

---

## Getting Started

### 1. File Structure

```
radio-cassette/
  index.html           # Demo page
  radio-cassette.js     # All Web Components (single file)
  styles/boombox.css    # Page styles
  mp3/                  # Audio files
```

### 2. Load

```html
<script type="module" src="radio-cassette.js"></script>
```

### 3. Run Locally

```bash
npx serve .
# or
python3 -m http.server
```

---

## Usage

### `<radio-cassette>`

The boombox player. Place one on your page.

```html
<radio-cassette></radio-cassette>
```

### `<cassette-tape>`

A cassette tape. All attributes are optional — a blank tape is created with just a color.

```html
<!-- Fully configured tape -->
<cassette-tape
  label-a="My Favorite Mix A"
  label-b="My Favorite Mix B"
  side-a-src="track-a.mp3"
  side-b-src="track-b.mp3"
  color="#c8b89a"
  locked
></cassette-tape>

<!-- Blank tape (5 min silence, ready for REC) -->
<cassette-tape color="#FAF3E0"></cassette-tape>
```

| Attribute | Description | Default |
|-----------|------------|---------|
| `label-a` | Tape label for side A | `Untitled` |
| `label-b` | Tape label for side B | `Untitled` |
| `side-a-src` | MP3 URL for side A | 5 min silence |
| `side-b-src` | MP3 URL for side B | 5 min silence |
| `color` | Cassette body color (hex) | `#c8b89a` |
| `current-side` | Initial side (`a` or `b`) | `a` |
| `locked` | Initial lock state (presence = locked) | unlocked |

### `<cassette-tray>`

A grid container for cassette tapes.

```html
<cassette-tray columns="3">
  <cassette-tape ...></cassette-tape>
  <cassette-tape ...></cassette-tape>
  <cassette-tape ...></cassette-tape>
</cassette-tray>
```

| Attribute | Description | Default |
|-----------|------------|---------|
| `columns` | Number of columns | `3` |

---

## Operations

| Operation | How |
|---|---|
| Insert tape | Drag cassette onto the boombox |
| Play | PLAY button |
| Pause | PAUSE button |
| Fast-forward | Hold FF button |
| Rewind | Hold REW button |
| Stop | STOP/EJECT button (1st press) |
| Eject | STOP/EJECT button (2nd press) |
| Flip tape | FLIP button or double-click on cassette |
| Record | REC button (uploads MP3 to current side) |
| Rename | Pencil icon on the cassette label |
| Lock/Unlock | Lock tab on the cassette (top-left) |
| Reset | RESET button on cassette (clears all data) |

---

## External MP3

You can use external URLs as well as local files.

```html
<cassette-tape
  label-a="Online Track A"
  label-b="Online Track B"
  side-a-src="https://example.com/music/track1.mp3"
  side-b-src="https://example.com/music/track2.mp3"
></cassette-tape>
```

---

## Browser Support

- Chrome / Edge (recommended)
- Safari
- Firefox

---

## License

MIT
