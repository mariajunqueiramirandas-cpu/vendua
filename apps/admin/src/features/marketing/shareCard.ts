import { money } from '../../lib/format.ts';
import { toast } from '../../ui/Toast.tsx';

// A WhatsApp-ready card (§A4 Marketing): the product photo, name, price and the
// store's name on cream, as a 1080×1350 image. Shared as a file where the phone
// supports it (the share sheet → WhatsApp status/chat), otherwise downloaded.

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

export async function shareCard(p: {
  storeName: string;
  name: string;
  priceCents: number;
  imageUrl: string | null;
  url: string;
}) {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f7f4ea';
  g.fillRect(0, 0, W, H);
  if (p.imageUrl) {
    try {
      const img = await loadImg(p.imageUrl);
      const side = W - 120;
      const s = Math.max(side / img.width, side / img.height);
      g.save();
      g.beginPath();
      g.roundRect(60, 60, side, side, 48);
      g.clip();
      g.drawImage(
        img,
        60 + (side - img.width * s) / 2,
        60 + (side - img.height * s) / 2,
        img.width * s,
        img.height * s,
      );
      g.restore();
    } catch {
      /* card without photo */
    }
  }
  await document.fonts.ready;
  g.fillStyle = '#123c32';
  g.font = '600 64px "Space Grotesk Variable", system-ui, sans-serif';
  const words = p.name.split(' ');
  let line = '';
  let y = 1100;
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > W - 360 && line) {
      g.fillText(line, 60, y);
      line = w;
      y += 72;
    } else line = t;
  }
  g.fillText(line, 60, y);
  g.fillStyle = '#d9f875';
  g.beginPath();
  g.roundRect(W - 300, 1040, 240, 96, 48);
  g.fill();
  g.fillStyle = '#123c32';
  g.font = '600 44px "Space Grotesk Variable", system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(money(p.priceCents), W - 180, 1103);
  g.textAlign = 'left';
  g.font = 'italic 48px "Instrument Serif", Georgia, serif';
  g.fillStyle = '#4f6a5e';
  g.fillText(p.storeName, 60, H - 70);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) return;
  const file = new File([blob], `${p.name.replace(/\W+/g, '-').toLowerCase()}.png`, {
    type: 'image/png',
  });
  const text = `${p.name} por ${money(p.priceCents)} na ${p.storeName}: ${p.url}`;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return;
    } catch {
      /* cancelled */
      return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  void navigator.clipboard?.writeText(text).catch(() => undefined);
  toast('Cartão baixado. O texto com o link foi copiado para colar junto.');
}
