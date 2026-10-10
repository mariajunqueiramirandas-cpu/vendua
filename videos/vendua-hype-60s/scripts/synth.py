#!/usr/bin/env python3
"""Venduá Hype 60 — the soundtrack, synthesized from scratch (numpy + scipy, no samples).

    python3 scripts/synth.py            # writes audio/stems/{music,sfx}.wav and audio/mix.wav

128 BPM, F minor (Fm–D♭–A♭–E♭), 32 bars = 60.000 s. Every sound here is an oscillator, a noise
source, a filter and an envelope; the sections and the sound-effect cues follow STORYBOARD.md.
Deterministic: the noise comes from fixed seeds, so the same code always writes the same file.
"""
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
BPM = 128
BEAT = 60 / BPM
BAR = 4 * BEAT
S16 = BEAT / 4
DUR = 60.0
N = int(round(DUR * SR))
ROOT = Path(__file__).resolve().parent.parent


def T(bar, beat=0.0, six=0.0):
    return bar * BAR + beat * BEAT + six * S16


def mtof(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12)


def tt(dur):
    return np.arange(int(round(dur * SR))) / SR


_seed = [1000]


def noise(n):
    _seed[0] += 1
    return np.random.default_rng(_seed[0]).uniform(-1, 1, n)


# ---------------------------------------------------------------- oscillators

def _blep(ph, dt):
    out = np.zeros_like(ph)
    a = ph < dt
    x = ph[a] / dt[a]
    out[a] = x + x - x * x - 1
    b = ph > 1 - dt
    x = (ph[b] - 1) / dt[b]
    out[b] = x * x + x + x + 1
    return out


def saw(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    dt = f / SR
    ph = (phase0 + np.cumsum(dt) - dt[0]) % 1.0
    return 2 * ph - 1 - _blep(ph, dt)


def square(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    dt = f / SR
    ph = (phase0 + np.cumsum(dt) - dt[0]) % 1.0
    ph2 = (ph + 0.5) % 1.0
    return np.where(ph < 0.5, 1.0, -1.0) + _blep(ph, dt) - _blep(ph2, dt)


def sine(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    return np.sin(2 * np.pi * (phase0 + np.cumsum(f) / SR))


# ---------------------------------------------------------------- filters

def lp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, min(fc, SR * 0.45), "low", fs=SR, output="sos"), x)


def hp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, min(hi, SR * 0.45)], "band", fs=SR, output="sos"), x)


def _biquad(kind, fc, q):
    w = 2 * np.pi * min(max(fc, 20), SR * 0.45) / SR
    c, s = np.cos(w), np.sin(w)
    al = s / (2 * q)
    if kind == "lp":
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == "hp":
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else:  # band-pass, constant peak gain
        b = [al, 0, -al]
    a = [1 + al, -2 * c, 1 - al]
    return np.array(b) / a[0], np.array(a) / a[0]


def sweep(x, fc, kind="lp", q=0.9, block=64):
    """A resonant filter whose cutoff follows the array `fc` (one value per sample)."""
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    y = np.empty_like(x)
    zi = np.zeros(2)
    for i in range(0, len(x), block):
        b, a = _biquad(kind, float(fc[i]), q)
        y[i : i + block], zi = signal.lfilter(b, a, x[i : i + block], zi=zi)
    return y


def env_exp(n, tau):
    return np.exp(-np.arange(n) / SR / tau)


def adsr(n, a=0.005, d=0.1, s=0.7, r=0.05):
    e = np.full(n, s)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    e[:na] = np.linspace(0, 1, na, endpoint=False)
    nd = min(nd, n - na)
    e[na : na + nd] = np.linspace(1, s, nd, endpoint=False)
    nr = min(nr, n)
    if nr:
        e[n - nr :] *= np.linspace(1, 0, nr)
    return e


def fade(x, fin=0.002, fout=0.01):
    a, b = int(fin * SR), int(fout * SR)
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


# ---------------------------------------------------------------- buses

class Bus:
    def __init__(self):
        self.x = np.zeros((2, N + SR * 4))

    def add(self, sig, t, gain=1.0, pan=0.0):
        """Mono or (2, n) stereo `sig` placed at time t; equal-power pan −1..1."""
        i = int(round(t * SR))
        if i < 0:
            sig = sig[..., -i:]
            i = 0
        if sig.ndim == 1:
            l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            sig = np.vstack([sig * l * 1.414, sig * r * 1.414])
        n = min(sig.shape[1], self.x.shape[1] - i)
        if n > 0:
            self.x[:, i : i + n] += gain * sig[:, :n]


