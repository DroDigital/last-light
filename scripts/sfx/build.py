#!/usr/bin/env python3
"""
Build LAST LIGHT's sound-effect sprite from pinned, freely licensed sources.

    python3 scripts/sfx/build.py            # writes public/sfx/sfx.ogg + sfx.json

Every clip is downloaded from a commit-pinned GitHub mirror (see SOURCES),
then edited the same way a sound designer would in a DAW:

  * decode to 48 kHz mono, optional reverse / tape-style pitch shift
  * high-pass (rumble, DC) and low-pass (fizz) cleanup
  * gentle de-harsh EQ dips in the 2.5-4.5 kHz "ear fatigue" band
  * auto-trim of leading silence, tail trim at -60 dB with an equal-power fade
  * 1-3 ms fade-in so nothing clicks
  * seamless equal-power loop crossfades for sustained beds
  * loudness normalisation to one perceptual target (K-weighted, 100 ms
    momentary window) with a -1 dBFS peak ceiling, so the in-game mix table
    (src/audio/patches.ts) is the only place levels are decided

All clips are packed into one Ogg Vorbis sprite with silent gaps, plus a JSON
index of offsets and measured loudness. Requires ffmpeg (with libvorbis) and
numpy. Downloads are cached in .sfx-cache/ (git-ignored).
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import urllib.request
from dataclasses import dataclass, field

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, '.sfx-cache')
OUT_DIR = os.path.join(ROOT, 'public', 'sfx')
SR = 48000
TARGET_LOUD = -18.0  # dB, K-weighted momentary max
PEAK_CEIL = -1.0  # dBFS
GAP = 0.12  # s of silence between sprite clips

KENNEY = 'https://raw.githubusercontent.com/ETdoFresh/kenney.nl/45df48c4d45f8716216b1a9e22df0b69cd9f5932/'
SOURCES = {
    # Kenney packs, CC0 1.0 (https://kenney.nl)
    'scifi': 'https://raw.githubusercontent.com/Boyquotes/kenney-sci-fi-sounds-for-godot/'
    'c094967fe930c57ddb376f67c75f8aa0296690b7/addons/kenney%20sci-fi%20sounds/',
    'impact': KENNEY + 'kenney_impactsounds/Audio/',
    'ui': KENNEY + 'kenney_interfacesounds/Audio/',
    'digital': KENNEY + 'kenney_digitalaudio/Audio/',
    'shooter': KENNEY + 'spaceshooter/Bonus/',
    # Oculus Audio Pack 01, CC BY 4.0, (c) 2015 Oculus VR, LLC
    'oculus': 'https://raw.githubusercontent.com/facebookincubator/Meta-open-sound/'
    '251c0be57d5d1b3242b91f53e0cde62ab1cb42d9/corpora/oculus-audio-pack/ogg/',
}


@dataclass
class Clip:
    name: str
    src: str
    file: str
    start: float = 0.0  # s, after auto-trim (or absolute when trim=False)
    dur: float | None = None  # s, hard length before fade
    pitch: float = 1.0  # tape-style: also changes length
    hp: float = 40.0
    lp: float = 14000.0
    eq: list[tuple[float, float, float]] = field(default_factory=list)  # (Hz, dB, Q)
    fade_in: float = 0.002
    fade_out: float = 0.04
    reverse: bool = False
    trim: bool = True
    loop: float = 0.0  # crossfade length; > 0 makes a seamless loop
    deharsh: bool = True


CLIPS: list[Clip] = []


def add(name: str, src: str, file: str, **kw) -> None:
    CLIPS.append(Clip(name, src, file, **kw))


def many(prefix: str, src: str, files: list[str], **kw) -> None:
    for i, f in enumerate(files):
        add(f'{prefix}{i}', src, f, **kw)


def rng(fmt: str, idx) -> list[str]:
    return [fmt.format(i) for i in idx]


# ------------------------------------------------------------------ player weapons
# Groups are curated for a coherent pitch family: takes that jump an octave or
# land in the 2-5 kHz band were measured (scripts/sfx/measure.py) and left out.
many('kin_b', 'scifi', rng('laser_small_{:03d}.ogg', range(5)), pitch=0.82, hp=110, lp=7500, dur=0.16, fade_out=0.08)
many('tick_m', 'impact', rng('impactMetal_light_{:03d}.ogg', range(5)), hp=900, lp=11000, dur=0.09, fade_out=0.05)
many('en', 'digital', ['laser5.ogg', 'laser6.ogg', 'laser7.ogg', 'laser9.ogg'], hp=220, lp=9000, dur=0.30, fade_out=0.16)
many('hv', 'scifi', rng('laser_large_{:03d}.ogg', range(5)), pitch=0.72, hp=60, lp=6000, dur=0.42, fade_out=0.22)
many('plate_h', 'impact', rng('impactPlate_heavy_{:03d}.ogg', range(5)), hp=150, lp=9000, dur=0.25, fade_out=0.12)
many('rail_c', 'scifi', rng('laser_large_{:03d}.ogg', [2, 3, 4]), hp=380, lp=12000, dur=0.36, fade_out=0.22)
many('ffield', 'scifi', rng('force_field_{:03d}.ogg', range(5)), hp=60, lp=9000, fade_out=0.18)
many('sub', 'scifi', rng('low_frequency_explosion_{:03d}.ogg', range(2)), hp=24, lp=900, fade_out=0.35, deharsh=False)
many('scat', 'scifi', rng('explosion_crunch_{:03d}.ogg', range(4)), hp=90, lp=9000, dur=0.30, fade_out=0.18)
many('arc', 'digital', ['zap1.ogg', 'zap2.ogg'], hp=300, lp=10000, dur=0.32, fade_out=0.16)
many('glitch', 'ui', rng('glitch_{:03d}.ogg', range(1, 5)), hp=500, lp=12000, fade_out=0.01)
for i, st in enumerate([1.2, 2.0, 2.8, 3.6]):
    add(f'mis{i}', 'scifi', 'thruster_fire_001.ogg', trim=False, start=st, dur=0.5, fade_in=0.012, fade_out=0.3, hp=200, lp=7000)
many('mine', 'ui', ['toggle_001.ogg', 'toggle_004.ogg'], hp=300, lp=11000)
many('exo', 'digital', rng('phaseJump{}.ogg', range(1, 6)), pitch=0.8, hp=120, lp=7000, fade_out=0.12)
many('drone', 'scifi', rng('laser_retro_{:03d}.ogg', range(4)), pitch=1.25, hp=400, lp=7000, dur=0.10, fade_out=0.06)
many('glass', 'ui', ['glass_001.ogg', 'glass_003.ogg', 'glass_004.ogg', 'pluck_001.ogg', 'pluck_002.ogg'], hp=500, lp=12000, fade_out=0.05)
add('beam_loop', 'scifi', 'space_engine_003.ogg', trim=False, start=0.4, dur=2.8, pitch=1.3, hp=200, lp=5200, loop=0.4, fade_in=0, fade_out=0)

# ------------------------------------------------------------------ impacts & feedback
many('hit', 'impact', rng('impactPlate_light_{:03d}.ogg', range(5)), hp=250, lp=11000, fade_out=0.05)
many('crit', 'impact', rng('impactGlass_medium_{:03d}.ogg', range(5)), hp=600, lp=12000, fade_out=0.06)
many('bell', 'impact', rng('impactBell_heavy_{:03d}.ogg', range(2)), hp=200, lp=10000, fade_out=0.3)
many('boom_s', 'scifi', rng('explosion_crunch_{:03d}.ogg', range(4)), hp=50, lp=8000, dur=0.55, fade_out=0.3)
# crunch 004 is left out: its debris crackle reads as clicks at speed
many('boom_l', 'scifi', rng('explosion_crunch_{:03d}.ogg', range(1, 4)), hp=35, lp=7000, fade_out=0.45)
many('punch', 'impact', rng('impactPunch_heavy_{:03d}.ogg', range(5)), hp=50, lp=7000, fade_out=0.08)
many('hull', 'oculus', rng('METLImpt_MetalHitSurface_OS_{:02d}.ogg', range(1, 6)), hp=120, lp=9000, dur=0.6, fade_out=0.35)
many('glass_h', 'impact', rng('impactGlass_heavy_{:03d}.ogg', range(5)), hp=300, lp=12000, fade_out=0.08)
add('shield_dn', 'shooter', 'sfx_shieldDown.ogg', hp=150, lp=10000)
add('shield_up', 'shooter', 'sfx_shieldUp.ogg', hp=150, lp=10000)
many('whs', 'oculus', rng('WHSH_WhooshSmall_OS_{:02d}.ogg', range(1, 4)), hp=400, lp=12000, fade_out=0.04)
many('whm', 'oculus', rng('WHSH_WhooshMedium_OS_{:02d}.ogg', range(1, 4)), hp=150, lp=12000, fade_out=0.05)
many('swsh', 'oculus', rng('SWSH_Swoosh_OS_{:02d}.ogg', range(1, 7)), hp=150, lp=10000, fade_out=0.08)
many('thump', 'impact', rng('impactSoft_heavy_{:03d}.ogg', range(5)), pitch=0.7, hp=30, lp=600, fade_out=0.08, deharsh=False)
# soft pitched glass (~1.9 kHz fundamental), retuned per note at runtime for pickups
many('tink', 'ui', ['glass_001.ogg', 'glass_003.ogg'], hp=300, lp=10000, fade_out=0.05)
many('ping', 'ui', ['glass_005.ogg', 'glass_006.ogg', 'glass_002.ogg'], hp=700, lp=12000, fade_out=0.03)
many('pwr', 'digital', ['powerUp1.ogg', 'powerUp3.ogg', 'powerUp12.ogg'], hp=200, lp=9000, fade_out=0.2)
many('pwr_m', 'oculus', rng('UIMisc_Powerup_OS_{:02d}.ogg', range(1, 3)), hp=200, lp=11000, fade_out=0.25)
many('ph_dn', 'digital', rng('phaserDown{}.ogg', range(1, 4)), hp=150, lp=8000, fade_out=0.12)
many('ph_up', 'digital', ['phaserUp1.ogg', 'phaserUp3.ogg', 'phaserUp6.ogg'], pitch=0.6, hp=100, lp=6000, fade_out=0.15)
add('chime_up', 'oculus', 'UIMisc_BelltreeUp_OS_01.ogg', dur=3.4, hp=400, lp=11000, fade_out=1.2, eq=[(6500, -3, 0.8)])
add('chime_dn', 'oculus', 'UIMisc_BelltreeDown_OS_01.ogg', dur=3.4, hp=400, lp=10000, fade_out=1.2, eq=[(6500, -3, 0.8)])
many('dread', 'oculus', rng('DSGNImpt_ImpactCreepyReverb_OS_{:02d}.ogg', range(1, 4)), hp=30, lp=9000, dur=2.3, fade_out=0.9)
add('creep', 'oculus', 'DSGNDron_DroneCreepy_OS_01.ogg', trim=False, start=4.0, dur=5.0, hp=40, lp=3000, fade_in=0.8, fade_out=1.8)
many('zapt', 'digital', ['zapTwoTone.ogg', 'zapThreeToneUp.ogg'], hp=250, lp=9000, dur=0.5, fade_out=0.25)

# ------------------------------------------------------------------ enemies & threats
many('eshot', 'scifi', ['laser_small_000.ogg', 'laser_small_003.ogg', 'laser_retro_004.ogg', 'laser_small_004.ogg'],
     pitch=0.85, hp=150, lp=5000, dur=0.2, fade_out=0.12)
many('ebig', 'oculus', rng('LASRGun_LaserShootUI_OS_{:02d}.ogg', range(1, 3)), pitch=0.7, hp=80, lp=5000, dur=0.6, fade_out=0.35)
many('tele', 'digital', ['twoTone1.ogg', 'twoTone2.ogg'], hp=300, lp=6000, dur=0.45, fade_out=0.15)

# ------------------------------------------------------------------ movement & warp
add('spool', 'scifi', 'engine_circular_001.ogg', trim=False, start=0.5, dur=3.2, hp=80, lp=7000, fade_in=0.4, fade_out=0.3)
add('rumble_loop', 'scifi', 'space_engine_low_003.ogg', trim=False, start=0.5, dur=3.5, hp=25, lp=1200, loop=0.5, fade_in=0, fade_out=0, deharsh=False)
add('engine_loop', 'scifi', 'space_engine_small_000.ogg', trim=False, start=0.6, dur=3.5, hp=80, lp=4000, loop=0.5, fade_in=0, fade_out=0)
add('thrust_loop', 'scifi', 'thruster_fire_003.ogg', trim=False, start=1.2, dur=3.0, hp=150, lp=6500, loop=0.5, fade_in=0, fade_out=0)

# ------------------------------------------------------------------ interface
many('ui_tap', 'ui', ['select_002.ogg', 'select_007.ogg'], hp=400, lp=11000, fade_out=0.02)
many('ui_click', 'ui', ['click_001.ogg', 'click_002.ogg', 'click_004.ogg', 'click_005.ogg'], hp=400, lp=12000, fade_out=0.005)
add('ui_conf', 'oculus', 'UIClick_ScifiTraditionalConfirm_OS_01.ogg', hp=250, lp=11000, fade_out=0.1)
add('ui_open', 'oculus', 'UIClick_ScifiTraditionalOpen_OS_01.ogg', hp=250, lp=11000, fade_out=0.1)
add('ui_back', 'oculus', 'UIClick_ScifiTraditionalBack_OS_01.ogg', hp=250, lp=11000, fade_out=0.1)
add('ui_err', 'oculus', 'UIAlert_ScifiHightechError_OS_01.ogg', hp=200, lp=9000, fade_out=0.05)
# only the two warm confirmations: the other takes are 3.5-4.7 kHz beeps that tire the ear
many('ui_buy', 'ui', ['confirmation_001.ogg', 'confirmation_004.ogg'], hp=250, lp=11000, fade_out=0.08)

# ------------------------------------------------------------------ ambience beds
add('amb_hum', 'oculus', 'MACHMisc_MachineHum_LOOP_01.ogg', trim=False, start=2.0, dur=16.0, hp=30, lp=900, loop=1.5, fade_in=0, fade_out=0, deharsh=False)
add('amb_air', 'oculus', 'AMBInd_RoomToneMachineRoom_LOOP_01.ogg', trim=False, start=5.0, dur=16.0, hp=60, lp=2500, loop=1.5, fade_in=0, fade_out=0)
add('amb_void', 'oculus', 'DSGNDron_DroneCreepy_OS_02.ogg', trim=False, start=10.0, dur=20.0, hp=40, lp=1500, loop=3.0, fade_in=0, fade_out=0)


# ============================================================================ processing

def fetch(src: str, file: str) -> str:
    os.makedirs(os.path.join(CACHE, src), exist_ok=True)
    path = os.path.join(CACHE, src, file)
    if not os.path.exists(path):
        url = SOURCES[src] + file
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
        with open(path + '.part', 'wb') as f:
            f.write(data)
        os.replace(path + '.part', path)
    return path


def decode(path: str, c: Clip) -> np.ndarray:
    chain = []
    if c.reverse:
        chain.append('areverse')
    if c.pitch != 1.0:
        chain += [f'asetrate={SR * c.pitch:.0f}', f'aresample={SR}']
    chain.append(f'highpass=f={c.hp}:poles=2')
    chain.append(f'highpass=f={c.hp}:poles=2')  # 24 dB/oct total
    chain.append(f'lowpass=f={c.lp}:poles=2')
    if c.deharsh:
        # fatigue band: a soft dip where the ear is most sensitive, and a little air trim
        chain.append('equalizer=f=3400:t=q:w=1.1:g=-2.5')
        chain.append('highshelf=f=9000:g=-2')
    for f, g, q in c.eq:
        chain.append(f'equalizer=f={f}:t=q:w={q}:g={g}')
    cmd = ['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-af', ','.join(chain), '-f', 'f32le', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def db(x: float) -> float:
    return 20 * math.log10(max(x, 1e-12))


def k_weight(x: np.ndarray) -> np.ndarray:
    """Approximate ITU-R BS.1770 K-weighting (high-pass + high shelf) in the frequency domain."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = 1e-3
    hp = 1 / np.sqrt(1 + (60 / f) ** 4)
    shelf = 1 + (10 ** (4 / 20) - 1) * (f ** 2 / (f ** 2 + 1500 ** 2))
    return np.fft.irfft(X * hp * shelf, n)


