// A QR-looking pattern for the drawing of the table card: the three finder squares and a fixed
// scatter of modules. It is decoration, not a code: nothing scans to a real address.

const SIZE = 25;

function finder(x: number, y: number, r: number, c: number) {
  const dx = c - x;
  const dy = r - y;
  if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return null;
  const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
  return ring === 3 || ring <= 1;
}

export function modules(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let seed = 0x5eed;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const f =
        finder(0, 0, r, c) ?? finder(SIZE - 7, 0, r, c) ?? finder(0, SIZE - 7, r, c) ?? null;
      const nearFinder = (r < 8 && c < 8) || (r < 8 && c >= SIZE - 8) || (r >= SIZE - 8 && c < 8);
      const on = f ?? (nearFinder ? false : r === 6 || c === 6 ? (r + c) % 2 === 0 : rand() < 0.48);
      if (on) out.push({ x: c, y: r });
    }
  }
  return out;
}

export const QR_SIZE = SIZE;