def reverb_ir(rt=1.8, pre=0.02, bright=6000, seed=7):
    n = int(rt * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    ir = np.zeros((2, n + int(pre * SR)))
    for c in range(2):
        v = rng.standard_normal(n) * np.exp(-6.9 * t / rt)
        v = lp(v, bright) * (1 - np.exp(-t / 0.01))
        ir[c, int(pre * SR) :] = v
    return ir / np.sqrt(np.sum(ir**2) / 2) * 0.35


def apply_reverb(x, ir):
    return np.vstack([signal.fftconvolve(x[c], ir[c])[: x.shape[1]] for c in range(2)])


def pingpong(x, delay, fb=0.45, taps=6):
    mono = x.mean(axis=0)
    out = np.zeros_like(x)
    d = int(delay * SR)
    for k in range(1, taps + 1):
        g = fb**k
        c = k % 2
        out[c, d * k :] += g * mono[: -d * k]
    return out


# ---------------------------------------------------------------- arrangement

CHORDS = {  # voicings (MIDI) and bass roots
    "Fm": ([53, 56, 60, 65], 41),
    "Db": ([53, 56, 61, 65], 37),
    "Ab": ([51, 56, 60, 63], 44),
    "Eb": ([51, 55, 58, 63], 39),
}
PROG = ["Fm", "Db", "Ab", "Eb"]
OVERRIDE = {20: "Db", 21: "Eb", 30: "Eb", 31: "Fm"}


def chord_of(bar):
    return OVERRIDE.get(bar, PROG[bar % 4])


GROOVE = set(range(0, 11))
BUILDS = {11, 21}
DROP = set(range(12, 20)) | set(range(22, 30))
BREAK = {20, 21}
LAST_GROOVE = {30}
KICK_BARS = GROOVE | DROP | LAST_GROOVE
IMPACTS = [0.0, T(2), T(12), T(22), T(28), T(31)]

# the drop hook, eighth-note grid per bar (None = rest, "-" = hold)
HOOK = {
    "Fm": [72, "-", 68, 72, "-", 75, "-", 72],
    "Db": [73, "-", 68, 73, "-", 77, "-", 73],
    "Ab": [72, "-", 68, 72, "-", 75, "-", 80],
    "Eb": [70, "-", 67, 70, "-", 75, 77, 79],
}


def kick():
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    f = 50 + 130 * np.exp(-t / 0.025) + 450 * np.exp(-t / 0.0022)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.17)
    click = hp(noise(n), 2500) * np.exp(-t / 0.0025) * 0.5
    return fade(np.tanh(1.8 * (body + click)) / np.tanh(1.8), 0, 0.02)


def clap():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    nz = bp(noise(n), 900, 4200)
    e = np.zeros(n)
    for k, o in enumerate([0.0, 0.009, 0.019]):
        i = int(o * SR)
        e[i:] += np.exp(-(t[: n - i]) / (0.005 if k < 2 else 0.13))
    body = np.sin(2 * np.pi * 195 * t) * np.exp(-t / 0.05) * 0.35
    return fade(nz * e * 0.8 + body, 0, 0.03)


def snare(tau=0.08):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    return fade(bp(noise(n), 1200, 7000) * np.exp(-t / tau) + np.sin(2 * np.pi * 230 * t) * np.exp(-t / 0.04) * 0.5, 0, 0.02)


def hat(open_=False):
    n = int((0.35 if open_ else 0.09) * SR)
    t = np.arange(n) / SR
    m = hp(noise(n), 7500 if open_ else 8500, 4)
    return fade(m * np.exp(-t / (0.09 if open_ else 0.022)), 0, 0.01)


def crash(dur=2.6):
    n = int(dur * SR)
    t = np.arange(n) / SR
    metal = sum(square(f, n) for f in (403, 587, 845, 1233, 1689, 2312)) / 6
    m = hp(noise(n) * 0.8 + metal * 0.35, 4200, 2)
    return fade(m * (np.exp(-t / 0.9) * 0.8 + np.exp(-t / 0.08) * 0.4), 0.001, 0.2)


def impact():
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    f = 30 + 55 * np.exp(-t / 0.12)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.75)
    thud = lp(noise(n), 900) * np.exp(-t / 0.05) * 0.6
    return fade(np.tanh(1.3 * (boom + thud)), 0, 0.3)


def supersaw(notes, dur, voices=7, detune=0.16, seed=0, pan_spread=0.8):
    n = int(dur * SR)
    out = np.zeros((2, n))
    rng = np.random.default_rng(seed + 99)
    for m in notes:
        for v in range(voices):
            d = (v / (voices - 1) * 2 - 1) if voices > 1 else 0
            f = mtof(m + d * detune)
            s = saw(f, n, rng.uniform())
            p = d * pan_spread
            out[0] += s * np.cos((p + 1) * np.pi / 4)
            out[1] += s * np.sin((p + 1) * np.pi / 4)
    return out / (len(notes) * voices) * 2.2


