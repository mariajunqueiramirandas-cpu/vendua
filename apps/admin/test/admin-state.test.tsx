/// <reference types="bun" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PaySheet } from '../src/features/pdv/PaySheet.tsx';
import { useTicket, type PickedLine, type Ticket } from '../src/features/pdv/data.ts';
import { api, type PdvPaymentIn, type Session } from '../src/lib/api.ts';
import { qk } from '../src/lib/query.ts';
import { resetLive, useLiveState, useLiveStream } from '../src/lib/live.ts';
import { SessionCtx } from '../src/lib/session.ts';
import { platform } from '../src/platform/index.ts';

let root: Root | undefined;
let box: HTMLDivElement;
async function render(child: ReactNode) {
  if (!root) {
    box = document.createElement('div');
    document.body.append(box);
    root = createRoot(box);
  }
  await act(async () => root?.render(child));
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  box?.remove();
  localStorage.clear();
  resetLive();
});

const line = (name: string): PickedLine => ({
  key: name,
  productId: name,
  name,
  qty: 1,
  modifiers: [],
  combo: [],
  note: '',
});

test('a ticket storage key change loads its own draft and ignores old callbacks', async () => {
  localStorage.setItem('counter-a', JSON.stringify([line('A')]));
  localStorage.setItem('table-b', JSON.stringify([line('B')]));
  let ticket!: Ticket;
  function Probe({ storage }: { storage: string }) {
    ticket = useTicket(storage);
    return <div>{ticket.lines.map((l) => l.name).join(',')}</div>;
  }
  await render(<Probe storage="counter-a" />);
  expect(box.textContent).toBe('A');
  const clearA = ticket.clear;
  await render(<Probe storage="table-b" />);
  act(clearA);
  expect(box.textContent).toBe('B');
  expect(JSON.parse(localStorage.getItem('table-b')!)).toEqual([line('B')]);
  await render(<Probe storage="empty" />);
  expect(box.textContent).toBe('');
  expect(localStorage.getItem('empty')).toBeNull();
  expect(JSON.parse(localStorage.getItem('counter-a')!)).toEqual([line('A')]);
});

test('resetLive clears order alerts and disconnects the live stream', async () => {
  let stream!: Parameters<typeof platform.stream>[1];
  let disconnects = 0;
  const connect = spyOn(platform, 'stream').mockImplementation((_, handlers) => {
    stream = handlers;
    return () => {
      disconnects++;
    };
  });
  const order = spyOn(api, 'order').mockRejectedValue(new Error('offline'));
  function Probe() {
    useLiveStream(true);
    const { streaming, unseen, presence } = useLiveState();
    return <div>{JSON.stringify({ streaming, unseen, presence })}</div>;
  }
  try {
    await render(<Probe />);
    await act(async () => {
      stream.event('hello', '{}');
      stream.event('presence', '{"viewers":2,"carts":1}');
      stream.event('change', '{"topic":"order.placed","id":"example"}');
    });
    expect(box.textContent).toContain('"unseen":["example"]');
    act(resetLive);
    expect(JSON.parse(box.textContent!)).toEqual({ streaming: false, unseen: [], presence: null });
    expect(disconnects).toBe(1);
    act(() => stream.event('hello', '{}'));
    expect(JSON.parse(box.textContent!).streaming).toBe(false);
  } finally {
    connect.mockRestore();
    order.mockRestore();
  }
});

function paySheet(totalCents: number, onSubmit: (p: PdvPaymentIn[]) => void, caixaOpen = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.pdvPix(totalCents), { copyPaste: null });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SessionCtx.Provider value={{ user: { role: 'manager' } } as Session}>
          <PaySheet
            open
            title="Receber"
            onOpenChange={() => {}}
            totalCents={totalCents}
            caixaOpen={caixaOpen}
            busy={false}
            onSubmit={onSubmit}
          />
        </SessionCtx.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function click(text: string) {
  const hit = Array.from(document.querySelectorAll('button')).find((btn) =>
    btn.textContent?.trim().includes(text),
  );
  expect(hit).toBeDefined();
  act(() => hit!.click());
}

test('the PDV submits a courtesy sale with an empty payment list', async () => {
  const values: PdvPaymentIn[][] = [];
  await render(paySheet(0, (p) => values.push(p), false));
  click('confirmar cortesia');
  expect(values).toEqual([[]]);
});

test('turning off split keeps one payment for the full amount', async () => {
  const values: PdvPaymentIn[][] = [];
  await render(paySheet(2000, (p) => values.push(p)));
  click('Pix');
  click('dividir em formas');
  click('Dinheiro');
  click('uma forma só');
  click('confirmar');
  expect(values).toEqual([[{ method: 'pix', amountCents: 2000 }]]);
});
