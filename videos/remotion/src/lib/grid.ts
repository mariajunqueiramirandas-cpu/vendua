// A musical grid shared by the picture (frames) and the score (seconds). Both import the same
// cue times, so a sound and the motion it belongs to can't drift apart.
export const grid = (bpm: number, fps: number) => {
  const beat = 60 / bpm;
  return {
    bpm,
    fps,
    beat,
    bar: beat * 4,
    /** seconds of beat n (quarter notes from 0) */
    b: (n: number) => n * beat,
    /** seconds of bar n */
    bars: (n: number) => n * beat * 4,
    /** seconds → nearest frame */
    f: (sec: number) => Math.round(sec * fps),
  };
};
