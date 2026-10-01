import {
  ProductImage,
  Slot,
  defineBlock,
  usePageContext,
  useProduct,
  type BlockProps,
} from '@vendua/kernel';
import { ProductFigure } from './_shared/ProductFigure.tsx';
import { KIT_FLAVOR, flavorOf } from './_shared/flavor.ts';

// The product's photos, or the brand's illustrated figure for photoless products, placed in
// the SDK purchase panel's `media` area — the panel stays Kernel-owned.
export const schema = defineBlock({
  type: 'store:product-figure',
  category: 'media',
  settings: {},
});

export default function ProductFigureBlock(_: BlockProps<typeof schema>) {
  const { params } = usePageContext();
  const { product } = useProduct(params.slug ?? '');
  if (!product) return null;
  const gallery = product.gallery ?? [];
  // a block in `media` replaces the panel's own gallery: hand several photos back to it
  if (gallery.length > 1)
    return (
      <Slot
        name="catalog.Gallery"
        images={gallery.map((g) => ({ url: g.url, alt: g.alt }))}
        productName={product.name}
        figureVariant={product.figureVariant}
      />
    );
  const flavor = product.kind === 'combo' ? KIT_FLAVOR : flavorOf(product.name);
  return (
    <ProductImage
      product={product}
      priority
      sizes="(max-width: 719px) 100vw, 560px"
      className="pd-img"
      fallback={
        <div className="pd-figure" style={{ background: flavor.tint }}>
          <ProductFigure
            variant={product.figureVariant}
            kind={product.kind}
            title={product.name}
            flavor={flavor}
          />
        </div>
      }
    />
  );
}
