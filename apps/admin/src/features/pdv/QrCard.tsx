import { cn } from '../../ui/cn.ts';
import { tableName } from '../../ui/orderMode.ts';
import { Qr } from '../../ui/Qr.tsx';

/**
 * The card that sits on the table (ADR 0036): the store, "Peça pelo celular", the QR and the
 * table's name. Dark on the QR paper in either theme, the way it comes out of the printer.
 * `paper` sizes it in millimetres for the A4 sheet.
 */
export function QrCard({
  store,
  label,
  url,
  paper,
  className,
}: {
  store: string;
  label: string;
  url: string;
  paper?: boolean;
  className?: string;
}) {
  const name = tableName(label);
  return (
    <div
      className={cn(
        'flex flex-col items-center bg-qr-paper text-center text-qr',
        paper
          ? 'h-full justify-center gap-[2.5mm] rounded-[4mm] [&>*]:shrink-0 border-[0.3mm] border-dashed border-qr/40 p-[6mm]'
          : 'gap-2 rounded-lg p-5 ring-1 ring-line depth-1',
        className,
      )}
    >
      <p
        className={cn(
          'w-full truncate font-semibold uppercase tracking-[0.08em] opacity-75',
          paper ? 'text-[4mm]' : 't-caption',
        )}
      >
        {store}
      </p>
      <p
        className={cn(
          'font-display font-semibold leading-tight',
          paper ? 'text-[7mm]' : 'text-[1.375rem]',
        )}
      >
        Peça pelo celular
      </p>
      <Qr
        value={url}
        alt={`QR code da ${name}`}
        className={cn('aspect-square', paper ? 'w-[70mm]' : 'my-1 w-full max-w-56')}
      />
      <p
        className={cn(
          'w-full break-words font-display font-bold leading-none',
          paper ? 'text-[13mm]' : 'text-[2rem]',
        )}
      >
        {name}
      </p>
      <p className={cn('opacity-75', paper ? 'text-[3.6mm]' : 't-caption')}>
        Aponte a câmera para o código
      </p>
    </div>
  );
}
