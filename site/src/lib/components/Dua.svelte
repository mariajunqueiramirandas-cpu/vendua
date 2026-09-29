<script lang="ts" module>
  // Duá, the Venduá anteater, from the finished kit in /brand/mascote (re-encoded to 480 px by
  // `scripts/assets.ts dua`). Kit rules: never mirror it (the V on the bag flips), never recolour it.
  // Decorative by default; pass `alt` when the pose carries meaning the text doesn't.
  export type Pose =
    | 'avatar-ajuda'
    | 'avatar-feliz'
    | 'avatar-ola'
    | 'avatar-pensando'
    | 'boas-vindas'
    | 'carinho'
    | 'carregando'
    | 'catalogo'
    | 'entrega'
    | 'erro'
    | 'horarios'
    | 'loja'
    | 'offline'
    | 'pagamento'
    | 'personalizar'
    | 'publicar'
    | 'seguranca'
    | 'sem-pedidos'
    | 'sem-resultados'
    | 'sucesso';
</script>

<script lang="ts">
  let {
    pose,
    size = 200,
    alt = '',
    eager = false,
    class: cls = '',
    style = '',
  }: {
    pose: Pose;
    size?: number;
    alt?: string;
    eager?: boolean;
    class?: string;
    style?: string;
  } = $props();
</script>

<img
  class="dua {cls}"
  src="/dua/{pose}.webp"
  {alt}
  width="480"
  height="480"
  loading={eager ? 'eager' : 'lazy'}
  decoding="async"
  style="--size: {size}px; {style}"
/>

<style>
  .dua {
    width: min(var(--size), 100%);
    height: auto;
    aspect-ratio: 1;
    user-select: none;
    -webkit-user-drag: none;
  }
</style>
