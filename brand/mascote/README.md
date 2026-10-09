# Venduá — mascote (tamanduá) — o nome é Duá

Na cópia, Duá é masculino: "o Duá", "ele", "ligado" (decisão do dono, 2026-10-03). Duá é também o
vendedor com IA da loja (ADR 0031/0032): o mesmo nome em todas as lojas, e esta arte é o rosto dele.

Kit recebido em set/2026 (LEIA-ME original: 20 artes). Aqui estão as **20 poses já entregues**, em WebP
com alfa, 640×640 (recortadas e centralizadas; os PNG originais 1254×1254 ficam com o design).

Todas as 20 artes do kit estão aqui. Para adicionar novas: gerar o WebP no
mesmo formato, salvar aqui, e incluir o nome em `Pose` em `apps/admin/src/ui/Mascote.tsx`.

| Arquivo                                                                                    | Uso                                        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `avatar-ola` / `avatar-pensando` / `avatar-feliz` / `avatar-ajuda`                         | Balão do assistente (64–96 px), login      |
| `boas-vindas` `horarios` `loja` `personalizar` `pagamento` `catalogo` `entrega` `publicar` | Passos do onboarding, finale               |
| `sucesso` `erro` `carregando` `sem-resultados` `sem-pedidos` `offline` `seguranca`         | Estados vazios/erro                        |
| `carinho`                                                                                  | Marca / acolhimento (ainda sem uso no app) |

## Regras (do kit)

- Verde `#123C32`, lima `#D9F875`, creme `#F7F4EA`. Não esticar, não espelhar (o V inverte), sem filtros de cor.
- Avatares 64–96 px; ilustrações 180–320 px. Abaixo de 48 px, o rosto do Duá vendedor usa o personagem recortado na cabeça (decisão do dono, 2026-10-03); o resto usa o símbolo V.
- Em fundo verde, coloque o mascote sobre uma superfície creme.
- `alt=""` quando decorativo: erro/sucesso/carregamento precisam de texto no HTML.
- Carregue só as poses usadas; não sirva o pacote todo.

## Uso no Discord

O bot da equipe usa 10 poses em `apps/control/public/discord/` (256 px, sobre um bloco creme
para o verde aparecer no tema escuro do Discord) e `avatar.png` (cabeça do `avatar-ola` sobre
disco lima-claro), que o **conectar** do CRM põe como avatar do bot e ícone do app.
Veja `docs/deploy/discord.md`.

## Uso no admin

```tsx
import { Mascote } from '../ui/Mascote.tsx';
<Mascote pose="sem-resultados" size={160} />;
```

`EmptyState` recebe o mascote em `art`; `ErrorState` já escolhe `offline` (sem rede) ou `erro`.
`mascote.css` traz o balão `.vendua-assistente` para outros apps (o admin usa `Guide.tsx`).
