# Radio Cassette Player

> **[English version (README.md)](./README.md)**

カセットテープをドラッグしてラジカセに挿入して音楽を再生する、レトロ体験を再現した Web Component です。
シークバーはありません。早送り・巻き戻し・A面B面の入れ替えなど、古き良きカセットテープの不便さを楽しめます。

---

## 機能

- **ドラッグ&ドロップ** — カセットをラジカセにドラッグして挿入
- **PLAY / PAUSE** — 再生と一時停止（位置を維持）
- **FF / REW** — 早送り・巻き戻し（ボタン長押し）
- **STOP/EJECT** — 1回目で停止、2回目でイジェクト
- **A面 / B面** — カセットのFLIPボタンまたはダブルクリックで裏返し
- **早送り音** — 実際の音源を高速再生したキュルキュル音
- **巻き戻し音** — Web Audio API による機械的なキュルキュル音
- **リール回転** — 再生中にリールが回転し、テープ残量が視覚的に変化
- **カセットの色** — カセットごとに色を設定可能、デッキ内にも反映
- **録音 (REC)** — RECボタンでMP3をアップロードして現在の面を上書き
- **リネーム** — 鉛筆アイコンでA面B面それぞれのタイトルを変更
- **ロック** — カセット左上のツメで録音を防止（実物のカセットと同じ仕組み）
- **空テープ** — MP3未指定でも5分間の無音テープとして使える（RECで録音可能）
- **IndexedDB** — 再生位置・アップロード音声・タイトル・ロック状態をIndexedDBで永続化
- **レスポンシブ** — スマホでも画面幅に合わせて自動スケール
- **タッチ対応** — モバイルでもタッチでドラッグ操作可能

---

## はじめかた

### 1. ファイル構成

```
radio-cassette/
  index.html           # デモページ
  radio-cassette.js     # 全コンポーネント（1ファイル）
  styles/boombox.css    # ページスタイル
  mp3/                  # 音声ファイル
```

### 2. 読み込み

```html
<script type="module" src="radio-cassette.js"></script>
```

### 3. ローカルサーバーで起動

```bash
npx serve .
# または
python3 -m http.server
```

---

## 使い方

### `<radio-cassette>`

ラジカセ本体です。ページに1つ配置します。

```html
<radio-cassette></radio-cassette>
```

### `<cassette-tape>`

カセットテープです。全属性は省略可能で、色だけ指定すれば空テープとして使えます。

```html
<!-- フル指定 -->
<cassette-tape
  label-a="My Favorite Mix A"
  label-b="My Favorite Mix B"
  side-a-src="track-a.mp3"
  side-b-src="track-b.mp3"
  color="#c8b89a"
  locked
></cassette-tape>

<!-- 空テープ（5分間の無音、RECで録音可能） -->
<cassette-tape color="#FAF3E0"></cassette-tape>
```

| 属性 | 説明 | デフォルト |
|------|------|----------|
| `label-a` | A面のラベル | `Untitled` |
| `label-b` | B面のラベル | `Untitled` |
| `side-a-src` | A面の音源URL | 5分間の無音 |
| `side-b-src` | B面の音源URL | 5分間の無音 |
| `color` | カセットの色（16進数） | `#c8b89a` |
| `current-side` | 初期面（`a` または `b`） | `a` |
| `locked` | 初期ロック状態（属性があればロック） | ロックなし |

### `<cassette-tray>`

カセットを並べるグリッドコンテナです。

```html
<cassette-tray columns="3">
  <cassette-tape ...></cassette-tape>
  <cassette-tape ...></cassette-tape>
  <cassette-tape ...></cassette-tape>
</cassette-tray>
```

| 属性 | 説明 | デフォルト |
|------|------|----------|
| `columns` | 列数 | `3` |

---

## 操作方法

| 操作 | 方法 |
|------|------|
| テープ挿入 | カセットをラジカセにドラッグ |
| 再生 | PLAYボタン |
| 一時停止 | PAUSEボタン |
| 早送り | FFボタン長押し |
| 巻き戻し | REWボタン長押し |
| 停止 | STOP/EJECTボタン（1回目） |
| イジェクト | STOP/EJECTボタン（2回目） |
| A面B面切替 | カセットのFLIPボタンまたはダブルクリック |
| 録音 | RECボタン（現在の面にMP3をアップロード） |
| リネーム | カセットラベルの鉛筆アイコン |
| ロック/解除 | カセット左上のツメをクリック |
| リセット | カセットのRESETボタン（全データをクリア） |

---

## 外部MP3の利用

ローカルファイルだけでなく、外部URLも指定できます。

```html
<cassette-tape
  label-a="Online Track A"
  label-b="Online Track B"
  side-a-src="https://example.com/music/track1.mp3"
  side-b-src="https://example.com/music/track2.mp3"
></cassette-tape>
```

---

## ブラウザ対応

- Chrome / Edge（推奨）
- Safari
- Firefox

---

## ライセンス

MIT
