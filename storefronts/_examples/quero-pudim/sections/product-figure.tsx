import { defineBlock, usePageContext, useProduct, type BlockProps } from '@vendua/kernel';
import { ProductFigure } from './_shared/ProductFigure.tsx';

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
      <img src={product.imageUrl} alt={product.name} className="pd-img" fetchPriority="high" />
    );
  return (
    <div className="pd-figure">
      <ProductFigure variant={product.figureVariant} title={product.name} />
    </div>
  );
}
