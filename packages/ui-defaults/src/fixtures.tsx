import type { Cart, Notice, Order, SlotKey, SlotProps } from '@vendua/kernel';

// Canonical props for every slot (04 — "every slot ships with a conformance
// fixture"). Conformance renders each default AND each storefront override with
// these, so a codemod can prove overrides still typecheck and render.

const noop = () => {};

const notice: Notice = {
  id: 'fx-notice',
  kind: 'promo',
  severity: 'info',
  title: 'Semana do pudim',
  body: '10% off em todos os kits até domingo.',
  actions: [{ type: 'link', label: 'Ver kits', href: '/cardapio' }],
  dismissible: true,
  priority: 10,
};

const cart: Cart = {
  id: 'fx-cart',
  status: 'open',
  items: [
    {
      id: 'fx-line',
      productId: 'fx-product',
      slug: 'pudim-tradicional',
      name: 'Pudim tradicional',
      qty: 2,
      unitPriceCents: 1800,
      productStatus: 'active',
      modifiers: [{ id: 'fx-mod', name: 'Calda extra', priceDeltaCents: 300, status: 'active' }],
      lineTotalCents: 4200,
    },
  ],
  totals: {
    subtotalCents: 4200,
    deliveryFeeCents: 500,
    totalCents: 4700,
    itemCount: 2,
    minOrderCents: 1000,
    remainingMinOrderCents: 0,
    belowMinOrder: false,
  },
  delivery: { mode: 'delivery', neighborhood: 'Centro', zoneId: 'fx-zone' },
};

const order: Order = {
  id: '00000000-0000-4000-8000-000000000001',
  number: 42,
  state: 'preparing',
  customer: { name: 'Ana', phone: '22999990000' },
  delivery: {
    mode: 'delivery',
    etaMin: 30,
    etaMax: 50,
    address: 'Rua A, 1',
    feeCents: 500,
    neighborhood: 'Centro',
  },
  payment: {
    method: 'pix',
    status: 'pending',
    provider: 'sandbox',
    instructions: 'Pix na entrega.',
  },
  subtotalCents: 4200,
  deliveryFeeCents: 500,
  totalCents: 4700,
  placedAt: '2026-09-26T15:00:00Z',
  timeline: [
    { at: '2026-09-26T15:00:00Z', from: null, to: 'placed', actor: 'customer', meta: {} },
    { at: '2026-09-26T15:05:00Z', from: 'placed', to: 'preparing', actor: 'merchant', meta: {} },
  ],
};

