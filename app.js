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
      this.#lastResult = null;
      this.#overlay.classList.add('hidden');
      this.#btnToggle.classList.add('running');
      this.#btnLabel.textContent = 'カメラ停止';
      this.#btnIcon.innerHTML = '&#9646;&#9646;';
      this.#btnToggle.disabled = false;

      this.#loop(performance.now());
    } catch (err) {
      this.#setStatus(`カメラ起動失敗: ${err.message}`);
      this.#spinner.classList.add('hidden');
      this.#overlay.classList.remove('hidden');
      this.#btnToggle.disabled = false;
    }
  }

  #stop() {
    this.#isRunning = false;
    cancelAnimationFrame(this.#rafId);

    this.#video.srcObject?.getTracks().forEach((t) => t.stop());
    this.#video.srcObject = null;

    this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#lastResult = null;

    this.#overlay.classList.remove('hidden');
    this.#spinner.classList.add('hidden');
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

    // FPS calculation (updated every 500 ms)
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

    // Draw mirrored video frame
    const { width, height } = this.#canvas;
    this.#ctx.save();
    this.#ctx.translate(width, 0);
    this.#ctx.scale(-1, 1);
    this.#ctx.drawImage(this.#video, 0, 0, width, height);
    this.#ctx.restore();

    // Pose detection (skips if video frame hasn't advanced)
    const result = this.#detector.detect(this.#video, now);
    if (result !== null) {
      this.#lastResult = result;
      this.#peopleCount.textContent = result.landmarks.length;
    }

    // Render skeleton from latest result
    if (this.#lastResult?.landmarks?.length > 0) {
      this.#renderer.draw(this.#lastResult.landmarks, true);
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