def loudness(x: np.ndarray) -> float:
    k = k_weight(x)
    w = int(0.1 * SR)
    if len(k) <= w:
        return db(math.sqrt(np.mean(k ** 2)))
    c = np.cumsum(np.concatenate([[0], k ** 2]))
    hop = int(0.0125 * SR)
    m = max((c[i + w] - c[i]) / w for i in range(0, len(k) - w, hop))
    return db(math.sqrt(m))


def edit(x: np.ndarray, c: Clip) -> np.ndarray:
    # (the high-pass in decode() already removed DC)
    pk = np.max(np.abs(x)) + 1e-12
    if c.trim:
        above = np.where(np.abs(x) > pk * 10 ** (-45 / 20))[0]
        s = max(0, above[0] - int(0.002 * SR)) if len(above) else 0
        x = x[s:]
    # trimmed clips: start is in output time; untrimmed: start is a source timestamp
    x = x[int((c.start if c.trim else c.start / c.pitch) * SR):]
    if c.loop > 0:
        L = int((c.dur or len(x) / SR) * SR)
        X = int(c.loop * SR)
        seg = x[: L + X].copy()
        if len(seg) < L + X:
            raise SystemExit(f'{c.name}: source too short for loop')
        t = np.linspace(0, math.pi / 2, X)
        out = seg[:L].copy()
        out[:X] = seg[:X] * np.sin(t) + seg[L:L + X] * np.cos(t)
        return out
    if c.dur:
        x = x[: int(c.dur * SR)]
    # tail trim at -60 dB relative to peak
    pk = np.max(np.abs(x)) + 1e-12
    above = np.where(np.abs(x) > pk * 10 ** (-60 / 20))[0]
    if len(above):
        x = x[: above[-1] + 1]
    x = x.copy()
    fi = int(c.fade_in * SR)
    if fi > 0:
        x[:fi] *= np.sin(np.linspace(0, math.pi / 2, fi)) ** 2
    fo = min(len(x), int(c.fade_out * SR))
    if fo > 0:
        x[-fo:] *= np.cos(np.linspace(0, math.pi / 2, fo)) ** 2
    x[-1] = 0.0
    return x


