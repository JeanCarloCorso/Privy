let context: AudioContext | null = null;

function audioContext() {
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function tone(frequency: number, startsIn: number, duration: number, gain = 0.055) {
  const ctx = audioContext();
  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  volume.gain.setValueAtTime(0.0001, ctx.currentTime + startsIn);
  volume.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + startsIn + 0.015);
  volume.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startsIn + duration);
  oscillator.connect(volume).connect(ctx.destination);
  oscillator.start(ctx.currentTime + startsIn);
  oscillator.stop(ctx.currentTime + startsIn + duration + 0.02);
  const cancel = () => {
    volume.gain.cancelScheduledValues(ctx.currentTime);
    volume.gain.setValueAtTime(0.0001, ctx.currentTime);
    try { oscillator.stop(); } catch { /* the tone already ended */ }
    oscillator.disconnect();
    volume.disconnect();
  };
  oscillator.addEventListener('ended', () => { oscillator.disconnect(); volume.disconnect(); }, { once: true });
  return cancel;
}

export function playMessageSound() {
  tone(740, 0, 0.12, 0.035);
  tone(980, 0.1, 0.18, 0.04);
}

export function startRingtone() {
  let stopped = false;
  const activeTones = new Set<() => void>();
  const ring = () => {
    if (stopped) return;
    for (const cancel of activeTones) cancel();
    activeTones.clear();
    activeTones.add(tone(440, 0, 0.32));
    activeTones.add(tone(554, 0.34, 0.32));
    activeTones.add(tone(659, 0.68, 0.38));
  };
  ring();
  const timer = window.setInterval(ring, 2_200);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    for (const cancel of activeTones) cancel();
    activeTones.clear();
  };
}
