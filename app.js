import PoseDetector from './pose-detector.js';
import SkeletonRenderer from './skeleton-renderer.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

const DEFAULT_SETTINGS = {
  numPoses: 5,
  minPoseDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
  minVisibleLandmarks: 12,
};

function filterValidPoses(allLandmarks, minVisible) {
  return allLandmarks.filter(
    (lms) => lms.filter((lm) => (lm.visibility ?? 0) >= 0.5).length >= minVisible
  );
}

// 同一人物の重複検出を除去 (重心距離が閾値以下なら同一人物と判定)
const DEDUP_THRESHOLD = 0.1;

function deduplicatePoses(allLandmarks) {
  if (allLandmarks.length <= 1) return allLandmarks;

  const avgVis = (lms) =>
    lms.reduce((s, lm) => s + (lm.visibility ?? 0), 0) / lms.length;

  const center = (lms) => {
    const vis = lms.filter((lm) => (lm.visibility ?? 0) >= 0.5);
    if (vis.length === 0) return { x: 0.5, y: 0.5 };
    return {
      x: vis.reduce((s, lm) => s + lm.x, 0) / vis.length,
      y: vis.reduce((s, lm) => s + lm.y, 0) / vis.length,
    };
  };

  const centers = allLandmarks.map(center);
  const keep = allLandmarks.map(() => true);

  for (let i = 0; i < allLandmarks.length; i++) {
    if (!keep[i]) continue;
    for (let j = i + 1; j < allLandmarks.length; j++) {
      if (!keep[j]) continue;
      const dx = centers[i].x - centers[j].x;
      const dy = centers[i].y - centers[j].y;
      if (Math.hypot(dx, dy) < DEDUP_THRESHOLD) {
        // 信頼度の低い方を破棄
        if (avgVis(allLandmarks[i]) >= avgVis(allLandmarks[j])) {
          keep[j] = false;
        } else {
          keep[i] = false;
          break;
        }
      }
    }
  }

  return allLandmarks.filter((_, i) => keep[i]);
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
  #btnSettings = document.getElementById('btn-settings');
  #settingsPanel = document.getElementById('settings-panel');
  #peopleCount = document.getElementById('people-count');
  #fpsValue = document.getElementById('fps-value');

  #detector = new PoseDetector();
  #renderer = new SkeletonRenderer(document.getElementById('canvas'));

  #isRunning = false;
  #rafId = null;
  #lastResult = null;
  #facingMode = 'user';
  #settings = { ...DEFAULT_SETTINGS };

  #fpsFrames = 0;
  #fpsAccum = 0;
  #lastTs = 0;

  constructor() {
    this.#btnToggle.addEventListener('click', () => this.#toggle());
    this.#btnSwitch.addEventListener('click', () => this.#switchCamera());
    this.#btnSettings.addEventListener('click', () => this.#toggleSettings());
    window.addEventListener('resize', () => this.#syncCanvasSize());
    this.#initSettingsPanel();
  }

  #initSettingsPanel() {
    const bind = (id, key, transform = Number) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(`v-${id}`);
      el.value = this.#settings[key];
      valEl.textContent = this.#formatVal(key, this.#settings[key]);
      el.addEventListener('input', () => {
        this.#settings[key] = transform(el.value);
        valEl.textContent = this.#formatVal(key, this.#settings[key]);
      });
    };

    bind('s-num-poses', 'numPoses');
    bind('s-detection', 'minPoseDetectionConfidence');
    bind('s-tracking', 'minTrackingConfidence');
    bind('s-ghost', 'minVisibleLandmarks');

    document.getElementById('btn-settings-reset').addEventListener('click', () => {
      this.#settings = { ...DEFAULT_SETTINGS };
      ['s-num-poses', 's-detection', 's-tracking', 's-ghost'].forEach((id) => {
        const key = { 's-num-poses': 'numPoses', 's-detection': 'minPoseDetectionConfidence',
          's-tracking': 'minTrackingConfidence', 's-ghost': 'minVisibleLandmarks' }[id];
        document.getElementById(id).value = this.#settings[key];
        document.getElementById(`v-${id}`).textContent = this.#formatVal(key, this.#settings[key]);
      });
    });
  }

  #formatVal(key, val) {
    if (key === 'numPoses') return `${val} 人`;
    if (key === 'minVisibleLandmarks') return `${val} 点`;
    return `${Math.round(val * 100)} %`;
  }

  #toggleSettings() {
    const open = this.#settingsPanel.classList.toggle('open');
    this.#btnSettings.classList.toggle('active', open);
    this.#btnSettings.setAttribute('aria-expanded', open);
  }

  async init() {
    try {
      await this.#detector.init((msg) => this.#setStatus(msg), this.#settings);
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

    // 設定パネルを閉じる
    this.#settingsPanel.classList.remove('open');
    this.#btnSettings.classList.remove('active');

    try {
      await this.#detector.init((msg) => this.#setStatus(msg), this.#settings);

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

    // 映像描画
    const mirror = this.#facingMode === 'user';
    const { width, height } = this.#canvas;
    this.#ctx.save();
    if (mirror) {
      this.#ctx.translate(width, 0);
      this.#ctx.scale(-1, 1);
    }
    this.#ctx.drawImage(this.#video, 0, 0, width, height);
    this.#ctx.restore();

    // 骨格検出 → ゴーストフィルタ → 重複除去 (後二者は即時反映)
    const result = this.#detector.detect(this.#video, now);
    if (result !== null) {
      const valid = deduplicatePoses(
        filterValidPoses(result.landmarks, this.#settings.minVisibleLandmarks)
      );
      this.#lastResult = valid.length > 0 ? { landmarks: valid } : null;
      this.#peopleCount.textContent = valid.length;
    }

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
