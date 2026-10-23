// A video's narration through OpenRouter: ElevenLabs text to speech, then Scribe for word times.
//   node scripts/voice.mjs <video> audition "<text>" <voice...>   one take per voice → out/<video>/audition/
//   node scripts/voice.mjs <video> takes [line...] [--n 3]        takes of each line → out/<video>/takes/
//   node scripts/voice.mjs <video> pick <line>=<take> ...         a take → public/<video>/vo/<line>.mp3
//   node scripts/voice.mjs <video> words                          Scribe word times → src/videos/<video>/words.ts
// The lines, the voice and the model live in src/videos/<video>/lines.ts. The key comes from
// OPENROUTER_API_KEY and never goes in a file.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [id, cmd, ...rest] = process.argv.slice(2);
const linesFile = id && join(root, 'src/videos', id, 'lines.ts');
if (!linesFile || !existsSync(linesFile) || !cmd) {
  console.error('usage: node scripts/voice.mjs <video> audition|takes|pick|words ...');
  process.exit(1);
}
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}
const API = 'https://openrouter.ai/api/v1';
const { VOICE, LINES } = await import(pathToFileURL(linesFile).href);
const out = (...p) => join(root, 'out', id, ...p);
const vo = (line) => join(root, 'public', id, 'vo', `${line}.mp3`);

const seconds = (file) =>
  Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);

async function speak(text, voice, file, { seed, previous, next } = {}) {
  const elevenlabs = { language_code: VOICE.language, seed, ...VOICE.options };
  if (previous) elevenlabs.previous_text = previous;
  if (next) elevenlabs.next_text = next;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${API}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VOICE.model,
        input: text,
        voice,
        response_format: 'mp3',
        provider: { options: { elevenlabs } },
      }),
    });
    if (r.ok) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return seconds(file);
    }
    const body = await r.text();
    if (attempt < 3 && (r.status === 429 || r.status >= 500)) {
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${r.status} ${body.slice(0, 400)}`);
  }
}

async function transcribe(file) {
  const form = new FormData();
  form.append('model', 'elevenlabs/scribe-v2');
  form.append('file', new Blob([readFileSync(file)], { type: 'audio/mpeg' }), 'line.mp3');
  form.append('language', VOICE.language);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const r = await fetch(`${API}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: form });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

// The captions use the script's spelling ("Venduá", "R$ 69,90"), Scribe's times ("Vendo A", "69,90"):
// a token alignment that also lets one script word take two heard words (or the reverse).
const norm = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9$]/g, '');
const dist = (a, b) => {
  a = norm(a);
  b = norm(b);
  if (!a.length || !b.length) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] / Math.max(a.length, b.length);
};
function align(text, heard) {
  const S = text.split(/\s+/).filter(Boolean);
  const H = heard;
  const n = S.length;
  const m = H.length;
  const cost = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
  const from = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
  cost[0][0] = 0;
  const relax = (i, j, c, step) => {
    if (c < cost[i][j]) {
      cost[i][j] = c;
      from[i][j] = step;
    }
  };
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      const c = cost[i][j];
      if (c === Infinity) continue;
      if (i < n && j < m) relax(i + 1, j + 1, c + dist(S[i], H[j][0]), [1, 1]);
      if (i < n && j + 1 < m) relax(i + 1, j + 2, c + dist(S[i], H[j][0] + H[j + 1][0]) + 0.05, [1, 2]);
      if (i + 1 < n && j < m) relax(i + 2, j + 1, c + dist(S[i] + S[i + 1], H[j][0]) + 0.05, [2, 1]);
      if (i < n) relax(i + 1, j, c + 1, [1, 0]);
      if (j < m) relax(i, j + 1, c + 1, [0, 1]);
    }
  const steps = [];
  for (let i = n, j = m; i || j; ) {
    const [di, dj] = from[i][j];
    const span = H.slice(j - dj, j);
    const t0 = span.length ? span[0][1] : null;
    const t1 = span.length ? span.at(-1)[2] : null;
    const ws = S.slice(i - di, i);
    // two script words on one heard word share its span, split evenly
    steps.push(
      ws.map((w, k) => [
        w,
        t0 === null ? null : t0 + ((t1 - t0) * k) / ws.length,
        t0 === null ? null : t0 + ((t1 - t0) * (k + 1)) / ws.length,
      ]),
    );
    i -= di;
    j -= dj;
  }
  const out = steps.reverse().flat();
  // a script word Scribe missed gets the gap between its neighbours
  out.forEach((w, k) => {
    if (w[1] !== null) return;
    w[1] = out[k - 1]?.[2] ?? 0;
    w[2] = out.slice(k + 1).find((x) => x[1] !== null)?.[1] ?? w[1] + 0.2;
  });
  return out.map(([w, a, b]) => [w, Number(a.toFixed(3)), Number(b.toFixed(3))]);
}

