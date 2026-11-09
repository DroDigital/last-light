#!/usr/bin/env python3
"""
Measure offline SFX renders (scripts/sfx/render.mjs) for mix QA:

  peak     sample peak, dBFS (must stay below 0)
  loud     K-weighted momentary max (100 ms), dB: how loud it feels
  sust     K-weighted level averaged over the busy part (scenes)
  len      time until the tail falls 60 dB below peak
  harsh    share of energy in the 2-5 kHz fatigue band, %
  width    1 - L/R correlation (0 = mono, ~0.3 = wide)
  clicks   discontinuities: sample steps far above the local signal slope
"""
import math
import os
import sys
import wave

import numpy as np

SR = 48000


def read(path):
    with open(path, 'rb') as f:
        data = f.read()
    x = np.frombuffer(data[44:], dtype='<f4').reshape(-1, 2).astype(np.float64)
    return x[:, 0], x[:, 1]


def kw(x):
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = 1e-3
    return np.fft.irfft(X / np.sqrt(1 + (60 / f) ** 4) * (1 + 0.585 * f ** 2 / (f ** 2 + 1500 ** 2)), n)


def db(v):
    return 20 * math.log10(max(v, 1e-12))


def measure(path):
    l, r = read(path)
    m = (l + r) / 2
    pk = max(np.max(np.abs(l)), np.max(np.abs(r)))
    k = kw(m)
    w = int(0.1 * SR)
    c = np.cumsum(np.concatenate([[0], k ** 2]))
    win = (c[w:] - c[:-w]) / w
    loud = db(math.sqrt(win.max()))
    active = win > win.max() * 10 ** (-20 / 10)
    sust = db(math.sqrt(win[active].mean())) if active.any() else -120
    above = np.where(np.abs(m) > pk * 1e-3)[0]
    ln = (above[-1] - above[0]) / SR if len(above) else 0
    X = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(len(m), 1 / SR)
    harsh = 100 * X[(f > 2000) & (f < 5000)].sum() / max(X[f > 40].sum(), 1e-12)
    corr = np.corrcoef(l, r)[0, 1] if np.std(l) > 0 and np.std(r) > 0 else 1
    # click detector: second difference spikes vs a smoothed envelope of it
    d2 = np.abs(np.diff(m, 2))
    env = np.convolve(d2, np.ones(480) / 480, mode='same')
    clicks = int(np.sum((d2 > 12 * env + 0.02)))
    return dict(peak=db(pk), loud=loud, sust=sust, len=ln, harsh=harsh, width=1 - corr, clicks=clicks)


def main():
    d = sys.argv[1]
    rows = []
    for name in sorted(os.listdir(d)):
        if name.endswith('.wav'):
            rows.append((name[:-4], measure(os.path.join(d, name))))
    print(f"{'sound':14s} {'peak':>6s} {'loud':>6s} {'sust':>6s} {'len':>5s} {'harsh%':>6s} {'width':>5s} {'clicks':>6s}")
    for n, r in rows:
        flag = ' CLIP' if r['peak'] > -0.1 else ''
        print(f"{n:14s} {r['peak']:6.1f} {r['loud']:6.1f} {r['sust']:6.1f} {r['len']:5.2f} {r['harsh']:6.1f} {r['width']:5.2f} {r['clicks']:6d}{flag}")


if __name__ == '__main__':
    main()
