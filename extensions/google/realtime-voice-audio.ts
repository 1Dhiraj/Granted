/**
 * Audio transcoding between the realtime-voice bridge format (G.711 mu-law @ 8 kHz,
 * as used by telephony media streams) and Gemini Live's PCM formats
 * (16-bit LE PCM @ 16 kHz in, 24 kHz out).
 */

const MU_LAW_BIAS = 0x84;
const MU_LAW_CLIP = 32635;

export function muLawEncodeSample(pcm: number): number {
  let sample = Math.max(-32768, Math.min(32767, Math.round(pcm)));
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) {
    sample = -sample;
  }
  if (sample > MU_LAW_CLIP) {
    sample = MU_LAW_CLIP;
  }
  sample += MU_LAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function muLawDecodeSample(muLaw: number): number {
  const inverted = ~muLaw & 0xff;
  const sign = inverted & 0x80;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  let sample = ((mantissa << 3) + MU_LAW_BIAS) << exponent;
  sample -= MU_LAW_BIAS;
  return sign ? -sample : sample;
}

/** mu-law @ 8 kHz -> 16-bit LE PCM @ 16 kHz (x2 linear-interpolation upsample). */
export function muLaw8kToPcm16k(muLaw: Buffer): Buffer {
  const n = muLaw.length;
  const out = Buffer.allocUnsafe(n * 2 * 2);
  let prev = n > 0 ? muLawDecodeSample(muLaw[0]) : 0;
  for (let i = 0; i < n; i++) {
    const current = muLawDecodeSample(muLaw[i]);
    out.writeInt16LE(Math.round((prev + current) / 2), i * 4);
    out.writeInt16LE(current, i * 4 + 2);
    prev = current;
  }
  return out;
}

/** 16-bit LE PCM @ 24 kHz -> mu-law @ 8 kHz (x3 decimation with 3-sample averaging). */
export function pcm24kToMuLaw8k(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / 2);
  const outSamples = Math.floor(samples / 3);
  const out = Buffer.allocUnsafe(outSamples);
  for (let i = 0; i < outSamples; i++) {
    const base = i * 3 * 2;
    const avg =
      (pcm.readInt16LE(base) + pcm.readInt16LE(base + 2) + pcm.readInt16LE(base + 4)) / 3;
    out[i] = muLawEncodeSample(avg);
  }
  return out;
}
