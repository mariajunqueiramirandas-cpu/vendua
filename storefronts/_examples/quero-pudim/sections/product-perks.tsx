import { Snowflake, Truck } from 'lucide-react';
import { defineBlock, list, select, text, useStore, type BlockProps } from '@vendua/kernel';

const ICONS = { truck: Truck, snowflake: Snowflake };

export const schema = defineBlock({
  type: 'store:product-perks',
  category: 'info',
  settings: {
    items: list(
      {
        icon: select(['truck', 'snowflake'], { default: 'truck' }),
        text: text({ max: 80, default: '' }),
      },
      { max: 3 },
    ),
  },
});

export default function ProductPerks({ settings }: BlockProps<typeof schema>) {
  const { store } = useStore();
  const items = settings.items ?? [];
  if (items.length === 0) return null;
  return (
    <p className="small muted pd-perks">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        return (
          <span key={it.text}>
            <Icon size={16} aria-hidden="true" />
            {it.text.replaceAll('{city}', store?.city ?? '')}
          </span>
        );
      })}
    </p>
  );
}
