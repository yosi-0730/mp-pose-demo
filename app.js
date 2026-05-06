import PoseDetector from './pose-detector.js';
import SkeletonRenderer from './skeleton-renderer.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ゴースト検出フィルタ: 可視ランドマーク数が閾値未満の人物は除外
const MIN_VISIBLE_LANDMARKS = 12;
const LANDMARK_VISIBILITY_THRESH = 0.5;

function filterValidPoses(allLandmarks) {
  return allLandmarks.filter(
    (lms) =>
      lms.filter((lm) => (lm.visibility ?? 0) >= LANDMARK_VISIBILITY_THRESH)
        .length >= MIN_VISIBLE_LANDMARKS
  );
}

class App {
  #video = document.getElementById('video');
  #canvas = document.getElementById('canvas');
  #ctx = document.getElementById('canvas').getContext('2d');
  #overlay = document.getElementById('overlay');
  #spinner = document.querySelector('.spinner');
  #statusText = document.getElementById('status-text');
  #btnToggle = document.getElementById('btn-toggle');
  #btnLabel = document.getElementById('btn-label');
  #btnIcon = document.getElementById('btn-icon');
  #btnSwitch = document.getElementById('btn-camera-switch');
  #peopleCount = document.getElementById('people-count');
  #fpsValue = document.getElementById('fps-value');

  #detector = new PoseDetector();
  #renderer = new SkeletonRenderer(document.getElementById('canvas'));

  #isRunning = false;
  #rafId = null;
  #lastResult = null;
  #facingMode = 'user'; // 'user' = インカメ, 'environment' = 外カメ

  #fpsFrames = 0;
  #fpsAccum = 0;
  #lastTs = 0;

  constructor() {
    this.#btnToggle.addEventListener('click', () => this.#toggle());
    this.#btnSwitch.addEventListener('click', () => this.#switchCamera());
    window.addEventListener('resize', () => this.#syncCanvasSize());
  }

  async init() {
    try {
      await this.#detector.init((msg) => this.#setStatus(msg));
      this.#setStatus('カメラを起動してください');
      this.#spinner.classList.add('hidden');
      this.#btnToggle.disabled = false;
    } catch (err) {
      this.#setStatus(`初期化エラー: ${err.message}`);
      this.#spinner.classList.add('hidden');
    }
  }

  async #toggle() {
    if (this.#isRunning) {
      this.#stop();
    } else {
      await this.#start(this.#facingMode);
    }
  }

  async #start(facingMode) {
    this.#facingMode = facingMode;
    this.#btnToggle.disabled = true;
    this.#btnSwitch.hidden = true;
    this.#spinner.classList.remove('hidden');
    this.#overlay.classList.remove('hidden');
    this.#setStatus('初期化中…');

    try {
      // 毎回 reinit: MediaPipe 内部グラフのタイムスタンプをリセット
      // (停止→再起動時の "timestamp mismatch" エラーを回避)
      await this.#detector.init((msg) => this.#setStatus(msg));

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      this.#video.srcObject = stream;
      await this.#video.play();
      this.#syncCanvasSize();

      this.#isRunning = true;
      this.#lastResult = null;
      this.#fpsFrames = 0;
      this.#fpsAccum = 0;
      this.#lastTs = performance.now();

      this.#overlay.classList.add('hidden');
      this.#spinner.classList.add('hidden');
      this.#btnToggle.classList.add('running');
      this.#btnLabel.textContent = 'カメラ停止';
      this.#btnIcon.innerHTML = '&#9646;&#9646;';
      this.#btnToggle.disabled = false;
      this.#btnSwitch.hidden = false;

      this.#loop(performance.now());
    } catch (err) {
      this.#setStatus(`カメラ起動失敗: ${err.message}`);
      this.#spinner.classList.add('hidden');
      this.#btnToggle.disabled = false;
    }
  }

  #stop() {
    this.#isRunning = false;
    cancelAnimationFrame(this.#rafId);

    this.#video.srcObject?.getTracks().forEach((t) => t.stop());
    this.#video.srcObject = null;

    this.#detector.dispose();
    this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#lastResult = null;

    this.#overlay.classList.remove('hidden');
    this.#spinner.classList.add('hidden');
    this.#setStatus('停止中。カメラを起動するにはボタンを押してください。');
    this.#btnToggle.classList.remove('running');
    this.#btnLabel.textContent = 'カメラ起動';
    this.#btnIcon.innerHTML = '&#9654;';
    this.#btnSwitch.hidden = true;
    this.#peopleCount.textContent = '—';
    this.#fpsValue.textContent = '—';
  }

  async #switchCamera() {
    if (!this.#isRunning) return;

    // 現在のストリームを停止 (detector は再利用せず #start で reinit)
    this.#isRunning = false;
    cancelAnimationFrame(this.#rafId);
    this.#video.srcObject?.getTracks().forEach((t) => t.stop());
    this.#video.srcObject = null;
    this.#detector.dispose();

    const next = this.#facingMode === 'user' ? 'environment' : 'user';
    await this.#start(next);
  }

  #loop(now) {
    if (!this.#isRunning) return;
    this.#rafId = requestAnimationFrame((ts) => this.#loop(ts));

    // FPS 計算 (500ms 間隔で更新)
    const delta = now - this.#lastTs;
    this.#lastTs = now;
    this.#fpsFrames++;
    this.#fpsAccum += delta;
    if (this.#fpsAccum >= 500) {
      this.#fpsValue.textContent = Math.round(
        (this.#fpsFrames * 1000) / this.#fpsAccum
      );
      this.#fpsFrames = 0;
      this.#fpsAccum = 0;
    }

    // 映像描画: インカメはミラー表示、外カメはそのまま
    const mirror = this.#facingMode === 'user';
    const { width, height } = this.#canvas;
    this.#ctx.save();
    if (mirror) {
      this.#ctx.translate(width, 0);
      this.#ctx.scale(-1, 1);
    }
    this.#ctx.drawImage(this.#video, 0, 0, width, height);
    this.#ctx.restore();

    // 骨格検出
    const result = this.#detector.detect(this.#video, now);
    if (result !== null) {
      const valid = filterValidPoses(result.landmarks);
      this.#lastResult = valid.length > 0 ? { landmarks: valid } : null;
      this.#peopleCount.textContent = valid.length;
    }

    // 骨格描画
    if (this.#lastResult?.landmarks?.length > 0) {
      this.#renderer.draw(this.#lastResult.landmarks, mirror);
    }
  }

  #syncCanvasSize() {
    const container = this.#canvas.parentElement;
    const w = container.clientWidth;
    const vw = this.#video.videoWidth || 1280;
    const vh = this.#video.videoHeight || 720;
    this.#canvas.width = w;
    this.#canvas.height = Math.round((w * vh) / vw);
  }

  #setStatus(msg) {
    this.#statusText.textContent = msg;
  }
}

const app = new App();
app.init();
