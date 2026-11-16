/** Actual PCM bytes for integrity tests; never evidence of sung lyrics. */
export function syntheticWav(seconds = 5) {
  const rate = 16000, frames = rate * seconds, b = Buffer.alloc(44 + frames * 2);
  b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 5000), 44 + i * 2);
  return b;
}
