// REGRESSION (must stay GREEN): ordinary production identifiers that merely
// START with "sample" — common in audio/analytics code — must NOT be flagged
// as mock data. The `sample`/`SAMPLE` token was removed from the NAME regex
// precisely because this lane is blocking by default and would otherwise fail
// any consumer with normal code like this.
export const sampleRate = 44100;
export const sampleSize = 16;
export const sampleCount = 8;
export const sampleData = new Float32Array(1024);
const SAMPLE_WINDOW = 512;

export function rms() {
  return Math.sqrt(sampleData.reduce((a, v) => a + v * v, 0) / SAMPLE_WINDOW);
}
