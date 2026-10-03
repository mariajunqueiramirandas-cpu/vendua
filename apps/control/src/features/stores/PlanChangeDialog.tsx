import { ArrowRight } from 'lucide-react';
import { fmtMoney } from '@/lib/format.ts';
import { Button } from '@/components/ui/button.tsx';
import { Dialog } from '@/components/ui/overlay.tsx';
import { convLabel, featureLabel, trialLabel, type Change } from './planEdit.tsx';

function copy(c: Change) {
  const plan = c.plan.name;
  switch (c.kind) {
    case 'price':
      return {
        title: `mudar o preço do ${plan}?`,
        description: 'A mudança vale só para as próximas cobranças.',
        action: 'mudar preço',
        from: fmtMoney(c.plan.priceCents),
        to: fmtMoney(c.cents),
      };
    case 'trial':
      return {
        title: `mudar o teste grátis do ${plan}?`,
        description:
          'Vale para as lojas que se cadastrarem daqui em diante. Quem já está em teste mantém a data.',
        action: 'mudar teste',
        from: trialLabel(c.plan.trialDays ?? 0),
        to: trialLabel(c.days),
      };
    case 'ai': {
      const month = c.field === 'aiConversations';
      return {
        title: month
          ? `mudar as conversas por mês do ${plan}?`
          : `mudar as conversas do teste grátis do ${plan}?`,
        description: month
          ? 'Vale na hora para todas as lojas pagantes desse plano, já no mês em curso.'
          : 'Vale na hora para todas as lojas em teste nesse plano.',
        action: 'mudar limite',
        from: convLabel(c.plan[c.field] ?? 0),
        to: convLabel(c.n),
      };
    }
    case 'feature':
      return {
        title: `${c.on ? 'incluir' : 'tirar'} ${featureLabel(c.feature)} ${c.on ? 'no' : 'do'} ${plan}?`,
        description: c.on
          ? 'Abre na hora para todas as lojas desse plano.'
          : 'Fecha na hora para todas as lojas desse plano — quem usa hoje perde o acesso.',
        action: c.on ? 'incluir' : 'tirar',
        from: c.on ? 'não incluso' : 'incluso',
        to: c.on ? 'incluso' : 'não incluso',
      };
  }
}

/** Confirms a plan change that alters what live stores pay or can use. */
export function PlanChangeDialog({
  change,
  pending,
  onCancel,
  onConfirm,
}: {
  change: Change | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (c: Change) => void;
}) {
  const t = change && copy(change);
  const removing = change?.kind === 'feature' && !change.on;
  return (
    <Dialog
      open={!!change}
      onOpenChange={(o) => !o && onCancel()}
      title={t?.title ?? ''}
      description={t?.description}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            cancelar
          </Button>
          <Button
            variant={removing ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() => {
              if (change) onConfirm(change);
              onCancel();
            }}
          >
            {t?.action}
          </Button>
        </>
      }
    >
      {t && (
        <div className="flex items-center justify-center gap-3 rounded-lg border bg-secondary py-4 text-lg font-semibold tracking-[-0.02em] tnum">
          <span className="text-muted-foreground line-through decoration-1">{t.from}</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span>{t.to}</span>
        </div>
      )}
    </Dialog>
  );
}