const byId = Object.fromEntries(LINES.map((l, i) => [l.id, { ...l, i }]));
const neighbours = (l) => ({ previous: LINES[l.i - 1]?.text, next: LINES[l.i + 1]?.text });

if (cmd === 'audition') {
  const [text, ...voices] = rest;
  await Promise.all(
    voices.map(async (v) => {
      const file = out('audition', `${v}.mp3`);
      const s = await speak(text, v, file, { seed: VOICE.seed });
      console.log(`${v}: ${s.toFixed(2)} s → ${file}`);
    }),
  );
} else if (cmd === 'takes') {
  const nAt = rest.indexOf('--n');
  const n = nAt >= 0 ? Number(rest.splice(nAt, 2)[1]) : 3;
  const ids = rest.length ? rest : LINES.map((l) => l.id);
  // a few lines at a time: the provider rate-limits bursts
  const jobs = ids.flatMap((lid) => Array.from({ length: n }, (_, k) => [byId[lid], k + 1]));
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(
      jobs.slice(i, i + 4).map(async ([l, k]) => {
        if (!l) throw new Error('unknown line');
        const file = out('takes', `${l.id}.${k}.mp3`);
        const s = await speak(l.say, VOICE.voice, file, { seed: VOICE.seed + k - 1, ...neighbours(l) });
        console.log(`${l.id}.${k}: ${s.toFixed(2)} s`);
      }),
    );
  }
} else if (cmd === 'pick') {
  for (const p of rest) {
    const [lid, k] = p.split('=');
    if (!byId[lid]) throw new Error(`unknown line ${lid}`);
    mkdirSync(dirname(vo(lid)), { recursive: true });
    copyFileSync(out('takes', `${lid}.${k}.mp3`), vo(lid));
    console.log(`${lid} ← take ${k} (${seconds(vo(lid)).toFixed(2)} s)`);
  }
} else if (cmd === 'words') {
  const words = {};
  await Promise.all(
    LINES.map(async (l) => {
      const j = await transcribe(vo(l.id));
      const heard = (j.words ?? [])
        .filter((w) => (w.type ?? 'word') === 'word' && w.word.trim())
        .map((w) => [w.word.trim(), Number(w.start.toFixed(3)), Number(w.end.toFixed(3))]);
      words[l.id] = { duration: Number(seconds(vo(l.id)).toFixed(3)), heard: j.text, words: align(l.text, heard) };
      console.log(`${l.id}: "${j.text}"`);
    }),
  );
  const file = join(root, 'src/videos', id, 'words.ts');
  const entry = (l) => {
    const w = words[l.id];
    const rows = w.words.map((x) => `      ${JSON.stringify(x)},`).join('\n');
    return `  ${l.id}: {\n    duration: ${w.duration},\n    heard: ${JSON.stringify(w.heard)},\n    words: [\n${rows}\n    ],\n  },`;
  };
  writeFileSync(
    file,
    `// Generated by \`node scripts/voice.mjs ${id} words\`: each take's length, what Scribe v2 heard, and the\n` +
      `// script's own words (lines.ts \`text\`) as [word, start, end] in seconds from the take's first\n` +
      `// sample, aligned to Scribe's word times. Don't edit by hand.\n` +
      `export const WORDS: Record<string, { duration: number; heard: string; words: [string, number, number][] }> = {\n` +
      LINES.map(entry).join('\n') +
      `\n};\n`,
  );
  console.log(`→ ${file}`);
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(1);
}
