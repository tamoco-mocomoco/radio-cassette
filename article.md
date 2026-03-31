---
title: "早送り・巻き戻し・A面B面。カセットテープ体験をWeb Componentで。"
emoji: "📻"
type: "tech"
topics: ["webcomponents", "javascript", "css", "レトロ", "html"]
published: false
---

## はじめに

以前、[黒電話をWeb Componentで実装した記事](https://zenn.dev/lecto/articles/ee345c79c269eb)を書きました。

あのときは「ダイヤルを回す」という体験をブラウザ上で再現しましたが、今回はもうひとつの昭和〜平成レトロの代表格、**ラジカセ（ラジオカセットプレーヤー）** を作ってみました。

カセットテープをドラッグしてラジカセに挿入して、再生ボタンを押す。早送りしたらキュルキュル音が鳴って、巻き戻しも長押しで。A面が終わったらカセットをひっくり返してB面を聴く。

**シークバーなんてありません。** あの不便さこそがカセットテープの良さだと思うんです。

## デモ

実際に動くデモはこちらです。カセットをドラッグしてラジカセに入れてみてください。

https://tamoco-mocomoco.github.io/radio-cassette/

![ラジカセの見た目](/images/radio-cassette-demo.png)

## 何ができるの？

- 🎵 **カセットをドラッグ&ドロップ** でラジカセに挿入
- ▶️ **再生・一時停止** — 位置を維持したまま
- ⏩ **早送り** — ボタン長押しで実際の音源を高速再生（キュルキュル音）
- ⏪ **巻き戻し** — Web Audio APIで機械的なキュルキュル音を生成
- ⏏️ **STOP/EJECT** — 1回目で停止、2回目でイジェクト
- 🔄 **A面/B面切替** — カセットのFLIPボタンまたはダブルクリック
- ⏺️ **録音(REC)** — MP3をアップロードして現在の面を上書き
- ✏️ **リネーム** — 鉛筆アイコンでA面B面それぞれのタイトルを変更
- 🔒 **ロック** — カセット左上のツメで録音を防止（実物と同じ！）
- 💾 **IndexedDB** — 再生位置もアップロード音声もページを閉じても保持
- 📱 **レスポンシブ** — スマホでも画面幅に合わせて自動スケール

## 技術スタック

- **Web Components** (Custom Elements + Shadow DOM)
- **HTMLAudioElement** — 音声再生
- **Web Audio API** — 巻き戻し音の生成
- **IndexedDB** — 状態と音声データの永続化
- **CSS only** — 画像なし、全てCSSでラジカセを描画
- **Playwright** — E2Eテスト

フレームワークなし、ビルドツールなし。`radio-cassette.js` の **1ファイル** に全コンポーネントを収めています。

## 使い方

### CDNから読み込む

```html
<script type="module" src="https://cdn.jsdelivr.net/gh/tamoco-mocomoco/radio-cassette@main/radio-cassette.js"></script>
```

### ラジカセを置く

```html
<radio-cassette></radio-cassette>
```

### カセットテープを並べる

```html
<cassette-tray columns="3">
  <!-- 音源入りのカセット -->
  <cassette-tape
    label-a="Highway Ocean View"
    label-b="Nightway Ocean View"
    side-a-src="mp3/HighwayOceanView.mp3"
    side-b-src="mp3/NightwayOceanView.mp3"
    color="#87CEEB"
    locked
  ></cassette-tape>

  <!-- 空のカセット（5分間の無音テープ、RECで録音可能） -->
  <cassette-tape color="#FAF3E0"></cassette-tape>
</cassette-tray>
```

これだけです。`<cassette-tape>` は色だけ指定すれば空テープとして動きます。

## こだわったポイント

### 早送り音は実際の音源から

早送りボタンを長押しすると、**その曲を8倍速で再生** します。実際のカセットで早送りしたときに聴こえるあのキュルキュル音は、テープが高速で送られるときに音声がヘッドに触れて出る音。それを `playbackRate = 8` で再現しています。

```javascript
this._audio.playbackRate = 8;
this._audio.volume = this._savedVolume * 0.3;
this._audio.play();
```

### 巻き戻し音はWeb Audio APIで生成

ブラウザは逆再生に対応していないので、巻き戻し音はWeb Audio APIのオシレーターで機械的なキュルキュル音を合成しています。テープ残量に応じてピッチも変化します。

```javascript
const osc = ctx.createOscillator();
osc.type = 'sawtooth';
osc.frequency.value = 400;

// トレモロでキュルキュル感を出す
const lfo = ctx.createOscillator();
lfo.frequency.value = 12;
```

### カセットのツメでロック

実物のカセットテープには、上部にツメがあって、それを折ると録音できなくなる仕組みがありました。これをCSSで再現しています。ツメをクリックすると出っ張って🔒アイコンが表示され、RECボタンが無効になります。

### A面B面は独立して管理

再生位置もタイトルも面ごとに独立してIndexedDBに保存されます。A面を途中まで聴いて、B面にひっくり返して、またA面に戻しても、ちゃんとそれぞれの位置から再開できます。

### 空テープの自動生成

MP3を指定しなかった場合、Web Audio APIで5分間の無音WAVを動的に生成します。RECボタンでMP3をアップロードすれば、自分だけのカセットテープが作れます。

```html
<!-- これだけで空テープとして動く -->
<cassette-tape color="#FAF3E0"></cassette-tape>
```

### レスポンシブ対応

ラジカセのデザインは660px固定幅ですが、画面幅が足りない場合は `scale` で自動縮小します。`ResizeObserver` だとリサイズループが発生したので、`window.resize` で制御しています。

## 苦労したポイント

### 再生位置の保持が意外と難しい

最初は `localStorage` で再生位置を保存していたのですが、A面B面の切替やカセットの差し替えで位置がずれる問題が頻発しました。

根本的な原因は、`audio.src` を設定した直後に `timeupdate` イベントが `currentTime=0` で発火して、IndexedDBに0を書き戻してしまうことでした。`_loading` フラグを導入して、`loadedmetadata` で位置を復元するまで同期をスキップする形で解決しました。

```javascript
async _loadCurrentSide() {
  this._loading = true;
  // ...
  this._audio.src = src;
  this._audio.load();

  return new Promise((resolve) => {
    this._audio.addEventListener('loadedmetadata', () => {
      if (pos > 0) {
        this._audio.currentTime = Math.min(pos, this._audio.duration);
      }
      this._loading = false;
      resolve();
    }, { once: true });
  });
}
```

### ドラッグ&ドロップのモバイル対応

ブラウザのネイティブDrag & Drop APIはモバイルのタッチイベントでは動作しません。`touchstart` / `touchmove` / `touchend` で独自にドラッグ処理を実装し、半透明のゴーストを指に追従させています。

## テスト

Playwrightで38件のE2Eテストを書いています。再生位置の保持、A/B面の独立性、カセット間のデータ分離、ロック機能など、状態管理まわりを重点的にテストしています。

```bash
npx playwright test
```

テスト専用のHTMLを `tests/test.html` に用意して、`index.html` の変更に影響されない構成にしています。

## リポジトリ

https://github.com/tamoco-mocomoco/radio-cassette

## 前回の記事

https://zenn.dev/lecto/articles/ee345c79c269eb

## おわりに

黒電話に続いて、今回はラジカセを作ってみました。

カセットテープって、不便なんですよね。聴きたい曲まで早送りして、行き過ぎて巻き戻して、やっと見つけたと思ったら微妙にずれてて。でもその不便さが、音楽を聴くという行為に「手触り」を与えていたんだなと、作りながら改めて思いました。

Web Componentで作っているので、`<script>` タグ1つで誰でも自分のサイトにラジカセを置けます。好きな曲を入れたカセットテープを並べて、あの頃の体験をしてみてください。

次は何を作ろうかな。昭和〜平成レトロシリーズ、まだまだネタはありそうです。
