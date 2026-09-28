import { defineBlock, usePageContext, useProduct, type BlockProps } from '@vendua/kernel';
import { ProductFigure } from './_shared/ProductFigure.tsx';
import { KIT_FLAVOR, flavorOf } from './_shared/flavor.ts';

// The brand's illustrated figure for photoless products, placed in the SDK
// purchase panel's `media` area — the panel stays Kernel-owned.
export const schema = defineBlock({
  type: 'store:product-figure',
  category: 'media',
  settings: {},
});

export default function ProductFigureBlock(_: BlockProps<typeof schema>) {
  const { params } = usePageContext();
  const { product } = useProduct(params.slug ?? '');
  if (!product) return null;
  if (product.imageUrl)
    return (
      <img
        src={product.imageUrl}
        alt={product.name}
        className="pd-img"
        {...{ fetchpriority: 'high' }}
      />
    );
  const flavor = product.kind === 'combo' ? KIT_FLAVOR : flavorOf(product.name);
  return (
    <div className="pd-figure" style={{ background: flavor.tint }}>
      <ProductFigure
        variant={product.figureVariant}
        kind={product.kind}
        title={product.name}
        flavor={flavor}
      />
    </div>
  );
}
