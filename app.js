import PoseDetector from './pose-detector.js';
import SkeletonRenderer from './skeleton-renderer.js';

// Register Service Worker for offline caching
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

class App {
  // DOM elements
  #video = document.getElementById('video');
  #canvas = document.getElementById('canvas');
  #ctx = document.getElementById('canvas').getContext('2d');
  #overlay = document.getElementById('overlay');
  #spinner = document.querySelector('.spinner');
  #statusText = document.getElementById('status-text');
  #btnToggle = document.getElementById('btn-toggle');
  #btnLabel = document.getElementById('btn-label');
  #btnIcon = document.getElementById('btn-icon');
  #peopleCount = document.getElementById('people-count');
  #fpsValue = document.getElementById('fps-value');

  // Engine
  #detector = new PoseDetector();
  #renderer = new SkeletonRenderer(document.getElementById('canvas'));

  // State
  #isRunning = false;
  #rafId = null;
  #lastResult = null;

  // FPS tracking
  #fpsFrames = 0;
  #fpsAccum = 0;
  #lastTs = 0;

  constructor() {
    this.#btnToggle.addEventListener('click', () => this.#toggle());
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
      await this.#start();
    }
  }

async #start() {
    this.#btnToggle.disabled = true;
    try {
      // 2回目以降の起動時に MediaPipe の内部グラフをリセットするため init を実行
      // これにより「timestamp mismatch」エラーを回避できます
      await this.#detector.init((msg) => this.#setStatus(msg));

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      this.#video.srcObject = stream;
      await this.#video.play();

      this.#syncCanvasSize();
      this.#isRunning = true;
      
      // 状態を完全にクリア
      this.#lastResult = null;
      this.#lastTs = performance.now(); 

      this.#overlay.classList.add('hidden');
      this.#btnToggle.classList.add('running');
      this.#btnLabel.textContent = 'カメラ停止';
      this.#btnIcon.innerHTML = '&#9646;&#9646;';
      this.#btnToggle.disabled = false;

      this.#loop(performance.now());
    } catch (err) {
      this.#setStatus(`カメラ起動失敗: ${err.message}`);
      this.#btnToggle.disabled = false;
    }
  }

  #stop() {
    this.#isRunning = false;
    cancelAnimationFrame(this.#rafId);

    this.#video.srcObject?.getTracks().forEach((t) => t.stop());
    this.#video.srcObject = null;

    // detector を破棄して MediaPipe の内部インスタンスを解放
    this.#detector.dispose();

    this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#lastResult = null;

    this.#overlay.classList.remove('hidden');
    this.#setStatus('停止中。カメラを起動するにはボタンを押してください。');
    this.#btnToggle.classList.remove('running');
    this.#btnLabel.textContent = 'カメラ起動';
    this.#btnIcon.innerHTML = '&#9654;';
    this.#peopleCount.textContent = '—';
    this.#fpsValue.textContent = '—';
  }

  #loop(now) {
    if (!this.#isRunning) return;
    this.#rafId = requestAnimationFrame((ts) => this.#loop(ts));

    // FPS計算... (中略)

    // ビデオ描画
    const { width, height } = this.#canvas;
    this.#ctx.save();
    this.#ctx.translate(width, 0);
    this.#ctx.scale(-1, 1);
    this.#ctx.drawImage(this.#video, 0, 0, width, height);
    this.#ctx.restore();

    // 骨格検知
    const result = this.#detector.detect(this.#video, now);
    
    // 修正：検出された時だけでなく、常に latestResult を更新する
    // これにより、人がいなくなった時に古い骨格が残り続けるのを防ぎます
    if (result) {
      this.#lastResult = result;
      this.#peopleCount.textContent = result.landmarks.length;
    } else {
      // 完全に null の場合はカウント 0
      this.#peopleCount.textContent = '0';
    }

    // 描画：landmarks が空配列の場合も考慮する
    if (this.#lastResult && this.#lastResult.landmarks && this.#lastResult.landmarks.length > 0) {
      this.#renderer.draw(this.#lastResult.landmarks, true);
    } else {
      this.#peopleCount.textContent = '0';
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
