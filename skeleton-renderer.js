// Per-person colors (up to 5 people)
const PERSON_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
];

// MediaPipe Pose Landmarker connections (landmark index pairs)
// Indices: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
const CONNECTIONS = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  // Upper body
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  // Torso
  [11, 23], [12, 24], [23, 24],
  // Lower body
  [23, 25], [25, 27], [27, 29], [29, 31],
  [24, 26], [26, 28], [28, 30], [30, 32],
];

const MIN_VISIBILITY = 0.5;
const JOINT_RADIUS = 5;
const LINE_WIDTH = 3;
const GLOW_BLUR = 12;

export default class SkeletonRenderer {
  #ctx;
  #canvas;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
  }

  /**
   * Draw all detected skeletons.
   * @param {Array} allLandmarks - Array of landmark arrays from PoseLandmarkerResult.landmarks
   * @param {boolean} mirror - Flip x-axis to match mirrored video display
   */
  draw(allLandmarks, mirror = true) {
    const ctx = this.#ctx;
    const { width, height } = this.#canvas;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < allLandmarks.length; i++) {
      const landmarks = allLandmarks[i];
      const color = PERSON_COLORS[i % PERSON_COLORS.length];

      const sx = (lm) => (mirror ? 1 - lm.x : lm.x) * width;
      const sy = (lm) => lm.y * height;
      const visible = (lm) => (lm.visibility ?? 1) >= MIN_VISIBILITY;

      // Skeleton lines
      ctx.strokeStyle = color;
      ctx.lineWidth = LINE_WIDTH;
      ctx.shadowColor = color;
      ctx.shadowBlur = GLOW_BLUR;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        const lmA = landmarks[a];
        const lmB = landmarks[b];
        if (!lmA || !lmB || !visible(lmA) || !visible(lmB)) continue;
        ctx.moveTo(sx(lmA), sy(lmA));
        ctx.lineTo(sx(lmB), sy(lmB));
      }
      ctx.stroke();

      // Joint circles
      ctx.fillStyle = color;
      ctx.shadowBlur = GLOW_BLUR * 0.6;
      for (const lm of landmarks) {
        if (!lm || !visible(lm)) continue;
        ctx.beginPath();
        ctx.arc(sx(lm), sy(lm), JOINT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
