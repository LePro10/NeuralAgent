// Microphone for calls with Neural: mono, downsampled to 16 kHz, 40 ms PCM16 frames,
// plus the frame's level for the orb. Runs on the audio thread.
const OUT = 16000;
const FRAME = 640;

class Mic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / OUT;
    this.pos = 0;
    this.frame = new Int16Array(FRAME);
    this.n = 0;
    this.sum = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    // Linear interpolation is enough for speech recognition at these rates.
    for (; this.pos < ch.length; this.pos += this.step) {
      const i = Math.floor(this.pos);
      const a = ch[i];
      const b = i + 1 < ch.length ? ch[i + 1] : a;
      const v = Math.max(-1, Math.min(1, a + (b - a) * (this.pos - i)));
      this.sum += v * v;
      this.frame[this.n++] = v * 32767;
      if (this.n === FRAME) {
        this.port.postMessage({ pcm: this.frame.buffer, level: Math.sqrt(this.sum / FRAME) }, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME);
        this.n = 0;
        this.sum = 0;
      }
    }
    this.pos -= ch.length;
    return true;
  }
}

registerProcessor("neural-mic", Mic);
