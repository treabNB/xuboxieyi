export class GameAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.enabled = true;
    this.eventCount = 0;
    this.masterGain = 0.48;
  }

  unlock() {
    if (!this.enabled) {
      return;
    }
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        return;
      }
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.masterGain;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.master) {
      this.master.gain.setTargetAtTime(
        this.enabled ? this.masterGain : 0,
        this.context.currentTime,
        0.015,
      );
    }
    if (this.enabled) {
      this.unlock();
    }
    return this.enabled;
  }

  tone({
    frequency,
    endFrequency = frequency,
    duration,
    gain = 0.12,
    type = 'sine',
    delay = 0,
  }) {
    if (!this.context || !this.master || this.context.state !== 'running') {
      return;
    }
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFrequency),
      start + duration,
    );
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  noise({ duration, gain = 0.08, cutoff = 1200, delay = 0 }) {
    if (!this.context || !this.master || this.context.state !== 'running') {
      return;
    }
    if (!this.noiseBuffer) {
      this.noiseBuffer = this.context.createBuffer(
        1,
        this.context.sampleRate,
        this.context.sampleRate,
      );
      const data = this.noiseBuffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }
    }
    const start = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, start);
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    source.start(start);
    source.stop(start + duration);
  }

  playShot(weapon) {
    if (weapon === 'sniper') {
      this.tone({
        frequency: 150,
        endFrequency: 42,
        duration: 0.24,
        gain: 0.2,
        type: 'sawtooth',
      });
      this.noise({ duration: 0.18, gain: 0.1, cutoff: 900 });
      return;
    }
    if (weapon === 'mg') {
      this.tone({
        frequency: 125,
        endFrequency: 70,
        duration: 0.055,
        gain: 0.075,
        type: 'square',
      });
      this.noise({ duration: 0.04, gain: 0.045, cutoff: 1700 });
      return;
    }
    this.tone({
      frequency: 190,
      endFrequency: 78,
      duration: 0.09,
      gain: 0.12,
      type: 'triangle',
    });
  }

  playHit() {
    this.tone({
      frequency: 920,
      endFrequency: 420,
      duration: 0.065,
      gain: 0.09,
      type: 'square',
    });
  }

  playKill() {
    this.tone({
      frequency: 250,
      endFrequency: 72,
      duration: 0.3,
      gain: 0.16,
      type: 'sawtooth',
    });
  }

  playEvent(type, payload = {}) {
    if (!this.enabled) {
      return;
    }
    if (this.context?.state === 'running') {
      this.eventCount += 1;
    }
    if (type === 'shot') this.playShot(payload.weapon);
    else if (type === 'hit') this.playHit();
    else if (type === 'kill') this.playKill();
    else if (type === 'slide') {
      this.noise({ duration: 0.19, gain: 0.07, cutoff: 620 });
    } else if (type === 'reload') {
      this.tone({
        frequency: 480,
        endFrequency: 300,
        duration: 0.06,
        gain: 0.05,
        type: 'square',
      });
      this.tone({
        frequency: 360,
        endFrequency: 260,
        duration: 0.06,
        gain: 0.04,
        type: 'square',
        delay: 0.13,
      });
    } else if (type === 'flash-burst') {
      this.noise({ duration: 0.34, gain: 0.18, cutoff: 3600 });
      this.tone({
        frequency: 1100,
        endFrequency: 180,
        duration: 0.32,
        gain: 0.12,
        type: 'sine',
      });
    } else if (type === 'jam-release') {
      this.tone({
        frequency: 560,
        endFrequency: 92,
        duration: 0.48,
        gain: 0.1,
        type: 'sawtooth',
      });
    } else if (type === 'burn') {
      this.noise({ duration: 0.42, gain: 0.1, cutoff: 780 });
    } else if (type === 'recon') {
      this.tone({
        frequency: 720,
        endFrequency: 1440,
        duration: 0.17,
        gain: 0.07,
        type: 'sine',
      });
      this.tone({
        frequency: 920,
        endFrequency: 1640,
        duration: 0.18,
        gain: 0.05,
        type: 'sine',
        delay: 0.11,
      });
    } else if (type === 'assassinate') {
      this.tone({
        frequency: 88,
        endFrequency: 34,
        duration: 0.36,
        gain: 0.18,
        type: 'sawtooth',
      });
    } else if (type === 'shield') {
      this.tone({
        frequency: 700,
        endFrequency: 1040,
        duration: 0.12,
        gain: 0.07,
        type: 'sine',
      });
    }
  }

  playFootstep(sprinting) {
    if (!this.enabled) {
      return;
    }
    if (this.context?.state === 'running') {
      this.eventCount += 1;
    }
    this.noise({
      duration: sprinting ? 0.055 : 0.035,
      gain: sprinting ? 0.05 : 0.025,
      cutoff: sprinting ? 520 : 330,
    });
  }
}
