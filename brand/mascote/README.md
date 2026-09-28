# Venduá — mascote (tamanduá)

Kit recebido em set/2026 (LEIA-ME original: 20 artes). Aqui estão as **16 poses já entregues**, em WebP
com alfa, 640×640 (recortadas e centralizadas; os PNG originais 1254×1254 ficam com o design).

Ainda faltam do kit: `avatar-ajuda`, `boas-vindas`, `horarios`, `loja`. Para adicionar: gerar o WebP no
mesmo formato, salvar aqui, e incluir o nome em `Pose` em `apps/admin/src/ui/Mascote.tsx`.

| Arquivo                                                                            | Uso                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------ |
| `avatar-ola` / `avatar-pensando` / `avatar-feliz`                                  | Balão do assistente (64–96 px), login      |
| `personalizar` `pagamento` `catalogo` `entrega` `publicar`                         | Passos do onboarding, finale               |
| `sucesso` `erro` `carregando` `sem-resultados` `sem-pedidos` `offline` `seguranca` | Estados vazios/erro                        |
| `carinho`                                                                          | Marca / acolhimento (ainda sem uso no app) |

## Regras (do kit)

- Verde `#123C32`, lima `#D9F875`, creme `#F7F4EA`. Não esticar, não espelhar (o V inverte), sem filtros de cor.
- Avatares 64–96 px; ilustrações 180–320 px. Abaixo de 48 px use o símbolo V, não o personagem.
- Em fundo verde, coloque o mascote sobre uma superfície creme.
- `alt=""` quando decorativo: erro/sucesso/carregamento precisam de texto no HTML.
- Carregue só as poses usadas; não sirva o pacote todo.

## Uso no admin

```tsx
import { Mascote } from '../ui/Mascote.tsx';
<Mascote pose="sem-resultados" size={160} />;
```

`EmptyState` recebe o mascote em `art`; `ErrorState` já escolhe `offline` (sem rede) ou `erro`.
`mascote.css` traz o balão `.vendua-assistente` para outros apps (o admin usa `Guide.tsx`).
