const WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

const MODEL_LOCAL = './models/pose_landmarker_lite.task';
const MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

export default class PoseDetector {
  #landmarker = null;
  #lastVideoTime = -1;

  async init(onProgress) {
    onProgress?.('MediaPipe WASM を読み込み中…');

    const { PoseLandmarker, FilesetResolver } = await import(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
    );

    const vision = await FilesetResolver.forVisionTasks(WASM_CDN);

    const modelPath = await this.#resolveModelPath(onProgress);
    onProgress?.('ポーズモデルを初期化中…');

    const baseConfig = {
      runningMode: 'VIDEO',
      numPoses: 5,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };

    try {
      this.#landmarker = await PoseLandmarker.createFromOptions(vision, {
        ...baseConfig,
        baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
      });
    } catch {
      // GPU unavailable — fall back to CPU
      this.#landmarker = await PoseLandmarker.createFromOptions(vision, {
        ...baseConfig,
        baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
      });
    }
  }

  async #resolveModelPath(onProgress) {
    try {
      const resp = await fetch(MODEL_LOCAL, { method: 'HEAD' });
      if (resp.ok) return MODEL_LOCAL;
    } catch { /* ignore */ }

    onProgress?.('モデルを CDN からダウンロード中…');
    return MODEL_CDN;
  }

  detect(video, timestampMs) {
    if (!this.#landmarker) return null;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    if (video.currentTime === this.#lastVideoTime) return null;
    this.#lastVideoTime = video.currentTime;
    return this.#landmarker.detectForVideo(video, timestampMs);
  }

  dispose() {
    this.#landmarker?.close();
    this.#landmarker = null;
  }
}
