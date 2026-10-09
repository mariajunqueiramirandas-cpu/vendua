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

def sfx_whoosh(peak=0.28, dur=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    pk = peak / dur
    r = t / dur
    shape = np.where(r < pk, (r / pk) ** 2.2, np.exp(-(r - pk) * dur / 0.07))
    fc = np.where(r < pk, 500 + 4500 * (r / pk) ** 1.5, 5000 * np.exp(-(r - pk) * dur / 0.12) + 800)
    x = sweep(noise(n), fc, "bp", 1.4) * shape
    pan = np.clip((r - pk) * 4, -1, 1)
    l, rr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.vstack([x * l, x * rr]) * 1.4, peak


def sfx_pop(m=84):
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    f = mtof(m) * (1 + 0.5 * np.exp(-t / 0.012))
    x = sine(f, n) * 0.8 + sine(f * 2, n) * 0.15 * np.exp(-t / 0.02)
    return fade(x * np.exp(-t / 0.05), 0.0005, 0.02)


def sfx_tap():
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    return fade(hp(noise(n), 2500) * np.exp(-t / 0.003) * 0.6 + sine(1700, n) * np.exp(-t / 0.012) * 0.5, 0, 0.01)


def bell(m, dur=1.0, idx=2.0, tau=0.45):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    mod = np.sin(2 * np.pi * f * 3.5 * t) * idx * np.exp(-t / 0.25)
    return fade(np.sin(2 * np.pi * f * t + mod) * np.exp(-t / tau), 0.001, 0.05)


def sfx_chime(notes, gap=0.07, dur=1.2):
    out = np.zeros(int((dur + gap * len(notes)) * SR))
    for i, m in enumerate(notes):
        b = bell(m, dur)
        j = int(i * gap * SR)
        out[j : j + len(b)] += b * (0.8 + 0.1 * i)
    return out / len(notes) * 1.6


def sfx_kaching():
    a = sfx_chime([84, 91], 0.05, 0.7)
    n = len(a)
    t = np.arange(n) / SR
    shimmer = hp(noise(n), 6000) * np.exp(-t / 0.18) * 0.25
    return a + shimmer


def sfx_stamp():
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    thump = sine(80 + 60 * np.exp(-t / 0.02), n) * np.exp(-t / 0.07)
    slap = lp(noise(n), 1800) * np.exp(-t / 0.018) * 0.7
    return fade(np.tanh(1.5 * (thump + slap)), 0, 0.02)


def sfx_thump(m=36, tau=0.25):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    f = mtof(m) * (1 + 1.5 * np.exp(-t / 0.03))
    return fade(np.tanh(1.4 * sine(f, n) * np.exp(-t / tau)) + lp(noise(n), 1200) * np.exp(-t / 0.02) * 0.3, 0, 0.05)


def sfx_tick(m=96):
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return fade(sine(mtof(m), n) * np.exp(-t / 0.006), 0, 0.005)


def sfx_printer(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    gate = ((t / S16) % 1 < 0.7).astype(float)
    gate = lp(gate, 200)
    x = square(118, n) * 0.4 + bp(noise(n), 1500, 5000) * 0.6
    return fade(lp(x, 3500) * gate, 0.005, 0.03)


def sfx_glitch():
    n = int(0.14 * SR)
    src = bp(noise(int(0.02 * SR)), 800, 6000) + square(220, int(0.02 * SR)) * 0.5
    out = np.zeros(n)
    i = 0
    k = 0
    while i < n:
        seg = src[: len(src) - (k % 3) * 200]
        out[i : i + len(seg)] = seg[: n - i] * (1 - i / n)
        i += len(seg) + 120
        k += 1
    return out * 0.8


def sfx_boing():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    f = mtof(72) * (0.6 + 0.6 * (1 - np.exp(-t / 0.06)))
    return fade(sine(f, n) * np.exp(-t / 0.12) * (1 + 0.3 * np.sin(2 * np.pi * 18 * t)), 0.002, 0.03)


def sfx_bloom():
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    low = sine(mtof(41), n) * (1 - np.exp(-t / 0.05)) * np.exp(-t / 0.7)
    glass = sum(bell(m, 2.0, 1.2, 0.8) for m in (77, 84, 89)) / 3
    return low * 0.7 + glass * 0.6


def sfx_swish():
    n = int(0.22 * SR)
    r = np.linspace(0, 1, n)
    return fade(sweep(noise(n), 2000 + 6000 * r, "bp", 1.5) * np.sin(np.pi * r) ** 2, 0.002, 0.02)


def build_sfx():
    fx = Bus()
    W = lambda tpk, g=0.32, dur=0.5: (lambda w: fx.add(w[0], tpk - w[1], g))(sfx_whoosh(0.28, dur))
    P = lambda t, m=84, g=0.3, pan=0.0: fx.add(sfx_pop(m), t, g, pan)
    TAP = lambda t, g=0.35: fx.add(sfx_tap(), t, g)
    TH = lambda t, g=0.35, m=36: fx.add(sfx_thump(m), t, g)

    # F1 hook
    fx.add(sfx_glitch(), 0.0, 0.35)
    fx.add(sfx_chime([80, 84], 0.06, 0.8), T(0, 2), 0.3, 0.2)
    TH(T(1), 0.3)
    fx.add(sfx_swish(), T(1, 1) - 0.03, 0.22)
    fx.add(sfx_chime([84, 87, 92], 0.06, 0.9), T(1, 2), 0.32, -0.2)
    W(T(2), 0.3)
    # F2 brand
    for i in range(6):
        P(T(2) + i * S16, 72 + [0, 3, 5, 7, 10, 12][i], 0.22, -0.4 + i * 0.16)
    fx.add(sfx_tick(100), T(2, 2), 0.35)
    fx.add(sfx_swish(), T(2, 2), 0.18)
    fx.add(sfx_boing(), T(3), 0.32)
    TAP(T(3, 1), 0.25)
    # F3 loja
    W(T(4), 0.3)
    TAP(T(4, 2), 0.3)
    W(T(5), 0.28)
    for i in range(8):
        fx.add(sfx_tick(98 + (i % 2) * 2), T(5) + i * S16 / 2, 0.14)
    for i, b in enumerate((1, 2, 3)):
        P(T(5, b), 79 + 3 * i, 0.3, -0.3 + 0.3 * i)
    W(T(6), 0.26)
    for i in range(4):
        P(T(6, i), [77, 80, 84, 89][i], 0.28)
    TH(T(7), 0.28, 40)
    for i in range(int((T(7, 2) - T(7, 0.2)) / (S16 / 2))):
        fx.add(sfx_tick(102), T(7, 0.2) + i * S16 / 2, 0.08)
    fx.add(sfx_kaching(), T(7, 2), 0.3)
    W(T(8), 0.3)
    # F4 pedido
    fx.add(sfx_chime([80, 84, 87], 0.08, 1.2), T(8), 0.38)
    P(T(8, 2), 84, 0.22)
    W(T(9), 0.28)
    TAP(T(9, 2), 0.45)
    fx.add(sfx_chime([84, 89], 0.06, 0.7), T(9, 2) + 0.03, 0.25)
    W(T(10), 0.26)
    for i in range(4):
        P(T(10, i), [72, 75, 79, 84][i], 0.26)
    for i in range(4):
        TH(T(11, i), 0.22 + 0.08 * i, 36 + i * 2)
    # F5 Duá: one pop per chat message, Duá high, the customer lower
    TH(T(12, 1), 0.3, 41)
    TAP(T(12, 2), 0.25)
    W(T(13), 0.26)
    chat = ["d", "m", "d", "d", "m", "d", "m", "d", "d", "m", "d"]
    for i, who in enumerate(chat):
        P(T(13) + i * BEAT, 89 if who == "d" else 82, 0.26, -0.25 if who == "d" else 0.25)
    fx.add(sfx_chime([84, 91], 0.07, 1.0), T(15, 2), 0.36)
    W(T(16), 0.3)
    # F6 smart
    for b in (1, 2, 3):
        P(T(16, b), 80 + b * 2, 0.28)
    W(T(17), 0.26)
    for b in (1, 2, 3):
        fx.add(sfx_swish(), T(17, b) - 0.06, 0.22)
    W(T(18), 0.26)
    fx.add(sfx_printer(T(18, 2.5) - T(18)), T(18), 0.2)
    W(T(19), 0.26)
    for i in range(7):
        fx.add(sfx_stamp(), T(19) + i * S16 * 2, 0.34)
    fx.add(sfx_chime([84, 87, 91], 0.06, 1.0), T(19, 3) + 0.05, 0.22)
    W(T(20), 0.28)
    # F7 preço (break)
    TH(T(20), 0.38, 34)
    TH(T(20, 1), 0.3, 36)
    TAP(T(20, 3), 0.22)
    for i in range(3):
        TH(T(21, i), 0.32 + 0.06 * i, 36 + 3 * i)
    # F8 planos
    W(T(22, 0.5), 0.3)
    for i in range(int((T(22, 2) - T(22, 0.6)) / (S16 / 2))):
        fx.add(sfx_tick(100 + (i % 3)), T(22, 0.6) + i * S16 / 2, 0.1)
    fx.add(sfx_kaching(), T(22, 2), 0.38)
    for i, b in enumerate((3, 4, 5)):
        P(T(22, b), 82 + 3 * i, 0.27)
    W(T(23, 3), 0.26)
    W(T(24), 0.3)
    P(T(24), 91, 0.25)
    for i in range(int((T(24, 2) - T(24, 0.2)) / (S16 / 2))):
        fx.add(sfx_tick(100 + (i % 3)), T(24, 0.2) + i * S16 / 2, 0.1)
    fx.add(sfx_kaching(), T(24, 2), 0.42)
    for i, b in enumerate((3, 4, 5, 6, 7)):
        P(T(24, b), 80 + 2 * i, 0.27)
    fx.add(sfx_boing(), T(25), 0.24)
    fx.add(sfx_swish(), T(26), 0.25)
    TAP(T(26, 2), 0.25)
    TH(T(27), 0.32, 38)
    TH(T(27, 1), 0.3, 41)
    TH(T(27, 2), 0.3, 43)
    P(T(27, 3), 89, 0.25)
    W(T(28), 0.3)
    # F9 cta
    TAP(T(28, 1), 0.25)
    fx.add(sfx_swish(), T(28, 2) - 0.08, 0.25)
    TAP(T(29), 0.5)
    fx.add(sfx_chime([84, 89, 91], 0.07, 1.1), T(29) + 0.04, 0.32)
    W(T(29, 2), 0.24)
    fx.add(sfx_bloom(), T(30), 0.4)
    TAP(T(30, 1), 0.2)
    fx.add(sfx_chime([89, 96, 101], 0.09, 1.6), T(31), 0.22)

    wet = apply_reverb(fx.x, reverb_ir(1.1, seed=5))
    return fx.x + 0.18 * wet


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
    mix = music[:, :end] * 0.9 + sfx[:, :end] * 1.0
    mix[:, -int(0.25 * SR) :] *= np.linspace(1, 0, int(0.25 * SR))
    peak = np.max(np.abs(mix))
    print(f"music peak {np.max(np.abs(music)):.2f}  sfx peak {np.max(np.abs(sfx)):.2f}  mix peak {peak:.2f}")
    sf.write(ROOT / "audio" / "mix.wav", (mix / max(peak, 1e-9) * 0.7).T.astype(np.float32), SR, subtype="FLOAT")


if __name__ == "__main__":
    main()