def normalise(x: np.ndarray) -> tuple[np.ndarray, float, float]:
    lo = loudness(x)
    g = 10 ** ((TARGET_LOUD - lo) / 20)
    pk = np.max(np.abs(x)) * g
    ceil = 10 ** (PEAK_CEIL / 20)
    if pk > ceil:
        g *= ceil / pk
    y = x * g
    return y, loudness(y), db(np.max(np.abs(y)))


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    pieces: list[np.ndarray] = []
    index: dict[str, dict] = {}
    gap = np.zeros(int(GAP * SR))
    cursor = len(gap)  # in samples, so offsets are exact
    pieces.append(gap)
    for c in CLIPS:
        x = edit(decode(fetch(c.src, c.file), c), c)
        y, lo, pk = normalise(x)
        # loops are packed with wrap-around context on both sides so the lossy
        # codec sees a continuous signal across the seam (no smeared splice)
        pad = int(0.06 * SR) if c.loop else 0
        if pad:
            pieces.append(y[-pad:])
            cursor += pad
        index[c.name] = {
            's': cursor,
            'n': len(y),
            'loud': round(lo, 2),
            'peak': round(pk, 2),
            **({'loop': True} if c.loop else {}),
        }
        pieces.append(y)
        if pad:
            pieces.append(y[:pad])
            cursor += pad
        pieces.append(gap)
        cursor += len(y) + len(gap)
        print(f'{c.name:12s} {len(y) / SR:6.3f}s  loud {lo:6.1f}  peak {pk:5.1f}  <- {c.src}:{c.file}')
    pcm = np.concatenate(pieces).astype(np.float32)
    wav = os.path.join(CACHE, 'sprite.f32')
    pcm.tofile(wav)
    ogg = os.path.join(OUT_DIR, 'sfx.ogg')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', wav,
                    '-c:a', 'libvorbis', '-q:a', '4', '-map_metadata', '-1', ogg], check=True)
    meta = {
        'sampleRate': SR,
        'targetLoud': TARGET_LOUD,
        'clips': index,
    }
    with open(os.path.join(OUT_DIR, 'sfx.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    print(f'\n{len(CLIPS)} clips, {cursor / SR:.1f}s, {os.path.getsize(ogg) / 1024:.0f} KiB -> {os.path.relpath(ogg, ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
