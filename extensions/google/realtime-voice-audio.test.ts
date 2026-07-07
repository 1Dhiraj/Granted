import { describe, expect, it } from "vitest";
import {
  muLaw8kToPcm16k,
  muLawDecodeSample,
  muLawEncodeSample,
  pcm24kToMuLaw8k,
} from "./realtime-voice-audio.js";

describe("mu-law codec", () => {
  it("round-trips representative samples within quantization error", () => {
    for (const sample of [0, 100, -100, 1000, -1000, 8000, -8000, 30000, -30000]) {
      const decoded = muLawDecodeSample(muLawEncodeSample(sample));
      // mu-law is logarithmic: allow ~6% relative error, 40 absolute near zero.
      const tolerance = Math.max(40, Math.abs(sample) * 0.06);
      expect(Math.abs(decoded - sample)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("clamps out-of-range PCM instead of overflowing", () => {
    expect(() => muLawEncodeSample(40000)).not.toThrow();
    expect(muLawDecodeSample(muLawEncodeSample(40000))).toBeGreaterThan(30000);
  });
});

describe("resampling", () => {
  it("upsamples mu-law 8k to twice as many 16-bit samples", () => {
    const muLaw = Buffer.from([0xff, 0x7f, 0x00, 0x80]);
    const pcm = muLaw8kToPcm16k(muLaw);
    expect(pcm.length).toBe(muLaw.length * 2 * 2);
  });

  it("downsamples 24k PCM to one mu-law byte per three samples", () => {
    const pcm = Buffer.alloc(6 * 2);
    for (let i = 0; i < 6; i++) {
      pcm.writeInt16LE(1000, i * 2);
    }
    const muLaw = pcm24kToMuLaw8k(pcm);
    expect(muLaw.length).toBe(2);
    expect(Math.abs(muLawDecodeSample(muLaw[0]) - 1000)).toBeLessThanOrEqual(60);
  });

  it("survives a full speech-path round trip (8k mu-law sine -> 16k pcm)", () => {
    const samples = 160; // 20ms frame at 8kHz
    const muLaw = Buffer.alloc(samples);
    for (let i = 0; i < samples; i++) {
      muLaw[i] = muLawEncodeSample(Math.round(Math.sin(i / 5) * 5000));
    }
    const pcm = muLaw8kToPcm16k(muLaw);
    expect(pcm.length).toBe(samples * 4);
    // energy is preserved: peak of the upsampled signal stays in the same ballpark
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 2) {
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    }
    expect(peak).toBeGreaterThan(4000);
    expect(peak).toBeLessThan(6000);
  });
});
