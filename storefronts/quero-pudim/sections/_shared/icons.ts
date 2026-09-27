import {
  Heart,
  ShieldCheck,
  ShoppingBag,
  Snowflake,
  Truck,
  Utensils,
  type LucideIcon,
} from 'lucide-react';

// Icons a template may name in settings — data picks an icon, code owns the set.
export const ICONS = {
  heart: Heart,
  snowflake: Snowflake,
  truck: Truck,
  utensils: Utensils,
  shield: ShieldCheck,
  bag: ShoppingBag,
} satisfies Record<string, LucideIcon>;

export const ICON_NAMES = Object.keys(ICONS) as (keyof typeof ICONS)[];