def pump(times, depth=0.85, rel=0.2):
    """Sidechain gain curve: dips to 1−depth on each kick, recovers over `rel` seconds."""
    g = np.ones(N + SR * 4)
    t = np.arange(len(g)) / SR
    times = np.asarray(sorted(times))
    idx = np.searchsorted(times, t, side="right") - 1
    valid = idx >= 0
    since = np.where(valid, t - times[np.clip(idx, 0, None)], 1e9)
    x = np.clip(since / rel, 0, 1)
    g = 1 - depth * (1 - x) ** 2.2
    att = np.clip(since / 0.004, 0, 1)  # 4 ms dip, no click
    return np.where(since < 0.004, 1 - depth * att, g)


def build_music():
    drums, bass, sub, chords, lead, arp, fx = (Bus() for _ in range(7))
    kick_times = []
    k, c, hc, ho = kick(), clap(), hat(False), hat(True)

    for bar in range(32):
        t0 = T(bar)
        ch = chord_of(bar)
        notes, root = CHORDS[ch]

        # ---- drums
        if bar in KICK_BARS:
            for b in range(4):
                drums.add(k, t0 + b * BEAT, 1.0)
                kick_times.append(t0 + b * BEAT)
            for b in (1, 3):
                drums.add(c, t0 + b * BEAT, 0.8, 0.05)
            for s in range(16):
                if s % 4 == 2:
                    drums.add(ho, t0 + s * S16, 0.55 if bar in DROP else 0.42, 0.25)
                elif bar in DROP or bar >= 4:
                    drums.add(hc, t0 + s * S16, [0.34, 0.2, 0, 0.26][s % 4], -0.3)
        if bar == 11:  # build: kick on the first two beats, then an accelerating snare roll
            for b in range(2):
                drums.add(k, t0 + b * BEAT, 0.9)
                kick_times.append(t0 + b * BEAT)
        if bar in BUILDS:
            hits = [t0 + s * S16 for s in range(0, 8, 2)] + [t0 + BAR / 2 + s * S16 for s in range(8)]
            hits += [t0 + BAR * 0.75 + s * S16 / 2 for s in range(7)]  # 32nds, last one leaves a gap
            for i, h in enumerate(hits):
                drums.add(snare(0.06), h, 0.18 + 0.5 * i / len(hits), 0.1 * ((-1) ** i))

        # ---- bass and sub
        if bar in GROOVE or bar in LAST_GROOVE or bar == 11:
            for b in range(4 if bar != 11 else 2):  # off-beat pump bass
                st = t0 + b * BEAT + BEAT / 2
                n = int(BEAT / 2 * SR * 0.85)
                f = mtof(root)
                s = saw(f, n) * 0.6 + saw(f * 1.006, n, 0.3) * 0.6 + square(f / 2, n) * 0.5
                cut = 300 + 1700 * env_exp(n, 0.06)
                y = sweep(s, cut, "lp", 1.1) * adsr(n, 0.003, 0.08, 0.7, 0.02)
                bass.add(y, st, 0.3)
        if bar in DROP:
            for s in range(16):  # rolling 16ths, off the kick
                if s % 4 == 0:
                    continue
                st = t0 + s * S16
                n = int(S16 * SR * 0.9)
                f = mtof(root + (12 if s % 4 == 3 else 0))
                x = saw(f, n) * 0.6 + saw(f * 1.008, n, 0.5) * 0.6 + square(f * 0.5, n) * 0.4
                cut = 400 + 2600 * env_exp(n, 0.035)
                bass.add(sweep(x, cut, "lp", 1.2) * adsr(n, 0.002, 0.05, 0.6, 0.015), st, 0.42)
        if bar in KICK_BARS or bar in BREAK or bar == 11:
            n = int(BAR * SR)
            s = sine(mtof(root - 12), n) * adsr(n, 0.01, 0.1, 1.0, 0.03)
            sub.add(s, t0, (0.24 if bar in DROP else 0.17) if bar not in BREAK else 0.16)

        # ---- chords
        if bar in GROOVE or bar in LAST_GROOVE:
            for b in range(4):  # off-beat stabs
                st = t0 + b * BEAT + BEAT / 2
                n = int(0.2 * SR)
                ss = supersaw([m + 12 for m in notes], 0.2, voices=5, seed=bar * 8 + b)
                cut = 1400 + (bar / 10) * 1600
                ss = np.vstack([sweep(ss[ch_], cut * (1 + 1.5 * env_exp(n, 0.04)), "lp", 1.0) for ch_ in range(2)])
                chords.add(ss * env_exp(n, 0.11), st, 1.7)
        if bar == 11:
            n = int(BAR * SR)
            ss = supersaw(notes + [notes[0] + 12], BAR, seed=111)
            cut = np.geomspace(500, 7000, n)
            ss = np.vstack([sweep(ss[ch_], cut, "lp", 1.4) for ch_ in range(2)])
            chords.add(ss * adsr(n, 0.02, 0.1, 1.0, 0.12) * np.linspace(0.5, 1.0, n), t0, 0.9)
        if bar in DROP:
            n = int(BAR * SR)
            ss = supersaw(notes + [notes[1] + 12], BAR, seed=bar)
            ss = np.vstack([lp(ss[ch_], 6500) for ch_ in range(2)])
            chords.add(ss * adsr(n, 0.004, 0.2, 0.9, 0.03), t0, 1.35)
            low = supersaw([m - 12 for m in notes[:2]], BAR, voices=5, detune=0.1, seed=bar + 300)
            low = np.vstack([lp(low[ch_], 1800) for ch_ in range(2)])
            chords.add(low * adsr(n, 0.004, 0.2, 0.9, 0.03), t0, 0.5)
        if bar in BREAK:
            n = int(BAR * SR)
            ss = supersaw(notes, BAR, voices=7, detune=0.2, seed=bar + 50)
            if bar == 20:
                cut = np.geomspace(500, 1100, n)
            else:
                cut = np.geomspace(1100, 6000, n)
            ss = np.vstack([sweep(ss[ch_], cut, "lp", 1.0) for ch_ in range(2)])
            chords.add(ss * adsr(n, 0.25 if bar == 20 else 0.01, 0.1, 1.0, 0.06), t0, 1.1)

        # ---- pluck arpeggio (16ths) from bar 4 in the groove, through the drops and the break
        if (bar >= 4 and bar in GROOVE) or bar in DROP or bar in BREAK or bar in LAST_GROOVE:
            seq = [notes[0], notes[2], notes[3], notes[1] + 12, notes[2] + 12, notes[3], notes[1] + 12, notes[2]]
            for s in range(16):
                st = t0 + s * S16
                n = int(0.22 * SR)
                f = mtof(seq[s % 8] + 12)
                x = square(f, n) * 0.5 + saw(f * 1.004, n) * 0.5
                y = sweep(x, 900 + 5200 * env_exp(n, 0.05), "lp", 1.3) * env_exp(n, 0.09)
                g = 0.3 if bar in DROP else 0.36
                arp.add(fade(y, 0.001, 0.02), st, g, 0.35 if s % 2 else -0.35)

        # ---- drop lead
        if bar in DROP:
            pat = HOOK[ch]
            i = 0
            while i < 8:
                m = pat[i]
                if m is None or m == "-":
                    i += 1
                    continue
                L = 1
                while i + L < 8 and pat[i + L] == "-":
                    L += 1
                dur = L * S16 * 2 * 0.92
                n = int(dur * SR)
                ss = supersaw([m + 12, m], dur, voices=5, detune=0.12, seed=bar * 13 + i, pan_spread=0.5)
                vib = 1.0
                cut = 2000 + 6000 * env_exp(n, 0.12)
                ss = np.vstack([sweep(ss[ch_], cut, "lp", 1.0) for ch_ in range(2)]) * vib
                g = 0.9 if bar < 22 else 1.0
                lead.add(ss * adsr(n, 0.003, 0.15, 0.65, 0.04), t0 + i * S16 * 2, g)
                i += L

    # ---- impacts, crashes, risers, the final stab
    for t in IMPACTS:
        fx.add(impact(), t, 0.75)
        fx.add(crash(), t, 0.3, 0.1)
    for t in (T(16), T(24), T(26)):
        fx.add(crash(1.8), t, 0.18, -0.1)
    for bar, length in ((11, BAR), (21, BAR), (1, BEAT * 1.5)):
        n = int((length - S16 / 2) * SR)
        r = np.linspace(0, 1, n)
        nz = sweep(noise(n), 300 * (30 ** r), "bp", 2.0)
        tone = saw(mtof(48 + 24 * r**1.5), n) * 0.25
        x = (nz * 0.9 + lp(tone, 4000)) * r**2
        fx.add(fade(x, 0.01, 0.004), T(bar + 1) - length, 0.45, 0)
    for t in (T(12), T(22)):  # downlifter after the drops
        n = int(1.5 * SR)
        r = np.linspace(0, 1, n)
        x = sweep(noise(n), 7000 * (0.03 ** r), "lp", 0.8) * (1 - r) ** 2
        fx.add(x, t, 0.22)

    final = supersaw(CHORDS["Fm"][0] + [72, 77], 1.9, seed=777)
    nf = final.shape[1]
    final = np.vstack([lp(final[c], 5000) for c in range(2)]) * env_exp(nf, 0.55)
    fin = Bus()
    fin.add(final, T(31), 0.85)
    fin.add(sine(mtof(29), nf) * env_exp(nf, 0.7), T(31), 0.5)

    # ---- sidechain + mix
    pm = pump(kick_times, 0.8, 0.22)
    pm_soft = pump(kick_times, 0.45, 0.18)
    rv = reverb_ir(2.2)
    lead_wet = apply_reverb(lead.x + 0.5 * pingpong(lead.x, S16 * 3, 0.35, 4), rv)
    arp_wet = pingpong(arp.x, S16 * 3, 0.42, 6)
    chords_wet = apply_reverb(chords.x, rv)
    snare_wet = apply_reverb(drums.x * 0.15, reverb_ir(1.2, seed=3))
    fin_wet = apply_reverb(fin.x, reverb_ir(3.2, seed=11))

    mix = (
        drums.x * 0.5
        + snare_wet * 0.3
        + bass.x * pm
        + sub.x * pm
        + (chords.x + 0.35 * chords_wet) * pm
        + (lead.x + 0.3 * lead_wet) * pm_soft
        + (arp.x + 0.6 * arp_wet) * pm_soft
        + fx.x
        + fin.x
        + fin_wet * 0.5
    )
    mix[:, :] = hp(mix, 28, 2)
    air = hp(mix, 6000, 1)
    mix = mix + 0.6 * air
    import os
    if os.environ.get("REPORT"):
        buses = {"drums": drums.x * 0.5, "bass": bass.x * pm, "sub": sub.x * pm, "chords": chords.x * pm,
                 "lead": lead.x * pm_soft, "arp": arp.x * pm_soft, "fx": fx.x}
        for b in (5, 13, 20, 23):
            a, z = int(T(b) * SR), int(T(b + 1) * SR)
            print(f"bar {b}: " + "  ".join(f"{k} {20*np.log10(np.sqrt(np.mean(v[:, a:z]**2))+1e-9):6.1f}" for k, v in buses.items()))
    return mix


