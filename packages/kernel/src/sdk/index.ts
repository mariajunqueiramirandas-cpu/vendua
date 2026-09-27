import type { ComponentType } from 'react';
import type { RegisteredComponent, SectionComponentProps } from '../composition/registry.ts';
import * as B from './blocks.tsx';
import * as S from './sections.tsx';
import * as schemas from './schemas.ts';

const sdk = (
  schema: RegisteredComponent['schema'],
  Component: ComponentType<never>,
): RegisteredComponent => ({
  schema,
  Component: Component as ComponentType<SectionComponentProps<never>>,
  source: 'sdk',
});

// Every SDK section and block this Kernel version ships. A template naming a
// type missing here renders nothing (reported) — the next train fixes it.
export const SDK_COMPONENTS: RegisteredComponent[] = [
  sdk(schemas.pageContent, S.PageContent),
  sdk(schemas.header, S.Header),
  sdk(schemas.footer, S.Footer),
  sdk(schemas.announcementBar, S.AnnouncementBar),
  sdk(schemas.headerCart, S.HeaderCart),
  sdk(schemas.purchasePanel, S.PurchasePanel),
  sdk(schemas.catalogGrid, S.CatalogGrid),
  sdk(schemas.productList, S.ProductList),
  sdk(schemas.storeStatus, S.StoreStatus),
  sdk(schemas.richTextSection, S.RichText),
  sdk(schemas.stockCounter, B.StockCounter),
  sdk(schemas.notifyMe, B.NotifyMe),
  sdk(schemas.promoBadge, B.PromoBadge),
  sdk(schemas.deliveryEta, B.DeliveryEta),
  sdk(schemas.pixInfo, B.PixInfo),
  sdk(schemas.loyaltyTeaser, B.LoyaltyTeaser),
];
