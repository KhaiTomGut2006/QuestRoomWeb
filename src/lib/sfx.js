/**
 * Cozy UI sound effects — synthesized via Web Audio API (no audio files needed).
 * All sounds are soft, warm, and non-jarring to match a cozy game aesthetic.
 */

let _ctx = null;
let _masterGain = null;
let _volume = 0.5;
let _muted = false;

function getAudio() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = _muted ? 0 : _volume * 0.45;
    _masterGain.connect(_ctx.destination);
  }
  if (_ctx.state === "suspended") _ctx.resume().catch(() => {});
  return _ctx;
}

export function setSfxVolume(vol) {
  _volume = Math.max(0, Math.min(1, vol));
  if (_masterGain) _masterGain.gain.value = _muted ? 0 : _volume * 0.45;
}

export function setSfxMuted(muted) {
  _muted = Boolean(muted);
  if (_masterGain) _masterGain.gain.value = _muted ? 0 : _volume * 0.45;
}

// ── Primitive builders ──────────────────────────────────────────────

function tone(freq, start, dur, peak = 0.5, type = "sine") {
  const ctx = _ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + Math.min(0.025, dur * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(_masterGain);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function glide(freqA, freqB, start, dur, peak = 0.4, type = "sine") {
  const ctx = _ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqA, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqB, 10), start + dur);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(_masterGain);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

// ── Sound definitions ───────────────────────────────────────────────

const SOUNDS = {
  // Generic soft button tap
  click(t) {
    tone(420, t, 0.10, 0.4);
    tone(340, t + 0.04, 0.08, 0.2);
  },

  // Open a modal / dialog — warm rising chime (C-E-G)
  open(t) {
    tone(523, t, 0.35, 0.38);
    tone(659, t + 0.09, 0.32, 0.33);
    tone(784, t + 0.18, 0.42, 0.28);
  },

  // Close a modal — gentle descending ping
  close(t) {
    tone(659, t, 0.20, 0.30);
    tone(523, t + 0.09, 0.22, 0.22);
  },

  // NPC arrives at the door — two-note soft doorbell
  npc_arrive(t) {
    tone(784, t, 0.50, 0.42);
    tone(659, t + 0.24, 0.55, 0.36);
  },

  // Quest accepted — warm ascending arpeggio
  quest_accept(t) {
    tone(392, t, 0.38, 0.38);
    tone(523, t + 0.11, 0.38, 0.38);
    tone(659, t + 0.22, 0.52, 0.40);
  },

  // Quest submitted successfully — bright celebratory chime
  quest_submit(t) {
    tone(523, t, 0.22, 0.48);
    tone(659, t + 0.10, 0.22, 0.44);
    tone(784, t + 0.20, 0.22, 0.44);
    tone(1047, t + 0.30, 0.50, 0.40);
  },

  // Quest cancelled — soft drop
  quest_cancel(t) {
    tone(523, t, 0.22, 0.28);
    tone(415, t + 0.13, 0.28, 0.22);
  },

  // Chest opened — magical sparkle arpeggio
  chest_open(t) {
    [523, 659, 784, 988, 1047, 1319].forEach((f, i) =>
      tone(f, t + i * 0.065, 0.45, 0.32)
    );
  },

  // Coins received — light coin jingle
  coin_gain(t) {
    tone(1319, t, 0.14, 0.38);
    tone(1568, t + 0.07, 0.14, 0.32);
    tone(1319, t + 0.14, 0.18, 0.28);
  },

  // Shop purchase — satisfying shop bell (D-F#-A)
  buy(t) {
    tone(587, t, 0.28, 0.40);
    tone(740, t + 0.11, 0.28, 0.36);
    tone(880, t + 0.22, 0.38, 0.34);
  },

  // Gamble coin flip — spinning tremolo
  gamble_flip(t) {
    for (let i = 0; i < 7; i++) {
      tone(880, t + i * 0.065, 0.06, Math.max(0.08, 0.25 - i * 0.025));
    }
  },

  // Gamble win — short happy fanfare
  gamble_win(t) {
    tone(523, t, 0.14, 0.48);
    tone(659, t + 0.09, 0.14, 0.48);
    tone(784, t + 0.18, 0.14, 0.48);
    tone(1047, t + 0.27, 0.50, 0.45);
  },

  // Gamble lose — sad descending tones
  gamble_lose(t) {
    tone(523, t, 0.28, 0.28);
    tone(415, t + 0.16, 0.28, 0.24);
    tone(311, t + 0.32, 0.38, 0.22);
  },

  // Kick Begger out — comic descending slide
  kick_out(t) {
    glide(550, 130, t, 0.42, 0.36, "sawtooth");
  },

  // Not enough coins / error — gentle soft thud
  error(t) {
    tone(220, t, 0.22, 0.32);
    tone(185, t + 0.09, 0.22, 0.24);
  },

  // Hint revealed — soft magical shimmer
  hint_reveal(t) {
    tone(988, t, 0.30, 0.30);
    tone(1175, t + 0.10, 0.30, 0.28);
    tone(1319, t + 0.20, 0.38, 0.26);
  },
};

/**
 * Play a named sound effect.
 * @param {keyof typeof SOUNDS} name
 */
export function playSfx(name) {
  if (_muted || _volume === 0) return;
  try {
    const ctx = getAudio();
    const fn = SOUNDS[name];
    if (fn) fn(ctx.currentTime);
  } catch {
    // Silently ignore — audio errors should never break the UI
  }
}