export const SLOT_FIXTURES: { [K in SlotKey]: SlotProps[K] } = {
  'system.Notice': { notice, onDismiss: noop, onAction: noop },
  'system.PauseNotice': {
    notice: {
      ...notice,
      id: 'fx-paused',
      kind: 'store_paused',
      severity: 'blocking',
      title: 'Estamos pausados',
      dismissible: false,
    },
    resumesAt: '2026-09-26T21:00:00Z',
    actions: [],
    onNotifyMe: noop,
  },
  'system.StoreClosedNotice': {
    notice: {
      ...notice,
      id: 'fx-closed',
      kind: 'store_closed',
      severity: 'warning',
      title: 'Fechado agora',
    },
    opensAt: '2026-09-27T12:00:00Z',
    onDismiss: noop,
  },
  'system.PromoNotice': { notice, onDismiss: noop },
  'system.ConsentBanner': {
    purposes: [{ id: 'analytics', label: 'Métricas de uso' }],
    onAccept: noop,
    onReject: noop,
  },
  'system.ErrorFallback': {
    error: { code: 'NETWORK_ERROR', message: 'Sem conexão.' },
    retry: noop,
  },
  'system.NotFound': { path: '/nao-existe', homeHref: '/' },
  'system.EmergencyOverlay': {
    notice: {
      ...notice,
      id: 'fx-emergency',
      kind: 'emergency',
      severity: 'blocking',
      title: 'Instabilidade',
      dismissible: false,
    },
  },
  'checkout.Layout': {
    steps: [
      { id: 'dados', label: 'Seus dados', done: true },
      { id: 'entrega', label: 'Entrega', done: false },
      { id: 'pagamento', label: 'Pagamento', done: false },
    ],
    current: 'entrega',
    onStep: noop,
    children: <p>corpo da etapa</p>,
  },
  'checkout.Summary': { cart, currency: 'BRL' },
  'checkout.AddressForm': {
    value: {
      name: 'Ana',
      phone: '22999990000',
      street: 'Rua A',
      number: '1',
      neighborhood: 'Centro',
      complement: '',
      remember: true,
    },
    onChange: noop,
    errors: {},
    part: 'address',
    neighborhoods: ['Centro', 'Itaúna'],
  },
  'checkout.DeliveryOptions': {
    options: [
      { mode: 'delivery', label: 'Entrega', detail: 'a partir de R$ 5,00' },
      { mode: 'pickup', label: 'Retirada', detail: 'na loja' },
    ],
    selected: 'delivery',
    onSelect: noop,
  },
  'checkout.PaymentMethods': {
    methods: [
      { id: 'pix', label: 'Pix', adjustment: { label: '−5%', kind: 'discount' } },
      { id: 'card_on_delivery', label: 'Cartão na entrega' },
      { id: 'meal_voucher', label: 'Vale-refeição' },
      { id: 'cash', label: 'Dinheiro' },
    ],
    selected: 'pix',
    onSelect: noop,
  },
  'checkout.SuccessPage': { order, currency: 'BRL' },
  'checkout.EmptyCart': { onBrowse: noop },
  'cart.Drawer': {
    cart,
    currency: 'BRL',
    presentation: 'page',
    onClose: noop,
    checkout: <button type="button">Ir para o pagamento</button>,
    lines: <li>linha</li>,
    summary: <p>resumo</p>,
  },
  'cart.LineItem': {
    item: cart.items[0]!,
    currency: 'BRL',
    pending: false,
    onQty: noop,
    onRemove: noop,
  },
  'order.StatusPage': { order, currency: 'BRL', timeline: <ol /> },
  'order.Timeline': { events: order.timeline },
  'store.HoursTable': {
    hours: {
      timezone: 'America/Sao_Paulo',
      windows: [{ days: [1, 2, 3, 4, 5], open: '09:00', close: '18:00' }],
    },
    status: 'open',
  },
  'catalog.ProductCard': {
    product: {
      id: 'fx-product',
      slug: 'pudim-tradicional',
      name: 'Pudim tradicional',
      description: 'Receita de família.',
      basePriceCents: 1800,
      compareAtPriceCents: 2400,
      status: 'active',
      figureVariant: 'default',
      tags: [],
    },
    currency: 'BRL',
    href: '/produto/pudim-tradicional',
    link: (children) => <a href="/produto/pudim-tradicional">{children}</a>,
  },
  'catalog.ModifierPicker': {
    groups: [
      {
        id: 'fx-group',
        name: 'Tamanho',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        modifiers: [
          { id: 'fx-p', name: 'Pequeno', priceDeltaCents: 0, status: 'active' },
          { id: 'fx-g', name: 'Grande', priceDeltaCents: 800, status: 'active' },
        ],
      },
      {
        id: 'fx-extras',
        name: 'Caldas',
        required: false,
        minSelect: 0,
        maxSelect: 3,
        pricingRule: 'sum',
        modifiers: [
          {
            id: 'fx-calda',
            name: 'Calda de caramelo',
            priceDeltaCents: 300,
            status: 'active',
            maxQty: 3,
            description: 'Feita na hora.',
            imageUrl: null,
          },
        ],
      },
    ],
    value: { 'fx-group': ['fx-p'], 'fx-extras': ['fx-calda'] },
    onChange: noop,
    currency: 'BRL',
    errors: {},
    quantities: { 'fx-calda': 2 },
    onQtyChange: noop,
  },
  'catalog.ComboPicker': {
    slots: [
      {
        id: 'fx-slot',
        name: 'Sabores',
        minSelect: 4,
        maxSelect: 4,
        qtyPerItem: 2,
        items: [
          {
            productId: 'fx-a',
            slug: 'pudim',
            name: 'Pudim',
            priceDeltaCents: 0,
            status: 'active',
            stockQuantity: null,
            imageUrl: null,
          },
          {
            productId: 'fx-b',
            slug: 'coco',
            name: 'Coco',
            priceDeltaCents: 200,
            status: 'active',
            stockQuantity: 3,
            imageUrl: null,
          },
          {
            productId: 'fx-c',
            slug: 'maracuja',
            name: 'Maracujá',
            priceDeltaCents: 0,
            status: 'sold_out',
            stockQuantity: 0,
            imageUrl: null,
          },
        ],
      },
    ],
    value: [{ slotId: 'fx-slot', productId: 'fx-a', qty: 2 }],
    onChange: noop,
    currency: 'BRL',
    errors: {},
  },
  'catalog.Gallery': {
    images: [
      { url: 'https://cdn.example/pudim-1.webp', alt: 'Pudim inteiro' },
      { url: 'https://cdn.example/pudim-2.webp', alt: null },
    ],
    productName: 'Pudim tradicional',
    figureVariant: 'default',
  },
  'checkout.CouponField': {
    coupon: { code: 'BEMVINDO', label: '10% off', kind: 'percent', applies: true },
    discountCents: 420,
    currency: 'BRL',
    pending: false,
    onApply: noop,
    onRemove: noop,
  },
  'checkout.SchedulePicker': {
    dates: ['2026-09-29', '2026-09-30', '2026-10-01'],
    value: '2026-09-30',
    onChange: noop,
    required: true,
    leadDays: 2,
  },
  'checkout.Notes': { value: 'Sem granulado', onChange: noop, max: 500 },
  'checkout.PixPayment': {
    copyPaste:
      '00020101021226410014br.gov.bcb.pix0119loja@exemplo.com.br520400005303986540547.005802BR5911QUERO PUDIM6009SAQUAREMA62120508PEDIDO4263041A2B',
    beneficiary: 'Quero Pudim',
    keyLabel: 'e-mail',
    amountCents: 4700,
    currency: 'BRL',
  },
  'order.Items': {
    items: [
      {
        productId: 'fx-product',
        slug: 'pudim-tradicional',
        name: 'Pudim tradicional',
        qty: 2,
        unitPriceCents: 2100,
        modifiers: [{ name: 'Calda extra', priceDeltaCents: 300 }],
        combo: [],
        lineTotalCents: 4200,
      },
    ],
    currency: 'BRL',
    notes: 'Sem granulado',
    scheduledFor: '2026-09-30',
    discountCents: 420,
    couponCode: 'BEMVINDO',
    paymentAdjustmentCents: -189,
    paymentLabel: 'Pix',
    onReorder: noop,
  },
  'customer.LoyaltyCard': {
    card: {
      enabled: true,
      stampsRequired: 10,
      stamps: 3,
      minOrderCents: 2000,
      rewardLabel: '1 pudim tradicional grátis',
      rewards: [
        {
          code: 'FIEL-ABC234',
          label: '1 pudim tradicional grátis',
          expiresAt: '2026-11-30T00:00:00Z',
        },
      ],
    },
    currency: 'BRL',
  },
  'customer.PhoneVerify': { phone: '', pending: false, onSubmit: noop },
  'checkout.PaymentStatus': {
    status: 'failed',
    method: 'card_online',
    amountCents: 4700,
    currency: 'BRL',
    action: { label: 'Tentar de novo', onClick: noop },
  },
};
