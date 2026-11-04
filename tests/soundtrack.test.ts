import { afterEach, expect, it, vi } from 'vitest';
import { Soundtrack } from '../src/audio/soundtrack';
import type { AudioEngine } from '../src/audio/audio';

afterEach(() => vi.unstubAllGlobals());

it('retries a soundtrack blocked by autoplay after a later gesture', async () => {
  const play = vi.fn().mockRejectedValueOnce(new Error('NotAllowedError')).mockResolvedValue(undefined);
  const audio = { play, paused: true, addEventListener: vi.fn(), duration: 0, currentTime: 0, ended: false };
  vi.stubGlobal('Audio', vi.fn(function () { return audio; }));
  const gain = () => ({ gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} }, connect() { return this; } });
  const ctx = { currentTime: 0, createGain: gain, createAnalyser: () => ({ frequencyBinCount: 256, connect() {} }), createMediaElementSource: () => ({ connect: gain }) };
  const soundtrack = new Soundtrack({ ctx, musicBus: gain() } as unknown as AudioEngine);
  soundtrack.play('menu');
  await Promise.resolve();
  expect(soundtrack.active).toBe(false);
  soundtrack.retryPlayback();
  await Promise.resolve();
  expect(play).toHaveBeenCalledTimes(2);
  expect(soundtrack.active).toBe(true);
});
