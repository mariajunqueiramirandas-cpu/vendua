import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { requestLogger } from '../src/platform/http.ts';

const app = new Hono<{ Variables: { requestId: string } }>();
app.use('*', requestLogger());
app.get('/ping', (c) => c.json({ ok: true }));

describe('requestLogger', () => {
  test('generates x-request-id when absent', async () => {
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
    const id = res.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('echoes a provided x-request-id', async () => {
    const res = await app.request('/ping', { headers: { 'x-request-id': 'edge-abc-123' } });
    expect(res.headers.get('x-request-id')).toBe('edge-abc-123');
  });

  test('overlong x-request-id is replaced', async () => {
    const res = await app.request('/ping', { headers: { 'x-request-id': 'x'.repeat(200) } });
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
