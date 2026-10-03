# Vendedor: the merchant's screens

> Status: Built 2026-10-03 · Started 2026-10-03 · Board: [`sales-agent-screens.html`](sales-agent-screens.html)
> (open it in a browser; Creme and Noite) · Features: [`sales-agent-features.md`](sales-agent-features.md)
> · Design: [`sales-agent.md`](sales-agent.md) · Follows: [`merchant-admin-design.md`](../merchant-admin-design.md)

The merchant-facing side of the Vendedor, the AI that sells on the store's WhatsApp: where the
owner watches it sell, steps in, teaches it, checks it and sets it up. It builds on the team's
first board (five phone screens, a desktop inbox and a list of what's deliberately absent), which
is kept and extended. Everything here obeys the admin's design spec: its tokens, its UX laws, its
voice and its definition of done. Where this needs the spec to change, [§9](#9-changes-to-the-admin-design-spec)
says so.

Sample data throughout: a fictional pizzeria, Forno da Vila, whose owner named the Vendedor
"Ana". The name is the merchant's choice; "Vendedor" is the product's working name.

## 1. Principles

The board's four, kept:

1. **Three voices.** Shoppers on paper, the Vendedor on spark-soft with a spark edge, the owner
   in forest. Every Vendedor message is signed ("Ana · Vendedor"), so the author never rests on
   colour alone.
2. **Money looks like a receipt.** Totals, fees and Pix codes are Core's, drawn as receipt paper
   with a dashed tear and "calculado pela loja". The Vendedor's own words carry a figure only as a
   reference Core filled, so the guarantee is visible.
3. **The floor is always visible.** Every conversation says who is answering. Taking over is one
   tap, or just replying from the phone; handing back is one tap.
4. **Proof before trust.** Ensaio and Cliente oculto show what it would do on this store's own
   menu before it talks to anyone. "Por quê" sits under every action.

Added in this pass:

5. **One question per control.** The CRM's autonomy slider asked "may it send?". A shopper can't
   wait for approval, so the merchant answers two plain questions instead: _when does it answer_
   (coverage) and _what may it do_ (capabilities).
6. **Honest guarantees.** The screens never promise more than the code enforces. A rule the
   system enforces says "sempre cumprida"; one the model follows says "a Ana segue como
   orientação". Prices are always "calculado pela loja"; advice never is.
7. **Attention is earned.** A shopper waiting for the merchant is the only Vendedor event that
   interrupts. Everything else waits on its home.
8. **Every state is designed.** First use, Ensaio, paused, outside coverage, disconnected, over
   budget, offline, empty and very full, per the admin's definition of done (§12).

Deliberately absent (the board's four, plus two):

| Absent                     | Why                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| An autonomy slider         | Coverage and capabilities answer the questions a merchant actually has.                         |
| A queue of drafts          | Ensaio drafts silently while the owner keeps answering; the agreement score earns the switch.   |
| Run timelines and raw JSON | Owners get plain receipts and "por quê"; spans, tokens and cost stay in the staff console.      |
| Dense neutral chrome       | Cream paper, 48 px targets, display numerals, one-handed reach, like the rest of the admin.     |
| Sparkles everywhere        | Spark marks only what is alive (her breathing ring, the newest sale). The AI isn't decorated.   |
| A confidence percentage    | A model's score means nothing to a merchant. Receipts, reasons and the Cliente oculto score do. |

## 2. Where it lives

| Route                         | Screen                                                                                         | Who                                 | Phase |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------- | ----- |
| `/vendedor`                   | Início do Vendedor (the onboarding's resume map until it's on)                                 | attendant and up                    | V1    |
| `/vendedor/comecar`           | Treinar a Ana: the Vendedor's own onboarding ([§3.12](#312-treinar-a-ana-vendedorcomecar-new)) | owner                               | V1    |
| `/vendedor/conversas`         | Conversas (list; on desktop, list + thread)                                                    | attendant and up                    | V1    |
| `/vendedor/conversas/:id`     | Conversa                                                                                       | attendant and up                    | V1    |
| `/vendedor/ensinar`           | Ensinar: unanswered questions, answers, rules                                                  | manager and up                      | V1    |
| `/vendedor/ensaio`            | Ensaio: the agreement report                                                                   | manager and up                      | V1    |
| `/vendedor/cliente-oculto`    | Cliente oculto                                                                                 | manager and up                      | V1    |
| `/vendedor/resultados`        | Resultados                                                                                     | manager and up                      | V3    |
| `/vendedor/configurar`        | Configurar                                                                                     | manager; owner for money and on/off | V1    |
| `/clientes/:phone` (existing) | Gains "o que a Ana sabe"                                                                       | manager and up                      | V3    |

Routes are under `/admin/` like every admin screen, and each needs its chunk, `ROUTES` entry and
skeleton (`apps/admin/CLAUDE.md`). Drill-downs stack with a back gesture (admin §3.3); the
conversation list and thread are one route each on phones, a split on desktop.

**Navigation.** The phone bar is Início · Pedidos · Cardápio · Loja · Mais today
(`apps/admin/src/app/nav.ts`). Decided (owner, 2026-10-03): once the Vendedor is on, the bar is
Início · Pedidos · Vendedor · Cardápio · Mais, as the board draws it, with the "precisa de você"
count as the Vendedor's badge. Loja moves to Mais; its everyday tasks (pause, today's hours) stay
one tap away in the status pill, which is always present (admin §3.2). Before it's on, the
Vendedor lives in Mais with a hint ("conheça a Ana"), and Início shows one card inviting setup.

## 3. Screens

Each screen lists its job, its order of content, its one primary action (admin law 6) and the
states it must draw. "Board" marks what the first board had; "new" what this pass adds.

### 3.1 Primeiro uso (`/vendedor` before it's on): new

**Job.** Get from "connected" to "selling" with proof. The work happens in the Vendedor's own
onboarding ([§3.12](#312-treinar-a-ana-vendedorcomecar-new)); this page is its door and its
resume map.

**Content.**

1. "Conheça a Ana" with her avatar, not yet breathing, and one line on what she does.
2. Before the onboarding starts: "treinar a Ana · cerca de 5 min", which opens `/vendedor/comecar`.
3. Midway, the resume map: the four parts (Conhecer ✓ · Ensinar · Testar · Começar) with where
   the owner stopped ("continuar: a entrevista, 3 de 7").
4. "Você pode desligar quando quiser."

**Primary action.** "treinar a Ana" or "continuar". "Ligar a Ana" stays available as a
secondary action and is never disabled: the onboarding informs, the merchant decides.

**States.** WhatsApp not connected (the onboarding's first part handles it); the onboarding
finished but the Vendedor is off (the finale's two actions return: "começar em ensaio", "ligar
agora").

### 3.2 Início do Vendedor (`/vendedor`): board, extended

**Job.** Show that it's working, what it earned, and what needs the owner.

**Content.**

1. **Presence:** avatar with the breathing ring, "Ana está atendendo", "3 conversas agora ·
   responde em 4 s", and the coverage mode as a row ("Quando atende: Sempre ›").
2. **Today's number:** "Vendido pelo Vendedor hoje", with a spark delta when a sale lands
   (admin §6.2), the order count and average ticket. Below it, three stats: conversion, reply
   time, suggestions taken.
3. **Precisa de você** (board): name, the shopper's words, a reason chip (alergia, reclamação,
   pedido grande, pediu uma pessoa). New: how long they've waited ("esperando há 2 min", turning
   warning after 5 min) and a one-tap "assumir" on the row.
4. **Enquanto você dormia** (board): orders it closed while the store was closed or the owner
   away, and when they're scheduled. Instrument Serif, the admin's moment type, used sparingly.
5. **Pediram e você não tem** (board): items asked for that the menu lacks, with counts and
   "adicionar ao cardápio". New: **pediram entrega onde você não entrega**, neighbourhoods with
   counts and "ver no mapa", which opens the zones editor on that area.

**Primary action.** None fixed. The first "assumir" is the action when someone waits.

**States.**

| State                               | What the presence card says                                            | Action                |
| ----------------------------------- | ---------------------------------------------------------------------- | --------------------- |
| On, answering                       | "Ana está atendendo · 3 conversas agora"                               | —                     |
| Ensaio                              | "Ana está em ensaio · escreveu 12 respostas hoje"                      | "ver ensaio"          |
| Quando eu demorar / fora do horário | "Você está atendendo · a Ana entra se você demorar 2 min"              | —                     |
| Paused by the owner                 | "Ana pausada" (no ring)                                                | "ligar"               |
| WhatsApp disconnected               | "Ana parou: o WhatsApp da loja desconectou" (warning)                  | "reconectar"          |
| AI budget reached                   | "Ana está mandando o link da loja até o mês virar" (warning)           | "ver limite"          |
| Service trouble                     | "A Ana está com instabilidade; as conversas foram para você" (warning) | —                     |
| Offline                             | The admin's calm offline banner; last data kept (admin law 10)         | —                     |
| No conversations yet                | "Ninguém escreveu ainda hoje. A Ana responde assim que alguém chamar." | "testar como cliente" |

### 3.3 Conversa (`/vendedor/conversas/:id`): board, extended

**Job.** Follow a sale and step in without friction.

**Content, top to bottom.**

1. **App bar:** customer name, "14 pedidos · cliente desde mar 2025", "⋯" holding "ver cliente"
   and "não é cliente" (mutes the number for good).
2. **The sacola, pinned** (board): item count, the total from Core, and the stage stepper:
   montar · endereço · pagamento · confirmar · feito. Tapping it opens the sacola sheet with every
   line and option.
3. **The thread:**
   - **Shopper bubbles** on paper. Voice notes show a waveform, the duration and the transcript
     in italics.
   - **Action receipts** between bubbles ("anotou 2 itens na sacola", "entrega: R$ 7,00 · ~40
     min"), each with "por quê".
   - **The Vendedor's bubbles:** signed, spark-soft, with a "sugestão" tag when it's an offer.
   - **Core's receipt:** "Seu pedido · calculado pela loja".
   - **Event chips:** "Pedido #1284 feito · Pix enviado · aguardando pagamento", linking to the
     order.
4. **The floor** (board):
   - **Ana's floor:** "Ana está atendendo" with "assumir" and the hint "Ou responda pelo seu
     celular: ela pausa sozinha nesta conversa."
   - **The owner's floor:** "Você está atendendo", "devolver à Ana", her suggested replies as
     chips, and the composer. New: "A Ana volta se você ficar 30 min sem responder", the
     merchant's setting, stated where it applies.

**"Por quê".** A sheet reading the turn's events in plain words: what the shopper asked, what
the Vendedor looked up, which figures came from Core, which rule applied. For a suggestion, it
says why: "41% de quem pede pizza G calabresa nesta loja leva borda de catupiry", "Preço da
borda: R$ 9,00, calculado pela loja", "Primeira sugestão deste pedido". "Ensinar a responder
diferente" opens Ensinar with the context filled in.

**States.**

- Ensaio: the Vendedor's would-be replies appear as dashed, unsent bubbles labelled "não
  enviado · ensaio", with "eu mandaria isso" / "eu mandaria diferente".
- Handed off: a warning chip in the app bar ("precisa de você · alergia") and the owner's floor
  open by default.
- Order placed: the stepper is complete and the receipt links to the order.
- Not a customer: the thread is muted, with a quiet line "você marcou que não é cliente ·
  desfazer".
- A very long sacola: the receipt shows the first 6 lines and "+ 52 itens".

### 3.4 Aviso (the push): new

The one Vendedor event that interrupts: a shopper waiting for the merchant (a handoff, or a
question it can't answer while the owner is the fallback).

- **Notification:** "Júlia precisa de você · alergia", then the shopper's words and the wait:
  "“a massa tem lactose?” · esperando há 1 min".
- **Actions:** "assumir" opens the thread on the owner's floor; "abrir" opens it as is. One push
  per conversation per handoff; replies don't re-push.
- **Fallback.** If no device receives it, the store's existing WhatsApp fallback to owners
  (`src/admin/workers.ts`) applies after the store's acceptance target, as for new orders.
- **Service worker.** It gains a thread action beside the order "aceitar"; `tag` is the thread,
  so updates replace rather than stack.

### 3.5 Ensinar (`/vendedor/ensinar`): board, extended

**Job.** Make the store's knowledge and rules the merchant's, in their own words.

**Content.**

1. **Perguntas sem resposta** (new): questions it couldn't answer, with how often each was
   asked ("Vocês têm opção vegana? · 4 vezes"), an inline answer field and "ensinar". Answering
   also replies to the shoppers still waiting, if the merchant chooses.
2. **Aprendi com você** (board): the owner's reply to a handed-off shopper comes back as a
   proposal: "Quer que a Ana responda assim daqui pra frente?" with "ensinar", "editar" and
   "ignorar". Nothing goes live without "ensinar".
3. **Respostas** (board): question, answer, "usada 9 vezes", and "nova".
4. **Regras** (board, extended): rules in plain words. New: each rule shows whether it's
   guaranteed.
   - **"Sempre cumprida"** (shield): rules the system recognizes and enforces in code. Examples:
     "pedidos com mais de 10 pizzas: passe para mim", "não aceite dinheiro acima de R$ 200",
     "não ofereça cupom para pedido abaixo de R$ 40". Typing one shows a structured preview
     before saving.
   - **"A Ana segue como orientação"** (quiet chip): everything else, such as "nunca ofereça
     borda doce em pizza salgada". The board's caption explains the difference in one line.
5. The board's note: "Horário, taxas, preços e estoque a Ana lê da loja na hora. Não precisa
   ensinar."

**Primary action.** "testar como cliente" (board).

**States.** Empty: "A Ana já sabe o seu cardápio, horários e taxas. Ensine aqui o que só você
sabe: estacionamento, encomendas para festa…" with "nova resposta".

### 3.6 Ensaio (`/vendedor/ensaio`): new

**Job.** Turn the silent week into a decision.

**Content.**

1. A score ring: "A Ana escreveu 46 respostas sem mandar. Você mandaria 41 iguais ou quase."
2. **Onde vocês discordaram:** the shopper's message, what Ana would have said, and what the
   owner said, with "ensinar como eu fiz" (becomes an answer or a rule) and "a Ana estava certa"
   (dismiss).

**Primary action.** "ligar a Ana".

**States.** First day ("ainda poucas conversas · volte amanhã"); no disagreements ("vocês
concordaram em tudo").

### 3.7 Cliente oculto (`/vendedor/cliente-oculto`): board, extended

**Job.** An objective score on this store's own menu.

**Content.**

1. **The score:** the ring "19 de 20 pedidos saíram certos", explained as "cada cliente de teste
   tinha um pedido escondido. Comparamos item por item com o que a Ana fechou."
2. **Checks:** "preço certo em todos os pedidos" (always 20/20, by construction), "pedidos por
   áudio", "chamou você quando pediram", "fora da área, explicou com calma". A miss shows a
   warning icon.
3. **Miss cards** turn into menu fixes. "Uma cliente pediu uma pizza broto e a Ana montou uma P.
   No seu cardápio, a broto não diz o tamanho." with "abrir a pizza broto", which deep-links to
   the product.
4. New: **"rodou sozinho depois que você mudou o cardápio, ontem às 18h"**. It re-runs after
   menu changes, and a drop shows on the Vendedor's home; otherwise it stays quiet.

**Primary action.** "ligar a Ana" (or nothing if it's on); "rodar de novo" is secondary.

**Scenarios** come from this store: its best sellers, its modifier groups and halves, its
combos, its zones (one inside, one outside), its hours (one when closed), its encomendas, one
audio, one request for a person. They are the design's simulations with a hidden target order
([sales-agent §7](sales-agent.md#7-quality)), scored in code.

### 3.8 Resultados (`/vendedor/resultados`): new

**Job.** Answer "is it worth it?" honestly.

**Content.** Period chips (hoje · 7 dias · 30 dias). Then:

1. **Vendido pela Ana**, large. Under it, "+ ajudou em R$ 1.120,00 (pedidos no site até 24 h
   depois de ela mandar o link)". The attribution window is stated in words.
2. **Funnel:** conversas → montaram sacola → viram o resumo → fecharam.
3. **Ticket médio:** Ana against the site.
4. **Sugestões:** offered, taken, revenue. **Recuperados:** orders and revenue.
5. **Speed:** "respondeu em 4 s na metade das vezes · 11 s quase sempre".
6. **Passou para você:** count by reason.
7. **Para esta semana:** up to three one-tap proposals, each with its evidence. Examples:
   "ensinar resposta sobre opção vegana (perguntaram 4×)", "parar de sugerir refrigerante 600 ml
   (ninguém aceitou)", "lembrar sacola parada depois de 10 min em vez de 15".

**States.** Before enough data: "Com uma semana de conversas os números ficam confiáveis."

### 3.9 Configurar (`/vendedor/configurar`): board, extended

**Job.** Set it up in plain words. It autosaves (admin law 5).

**Content.**

1. **Ana ligada** (new): one switch (owner).
2. **Nome**, **dizer que é assistente virtual** (a switch, on by default; owner), and **jeito
   de falar** (descontraído · equilibrado · formal) with the live preview bubble (board). With
   the switch on, the name shows the suffix "assistente virtual" and the greeting says it. Off,
   it introduces itself by name only; it still never claims to be a person, and says it is the
   store's assistant when asked.
3. **Quando a Ana atende** (board):
   - **Ensaio:** "ela escreve o que diria, mas não manda nada".
   - **Quando eu demorar:** new, the wait is a choice, 1 · 2 · 5 min. It also covers the store
     being closed.
   - **Fora do horário:** "só com a loja fechada; agenda pedidos para quando abrir".
   - **Sempre:** "responde tudo na hora; você assume quando quiser".
4. **O que a Ana pode fazer** (board):
   - "fechar o pedido" (off sends the ready sacola link);
   - "mandar o Pix";
   - "sugerir adicionais" (one per order);
   - "oferecer cupons": only the ones the merchant picks, up to a monthly limit they set
     (owner).
5. **Passe para mim quando** (new):
   - reclamação ou atraso;
   - alergia ou restrição;
   - pedido acima de R$ 300,00 (amount editable);
   - cliente novo pagando em dinheiro.

   Then "a Ana volta sozinha depois de 30 min sem resposta sua · trocar".

**States.** Saving ("salvo" per field), and a field that failed ("não salvou · tentar de novo").

### 3.10 Desktop inbox (≥ 1200 px): board, extended

Three panes (board): the list, the thread with its sacola and floor, and a rail with the
customer card (masked phone, orders, total spent, usual order, payment) and "por quê" for the
selected Vendedor message.

New:

- **Filters:** "outros" for numbers that don't read as customers, held unanswered.
- **Keyboard:** A assumir · D devolver · J/K próxima e anterior · / buscar, listed under "?" like
  the order board (admin §10).

### 3.11 Cliente (`/clientes/:phone`): new section

**O que a Ana sabe:** the facts it remembers ("massa bem assada", "prefere Pix", "entrega no
trabalho às sextas"), each with a source ("ela anotou em 12 set") and an "esquecer" button. The
existing LGPD forget clears these with everything else.

### 3.12 Treinar a Ana (`/vendedor/comecar`): new

**Job.** The Vendedor's own onboarding (owner decision, 2026-10-03), separate from the store's
(`/bem-vindo`, admin §6.8). The store's journey ends with the store on the air; this one starts
when the merchant chooses to hire a seller for it. They share a feel, not a flow:

| Aspect  | The store's onboarding              | Treinar a Ana                                            |
| ------- | ----------------------------------- | -------------------------------------------------------- |
| Parts   | Cadastro · Sua loja · No ar         | Conhecer · Ensinar · Testar · Começar                    |
| Guide   | Duá, the mascot, in a speech bubble | Ana herself, in first person, with her persona avatar    |
| Preview | The storefront assembling itself    | A WhatsApp chat in which Ana answers better at each step |
| Ends    | "sua loja está no ar"               | "A Ana está pronta": start in Ensaio, or turn her on     |

**When it is offered.** It is never part of the store's journey. Once that journey's finale is
behind the merchant, Início shows one card, once (admin law 12): "Conheça a Ana · sua vendedora
no WhatsApp · cerca de 5 min". It also opens from the Vendedor's entry and from `/vendedor`
before she's on. It needs a live store (menu, hours, delivery); if one is missing, the first
screen says which and links to that question of the store's onboarding.

**How it behaves.** The same rules as the store's journey:

- one question per screen, presets instead of blank fields, 56 px buttons;
- a quiet "pular" on anything optional, and "continuar depois" in the header;
- progress kept by Core, so another device opens the resume map;
- on phones, the WhatsApp preview sits behind "espiar a Ana", like "Espiar minha loja".

Owner only (turning her on is the owner's).

**The four parts.**

1. **Conhecer** (2 screens):
   - Her name (presets Ana · Bia · Léo · outro), "dizer que é assistente virtual" and the tone.
     The preview greeting changes as they choose.
   - The store's WhatsApp: linked (ADR 0026), or the pairing code right here. It also asks
     that the WhatsApp Business app's own AI be turned off ("duas IAs respondendo confunde o
     cliente").
2. **Ensinar**:
   - **"Li sua loja"**: what she read (menu size, hours, zones, payment methods) and what
     wasn't clear in the menu. The gaps come from Core, not from the model:
     - a size-less "broto";
     - an option with no price on one size;
     - no product saying whether it has gluten or lactose;
     - two products with the same name;
     - a combo with no slots.

     Each has "arrumar" (opens the product and comes back) or "deixa assim".

   - **A entrevista**: 5 to 8 questions about what only the owner knows, tuned to the segment
     and to the gaps above. For a pizzaria: three flavours? encomendas para festa? parking? what
     she must never promise? The owner answers with a preset, by typing or with a voice note.
     She turns each answer into a proposed **Resposta** or **Regra**, with its guarantee chip
     ("sempre cumprida" or "a Ana segue como orientação"). The owner taps "está certo" or
     "editar"; nothing is saved without that tap.
   - **Quando passar para você**: the handoff switches, at their defaults.
3. **Testar**:
   - **"Peça para mim"**: the owner orders as a customer. It is the real Vendedor on the real
     menu, and the order is checked the way checkout checks it, but it stops before it exists.
     Its receipt says "pedido de teste · não vai para a cozinha".
   - **Cliente oculto** then runs: 20 test customers, a live list ("pediu meia a meia com borda
     ✓"), the score and its fixes ([§3.7](#37-cliente-oculto-vendedorcliente-oculto-board-extended)).
4. **Começar**:
   - When she answers, with the recommended default (quando eu demorar, 2 min).
   - The finale: "A Ana está pronta" in Instrument Serif, what she knows ("sabe o cardápio ·
     aprendeu 6 respostas · 2 regras · 19 de 20 no cliente oculto") and what was left for later,
     each item a detour back.
   - Two actions: **"começar em ensaio"** (primary, recommended for the first days) and "ligar
     agora".

**Time budget.** About 5 minutes without the interview, under 12 with it, measured in
usability sessions like the admin's everyday tasks.

**States.** WhatsApp not linked; the Business app's AI possibly on (asked, not detected);
Cliente oculto running; the interview skipped (the finale lists it); a store not yet live
(links back to `/bem-vindo`).

## 4. Components

New components go in `apps/admin/src/ui/` and on the `/_ui` reference route.

| Component     | From  | Notes                                                                                                            |
| ------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| PersonaAvatar | board | Spark disc with the initial; a breathing ring only while it is answering; static otherwise.                      |
| Bubble        | board | Three voices: `in` (paper), `seller` (spark-soft + edge, signed), `you` (forest). Optional tag ("sugestão").     |
| VoiceNote     | board | Play, waveform, duration, transcript; the transcript is the accessible name.                                     |
| ActionReceipt | board | One line: icon, what happened, "por quê".                                                                        |
| CoreReceipt   | board | Paper with a dashed tear, line items, total, ETA, "calculado pela loja" with a shield. Table semantics.          |
| SacolaBar     | board | Count, total, five-step stepper; opens the sacola sheet.                                                         |
| Floor         | board | Who's answering, the action, the hint; the owner variant has suggestion chips and the composer.                  |
| ReasonChip    | board | Warning chip with icon and word (alergia, reclamação, pedido grande, pediu uma pessoa).                          |
| ScoreRing     | board | "19 de 20"; the number is the accessible label.                                                                  |
| GuaranteeChip | new   | "sempre cumprida" (shield, success) or "orientação" (quiet).                                                     |
| ChecklistRow  | new   | Step, state (done, to do, optional), action.                                                                     |
| Discordance   | new   | Shopper message, her draft (dashed), your reply, two actions.                                                    |
| Funnel        | new   | Horizontal bars with counts; a text summary for screen readers.                                                  |
| AgentJourney  | new   | The onboarding's journey bar (Conhecer · Ensinar · Testar · Começar): the store's `JourneyBar` with other parts. |
| AgentGuide    | new   | Ana's avatar beside a speech bubble: the store onboarding's `Guide` pattern with the persona instead of Duá.     |
| MiniChat      | new   | The onboarding's live WhatsApp preview, the counterpart of `MiniStore`.                                          |
| ProposalCard  | new   | A Resposta or Regra Ana proposes, with its guarantee chip and "está certo" / "editar".                           |

## 5. Copy

The admin's voice (admin §9): warm, direct, brief; "você"; lowercase-first buttons.

- **Naming.** To the merchant it is "a Ana" (whatever they named it) or "o Vendedor". To the
  shopper it is "Ana, assistente virtual da Forno da Vila", or "Ana, da Forno da Vila" with the
  disclosure switch off. Never "IA", "robô", "bot", "modelo",
  "prompt", "token" or "agente" in the admin.
- **Its actions** are past-tense receipts: "anotou", "calculou a entrega", "mandou o Pix",
  "passou para você".
- **Guarantees** use the same words everywhere: "calculado pela loja" for figures, "sempre
  cumprida" for enforced rules.
- **Money** is formatted by Core and the admin (`R$ 1.284,50`), never typed into copy.
- **No promises about the product itself**: no plan, price or quota appears in these screens
  until the owner decides how AI is charged.

## 6. Motion and touch

- **The breathing ring** (3.2 s) means "answering now". It stops when paused, in Ensaio or when
  the owner holds the floor.
- **The sale delta** rises once when a Vendedor order lands (admin §6.2's number that grows).
- **"Assumir"** gives a light haptic on phones; the floor swaps without a page change.
- **First sale:** the first order it closes gets a one-time moment in Instrument Serif ("A Ana
  fez a primeira venda"), like the admin's first order (§6.4).
- **Reduced motion** stops the ring, the pulse and the delta.

## 7. Accessibility

Everything in admin §10, plus:

- **Authorship.** Bubbles carry the author in text (the signature and an accessible name), not
  only colour.
- **Live regions.** "Júlia precisa de você, alergia" is announced in the inbox and on the home;
  a new Vendedor sale is announced like a new order.
- **Receipts** are tables to screen readers; the stepper is a list with the current step
  marked.
- **Contrast.** The spark-soft bubble keeps body text at ≥ 7:1 in both themes, as the board
  does.

## 8. What each control sets

The controls write the `store_agent` setting ([sales-agent §5](sales-agent.md#5-merchant-controls)):

| Control                        | Field                                                                          | Role                   |
| ------------------------------ | ------------------------------------------------------------------------------ | ---------------------- |
| Ana ligada                     | `enabled`                                                                      | owner                  |
| Nome, jeito de falar           | `name`, `tone`, `voice`                                                        | manager                |
| Dizer que é assistente virtual | `disclose`                                                                     | owner                  |
| Quando a Ana atende            | `coverage`, `slowAfterMin`                                                     | manager                |
| O que a Ana pode fazer         | `capabilities.{closeOrder, sendPix, suggest, coupons}`                         | manager; coupons owner |
| Cupons e limite                | `incentives`                                                                   | owner                  |
| Passe para mim quando          | `handoff.{complaint, allergy, aboveCents, newCashCustomer}`, `humanSilenceMin` | manager                |
| Regras, respostas              | `store_knowledge`, compiled rules                                              | manager                |
| Não é cliente                  | a muted contact                                                                | attendant              |

## 9. Changes to the admin design spec

Decided (owner, 2026-10-03) and applied to `merchant-admin-design.md`:

1. **Law 13 (respect attention)** adds "a shopper waiting for you in a Vendedor conversation" to
   the events that may push. A waiting shopper is as time-sensitive as a new order.
2. **§3.1 navigation** puts the Vendedor in the phone bar while it is on, with Loja moving to
   Mais (see [§2](#2-where-it-lives)).

Still to do when the screens are built: **§7 components** gains the components of
[§4](#4-components).

## 10. Open decisions

Decided (owner, 2026-10-03):

- **The phone bar:** yes, the Vendedor is in it while on ([§2](#2-where-it-lives)).
- **The push** for a waiting shopper: yes ([§3.4](#34-aviso-the-push-new)).
- **Disclosure:** a switch, not fixed ([§3.9](#39-configurar-vendedorconfigurar-board-extended)).
- **Who pays for Cliente oculto runs:** deferred, with how AI is charged.

Open:

1. **Ensaio's length:** a suggestion of three days, or until a number of conversations.
2. **Tone presets alone, or presets plus free text** for the voice.
3. **The disclosure switch's default:** on is the recommendation.

## 11. Definition of done

Admin §12 applies to every screen: the signed-off board at 375 / 820 / 1440 in Creme and Noite,
every state from §3, CI gates, 200% text, reduced motion, forced colours, a real merchant session
and the wow test. Two Vendedor-specific tasks join the admin's usability set:

- From the lock-screen push, take over a waiting shopper and send a reply in **≤ 2 taps** plus
  typing.
- From Início, see whether the Vendedor is answering, and why not if it isn't, in **0 taps**.

## Change log

- 2026-10-03: first spec, from the team's board plus this pass's additions.
- 2026-10-03: owner decisions: the phone bar, the push, disclosure as a switch; AI charging
  deferred.
- 2026-10-03: the Vendedor's own onboarding, separate from the store's (owner decision), §3.12.
