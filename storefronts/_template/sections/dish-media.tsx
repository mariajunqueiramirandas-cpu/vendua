import { defineBlock, usePageContext, useProduct, type BlockProps } from '@vendua/kernel';
import { DishArt, dishOf } from './_shared/DishArt.tsx';

// The product page's picture, in the SDK purchase panel's `media` area: the photos when there
// are any (swipeable when there are several), the same drawn dish as the menu when there are none.
export const schema = defineBlock({
  type: 'store:dish-media',
  category: 'media',
  settings: {},
});

export default function DishMedia(_: BlockProps<typeof schema>) {
  const { params } = usePageContext();
  const { product } = useProduct(params.slug ?? '');
  if (!product) return null;
  const photos = product.gallery?.length
    ? product.gallery
    : product.imageUrl
      ? [{ url: product.imageUrl, alt: null }]
      : [];
  if (photos.length === 0)
    return (
      <div className="pd-media">
        <DishArt dish={product.kind === 'combo' ? 'box' : dishOf(product.name)} />
      </div>
    );
  return (
    <div className="pd-media pd-photos" tabIndex={photos.length > 1 ? 0 : undefined}>
      {photos.map((g, i) => (
        <img
          key={g.url}
          src={g.url}
          alt={g.alt ?? (i === 0 ? product.name : '')}
          loading={i === 0 ? 'eager' : 'lazy'}
          {...(i === 0 ? { fetchpriority: 'high' } : {})}
        />
      ))}
    </div>
  );
}