# ---------------------------------------------------------------- sound effects
# The premium set (videos/README.md → Premium SFX): soft, tonal, rounded UI sounds, band-limited
# (nothing boomy under 120 Hz, nothing brittle over ~9 kHz), mixed low, one sound per moment.
# Notes come from F minor / A♭ major so every ping sits in the track's key. Cue times are the
# frames' own tween times (dumped from the GSAP timelines), not the storyboard's anchors.


def polish(x, lo=120, hi=9000):
    return fade(lp(hp(x, lo), hi), 0.001, 0.008)


def glass(m, dur=0.6, tau=0.35, bright=1.0, det=4.0):
    """Glassy mallet: a few partials, upper ones decaying faster, a detuned pair for width."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    out = np.zeros((2, n))
    for c, cents in enumerate((-det, det)):
        ff = f * 2 ** (cents / 1200)
        x = np.sin(2 * np.pi * ff * t) * np.exp(-t / tau)
        x += 0.32 * bright * np.sin(2 * np.pi * ff * 2.0 * t) * np.exp(-t / (tau * 0.45))
        x += 0.12 * bright * np.sin(2 * np.pi * ff * 3.01 * t) * np.exp(-t / (tau * 0.25))
        x += 0.05 * bright * np.sin(2 * np.pi * ff * 4.17 * t) * np.exp(-t / (tau * 0.12))
        out[c] = x * (1 - np.exp(-t / 0.0015))
    return np.vstack([polish(out[0], 150), polish(out[1], 150)]) * 0.6


def ping(notes, gap=0.075, tau=0.38, dur=1.1, bright=1.0):
    """Notification / success: glass notes rising, each a touch louder."""
    out = np.zeros((2, int((dur + gap * len(notes)) * SR)))
    for i, m in enumerate(notes):
        g = glass(m, dur, tau, bright)
        j = int(i * gap * SR)
        out[:, j : j + g.shape[1]] += g * (0.75 + 0.12 * i)
    return out / max(1, len(notes)) ** 0.5


def tap(m=86):
    """A rounded button tap: a short pitched body and a soft, filtered click."""
    n = int(0.07 * SR)
    t = np.arange(n) / SR
    f = mtof(m) * (1 + 0.25 * np.exp(-t / 0.004))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.011)
    click = bp(noise(n), 1800, 5500) * np.exp(-t / 0.0014) * 0.35
    low = np.sin(2 * np.pi * 240 * t) * np.exp(-t / 0.014) * 0.35
    return polish(body * 0.7 + click + low, 160, 8000)


def tick(m=96, tau=0.014):
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * mtof(m) * t) * np.exp(-t / tau) + 0.2 * np.sin(2 * np.pi * mtof(m) * 2 * t) * np.exp(-t / (tau / 2))
    return polish(x * (1 - np.exp(-t / 0.0008)), 400, 9000)


def bubble(m):
    """A chat bubble: a short pluck that rises a hair into pitch."""
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    f = mtof(m) * (1 - 0.12 * np.exp(-t / 0.018))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.07)
    x += 0.25 * np.sin(2 * np.pi * np.cumsum(f * 2) / SR) * np.exp(-t / 0.03)
    return polish(x * (1 - np.exp(-t / 0.002)), 200, 8000)


def whoosh(peak=0.22, dur=0.55, direction=1.0, bright=1.0):
    """Silky air: soft noise through a moving band, a smooth swell into `peak`, a quick settle."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    pk = int(peak * SR)
    env = np.where(t < peak, (t / peak) ** 2.6, np.exp(-(t - peak) / 0.085))
    fc = np.where(t < peak, 350 + 2300 * (t / peak) ** 1.6, 650 + 2000 * np.exp(-(t - peak) / 0.07))
    src = lp(noise(n), 3000, 1) + 0.5 * lp(noise(n), 600, 1)
    body = sweep(src, fc * bright, "bp", 0.75)
    air = hp(noise(n), 5200) * 0.12 * bright
    x = (body + air) * env
    pan = np.clip((t - peak) / 0.25, -1, 1) * 0.7 * direction
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    x = polish(x, 140, 9000)
    return np.vstack([x * l, x * r]) * 1.6 / max(1e-9, np.max(np.abs(x)))


