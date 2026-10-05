# ADR 0033: Who Duá answers on a number that is also the owner's own

- Status: Accepted (built 2026-10-05, Core migration 0087)
- Date: 2026-10-05

## Context

Duá answers on the store's own WhatsApp ([ADR 0031](0031-vendedor.md)), linked as a device
([ADR 0026](0026-store-whatsapp-gateway.md)). Many owners use one number for the store and for their
life: "my store number is also my personal number, and I don't want it to answer my friends."

Until now the ingest classified a thread once: a shopper if the number had ordered, if the
merchant chose "all numbers", or if the first message didn't read as a supplier's or a bill's. A
friend's "oi, tudo bem?" was a shopper, and Duá answered it. The gateway skips history sync, so
Core knew nothing about the chats the owner already has.

## Decision

**A new number is classified before Duá says anything, and only an owner decision overrides
it.** The owner's decisions of 2026-10-05:

1. **Setting `answerWho`** (`vendedor/settings.ts`): `known_and_new` (default: known customers
   and clear strangers), `known_only`, `everyone`. The legacy `unknownNumbers: 'all'` reads as
   `everyone`, anything else as `known_and_new`.
2. **The signals, in order**, for a WhatsApp thread of class `unknown` (`vendedor/triage.ts`):
   1. the phone has an order → `shopper` (`orders`/`ordered_before`);
   2. `everyone` → `shopper`, unless the message reads as a non-shopper's → `other`;
   3. `known_only` → `ask`: the owner decides;
   4. `known_and_new` → `checking`: the gateway fetches **that chat's latest 10 messages, on
      demand, only then** (`store_wa_history_requests`), and a fast model judges them, labelled
      `dono`/`contato` and framed as data, never instructions. Its only output is
      `{"verdict":"personal"|"customer"|"unsure"}`. The model also gets the store's name and
      what it sells (its category names) and the situation (`historico`, `sem_historico`,
      `historico_indisponivel`), and is told the cues: a customer introduces themselves as one
      or talks about the store's business; someone personal picks up an earlier conversation as
      if there were shared context, writes in an intimate or family tone, or talks about
      something unrelated to the store without asking about it; a bare greeting decides nothing.
      With history: personal → `personal`; customer → `shopper`; unsure or unreadable → `ask`.
      No prior chat: the message is still read — a stranger is `shopper` (even a bare "oi"), but
      one that reads like a friend goes to `ask`, since a customer who cleared the chat can read
      the same. When the fetch fails, the new message alone decides, mapped like history. With
      no model route or a model error, the thread goes to `ask` (no prior chat: `shopper`).
3. **Messages wait as `held`** while a thread is `checking` or `ask`. A `shopper` verdict sends
   them back to the ingest, which dispatches them as always (allowance, floors, handoff). A
   `personal` verdict skips them. The verdict is applied in one transaction that re-checks the
   thread is still `checking`: the owner wins a race.
4. **Silent to the contact, visible to the owner.** `ask` threads push "é cliente?" at most once
   per thread per 24 h (`asked_at`, `pushAsk`). Personal ones never push.
5. **Owner decisions are sticky.** The admin's `POST /vendedor/threads/:id/classify`, and phone
   commands typed in any chat: `#pessoal`, `#cliente`, `#dua`. The gateway stores each as a
   `command` message and revokes it for everyone. A command is never a takeover, and Duá never
   learns from it.

## Privacy

- The fetched messages exist only to reach a verdict. Core nulls `messages` in the transaction
  that applies it, and a sweeper nulls any fetched text older than 10 minutes, verdict or not.
- Threads store only codes (`class_source`, `class_reason`), never model text or a summary of
  the person. Nothing is bulk-read: no contact lists, no chat lists, only the one chat that just
  wrote, once.
- The model sees the profile name and the messages, never the phone number. It runs through the
  zero-data-retention gateway like every other model call (ADR 0031 decision 8).

## Consequences and known risks

- WhatsApp's on-demand history (`fetchMessageHistory`) answers through the owner's phone. It
  needs the phone online, and it may return nothing for a brand-new chat or a chat the phone
  hasn't synced. A request with no answer after 60 s fails as `timeout`, and the model judges
  the message alone. Without a model, the owner decides. A real stranger may wait for the
  owner more often than we'd like, and pilot stores will tell us how often.
- A friend's first message waits up to about a minute before Duá's verdict, and a
  customer's first answer waits the same.
- The model can misjudge. Its errors land on `ask` or a sticky owner override, never on a reply
  to a friend that the owner can't stop: `#pessoal` works from the phone.
- `everyone` keeps today's behaviour for numbers used only by the store.