def swipe(dur=0.2):
    """A fingertip across glass."""
    n = int(dur * SR)
    r = np.linspace(0, 1, n)
    x = sweep(noise(n), 2500 + 3500 * r, "bp", 1.1) * np.sin(np.pi * r) ** 1.5
    return polish(x, 1200, 9000) * 0.8


def thock(m=50):
    """A soft stamp: a felt mallet on card, tuned low, no distortion."""
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    f = mtof(m) * (1 + 0.6 * np.exp(-t / 0.01))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.045)
    x += lp(noise(n), 1400) * np.exp(-t / 0.005) * 0.25
    return polish(x, 110, 6000)


def accent(notes=(77, 84, 89), low=41, dur=2.6):
    """Logo moment: a warm low sine bloom under a glass chord (an accent, never an impact)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    bloom = np.sin(2 * np.pi * mtof(low) * t) * (1 - np.exp(-t / 0.03)) * np.exp(-t / 0.55)
    bloom += 0.3 * np.sin(2 * np.pi * mtof(low + 12) * t) * (1 - np.exp(-t / 0.02)) * np.exp(-t / 0.35)
    out = np.vstack([bloom, bloom]) * 0.55
    for i, m in enumerate(notes):
        g = glass(m, dur, 0.9, 0.7, 6.0)
        j = int(i * 0.018 * SR)
        out[:, j : j + g.shape[1] - j] += g[:, : n - j] * 0.55
    return np.vstack([polish(out[0], 60), polish(out[1], 60)])


def swell(dur=0.9, notes=(77, 84, 89)):
    """A reversed glass chord with rising air: ends exactly at its own end (place it to end on a hit)."""
    n = int(dur * SR)
    g = sum(glass(m, dur, 0.5, 0.8) for m in notes)[:, ::-1]
    t = np.arange(n) / SR
    air = sweep(noise(n), 800 + 5000 * (t / dur) ** 2, "bp", 0.8) * (t / dur) ** 3 * 0.5
    x = g * (t / dur) ** 1.5 + np.vstack([air, air])
    x[:, -int(0.004 * SR) :] *= np.linspace(1, 0, int(0.004 * SR))
    return x


SFX_GAIN = 2.2


def build_sfx():
    fx = Bus()

    def add(sig, t, g, pan=0.0):
        fx.add(sig, t, g, pan)

    def W(tpk, g=0.3, dur=0.55, peak=0.22, d=1.0, bright=1.0):
        add(whoosh(peak, dur, d, bright), tpk - peak, g)

    def SW(t, g=0.18):
        add(swipe(), t - 0.03, g)

    def TAP(t, g=0.28, m=86, pan=0.0):
        add(tap(m), t, g, pan)

    def PING(t, notes, g=0.3, gap=0.075, pan=0.0):
        add(ping(notes, gap), t, g, pan)

    def TICKS(times, g=0.08, m0=94, step=0.0):
        for i, x in enumerate(times):
            add(tick(m0 + step * i), x, g, 0.15 * ((i % 2) * 2 - 1))

    def ENDS_AT(sig, t, g):
        add(sig, t - sig.shape[1] / SR, g)

    # 01 hook: two orders arrive while "você cozinha / a gente vende" slams
    PING(0.80, [80, 84], 0.26)
    W(1.875, 0.2, 0.4, 0.16)
    SW(2.30, 0.14)
    PING(2.70, [84, 89], 0.28)
    W(3.75, 0.26, 0.6, 0.3, -1.0)  # the lime floor rises into the drop

    # 02 brand: the wordmark types itself, the accent drops and the check draws
    TICKS([3.792, 3.909, 4.027, 4.144, 4.261], 0.11, 84, 2.4)
    add(bubble(91), 4.433, 0.16)
    add(accent(), 4.56, 0.22)
    add(bubble(77), 5.58, 0.22, -0.2)  # Duá peeks up
    TAP(6.04, 0.16, 84)
    SW(6.53, 0.13)
    W(7.68, 0.3, 0.6, 0.3)  # the page is yanked up

    # 03 loja: 8 questions → the store fills itself → hours → today's sales
    TAP(8.38, 0.18, 82)
    TAP(8.61, 0.2, 86)
    W(9.375, 0.26, 0.5, 0.16, 1.0)  # lime wipe
    TICKS([9.40 + i * 0.035 for i in range(12)], 0.035, 98)
    for i, t in enumerate((9.79, 10.26, 10.73)):
        add(bubble(80 + 4 * i), t, 0.2, -0.2 + 0.2 * i)
    W(11.2, 0.16, 0.35, 0.1, -1.0, 1.3)  # the card flips
    for i, t in enumerate((11.72, 12.19, 12.66)):
        TAP(t, 0.17, 84 + 3 * i)
    W(13.12, 0.24, 0.45, 0.14)  # the sales plate whips in
    # count-up R$ 0 → 718 (power2.out over 13.285–14.063): a tick per R$ 40
    u = np.linspace(0, 1, 4000)
    v = 1 - (1 - u) ** 2
    marks = [13.285 + (14.063 - 13.285) * u[np.searchsorted(v, k / 18)] for k in range(1, 18)]
    TICKS(marks, 0.07, 96)
    PING(14.07, [84, 91], 0.3, 0.05)
    W(15.04, 0.26, 0.55, 0.26)  # zoom through

    # 04 pedido: the new-order push, the tap to accept, the kitchen tabs
    PING(15.16, [80, 84, 87], 0.36, 0.085)
    TAP(15.90, 0.14, 82)
    W(16.80, 0.26, 0.45, 0.16, -1.0)
    TAP(17.77, 0.32, 86)
    PING(17.82, [87, 91], 0.24, 0.06)
    SW(18.68, 0.15)
    for i, t in enumerate((19.16, 19.63, 20.10)):
        TAP(t, 0.15 + 0.02 * i, 82 + 2 * i)
    W(20.56, 0.24, 0.45, 0.14, 1.0)
    for i, t in enumerate((20.58, 21.05, 21.52, 21.99)):
        add(thock(53 + 3 * i), t, 0.18 + 0.03 * i)
    ENDS_AT(swell(1.1, (80, 84, 89)), 22.5, 0.22)

    # 05 Duá: the hero accent, then the chat — customer low on the right, Duá high on the left
    add(accent((80, 84, 89), 44), 22.5, 0.22)
    TAP(22.92, 0.16, 84)
    W(24.42, 0.22, 0.45, 0.16, 1.0)
    for t in (24.33, 24.80, 26.20, 27.14, 28.55):
        add(bubble(80), t, 0.17, 0.3)
    for t in (25.27, 25.74, 26.67, 27.61, 28.08):
        add(bubble(87), t, 0.17, -0.3)
    PING(29.01, [84, 89, 92], 0.34, 0.07)  # Pix paid → "Vendido."
    W(30.02, 0.3, 0.45, 0.06, -1.0, 1.1)  # whip pan

    # 06 smart: the summary, the kitchen screen, the printer, the loyalty card
    TAP(30.18, 0.16, 86)
    for i, t in enumerate((30.50, 30.97, 31.44)):
        add(bubble(82 + 3 * i), t, 0.17, -0.25 + 0.25 * i)
    W(31.875, 0.22, 0.5, 0.15)
    SW(32.26, 0.13)
    add(bubble(84), 32.80, 0.15)
    SW(33.19, 0.13)
    PING(33.29, [84, 89], 0.24, 0.05)
    W(33.75, 0.22, 0.5, 0.15)
    TICKS([33.80 + i * 0.1172 for i in range(10)], 0.06, 89, 0.7)
    SW(34.92, 0.12)
    PING(35.14, [87, 91], 0.2, 0.05)
    W(35.625, 0.22, 0.5, 0.15)
    for i, t in enumerate((35.63, 35.86, 36.10, 36.33, 36.57, 36.80)):
        add(thock(55), t, 0.14)
        add(glass([77, 80, 82, 84, 87, 89][i], 0.5, 0.18), t + 0.005, 0.12, -0.3 + 0.12 * i)
    PING(36.98, [89, 92, 96], 0.26, 0.06)
    W(37.47, 0.24, 0.45, 0.14, 1.0)

    # 07 preço: the question, the answer, the lime flip into the drop
    TAP(37.92, 0.18, 84)
    TICKS([38.87 + i * 0.023 for i in range(12)], 0.03, 100)
    for i, t in enumerate((39.33, 39.80, 40.27)):
        TAP(t, 0.17 + 0.02 * i, 82 + 2 * i)
    SW(40.37, 0.13)
    ENDS_AT(swell(0.9, (77, 84, 89)), 41.25, 0.24)

    # 08 planos: two slot rolls that lock, perks, the recommended plan, 14 days
    TICKS([41.55 + i * 0.045 for i in range(10)], 0.05, 97)
    TICKS([42.022, 42.077, 42.132, 42.187], 0.13, 87, 2)
    PING(42.20, [84, 89], 0.26, 0.05)
    for i, t in enumerate((42.60, 43.07, 43.54)):
        add(bubble(82 + 3 * i), t, 0.15, 0.2)
    W(44.75, 0.26, 0.5, 0.2, -1.0)
    add(bubble(91), 45.05, 0.15)
    TICKS([45.09 + i * 0.05 for i in range(14)], 0.05, 97)
    TICKS([45.827, 45.883, 45.937], 0.14, 89, 3)
    PING(45.95, [84, 89, 96], 0.32, 0.06)
    for i, t in enumerate((46.35, 46.82, 47.29, 47.76, 48.23)):
        add(bubble(80 + 2 * i), t, 0.14, -0.2 + 0.1 * i)
    W(48.76, 0.12, 0.5, 0.2, 1.0, 1.6)  # the shine sweep
    W(49.69, 0.12, 0.5, 0.2, 1.0, 1.6)
    for i, t in enumerate((50.57, 51.04, 51.51, 51.98)):
        add(thock(53 + 3 * i), t, 0.17 + 0.02 * i)
    ENDS_AT(swell(0.9, (80, 87, 92)), 52.5, 0.22)

    # 09 cta: "crie sua loja hoje", the tap, the logo, the URL
    W(52.56, 0.24, 0.5, 0.08, 1.0)  # the shutter closes
    TAP(52.92, 0.16, 84)
    SW(53.0, 0.12)
    W(53.48, 0.16, 0.4, 0.14, -1.0)
    TAP(54.33, 0.36, 86)
    PING(54.40, [84, 89, 92], 0.34, 0.07)
    W(55.08, 0.24, 0.5, 0.2)
    add(accent((77, 84, 89), 41), 55.30, 0.2)
    add(bubble(80), 55.80, 0.16, 0.2)
    TAP(56.21, 0.16, 86)
    add(accent((80, 84, 89, 96), 41, 3.0), 58.125, 0.22)

    wet = apply_reverb(fx.x, reverb_ir(1.3, pre=0.015, bright=7000, seed=5))
    return fx.x + 0.24 * wet


def main():
    out = ROOT / "audio" / "stems"
    out.mkdir(parents=True, exist_ok=True)
    music = build_music()
    sfx = build_sfx()
    end = N
    for name, x in (("music", music), ("sfx", sfx)):
        y = x[:, :end].copy()
        y[:, -int(0.25 * SR) :] *= np.linspace(1, 0, int(0.25 * SR))
        sf.write(out / f"{name}.wav", y.T.astype(np.float32), SR, subtype="FLOAT")
    # a light duck: the music gives ~2.5 dB to each cue, so the cues read without being loud
    env = lp(np.abs(sfx[:, :end]).mean(axis=0), 25)
    duck = 1 - 0.25 * np.clip(env / (np.percentile(env, 99.5) + 1e-9), 0, 1)
    mix = music[:, :end] * 0.9 * duck + sfx[:, :end] * SFX_GAIN
    mix[:, -int(0.25 * SR) :] *= np.linspace(1, 0, int(0.25 * SR))
    peak = np.max(np.abs(mix))
    print(f"music peak {np.max(np.abs(music)):.2f}  sfx peak {np.max(np.abs(sfx)):.2f}  mix peak {peak:.2f}")
    sf.write(ROOT / "audio" / "mix.wav", (mix / max(peak, 1e-9) * 0.7).T.astype(np.float32), SR, subtype="FLOAT")


if __name__ == "__main__":
    main()
