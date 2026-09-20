import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { svixVerified } from '../src/agent/channels/email-inbound.ts';

const rawKey = Buffer.from('vendua-test-webhook-key-32bytes!!!');
const secret = `whsec_${rawKey.toString('base64')}`;
const body = JSON.stringify({ type: 'email.received', data: { email_id: 'e1' } });

function sign(id: string, ts: string): string {
  return `v1,${createHmac('sha256', rawKey).update(`${id}.${ts}.${body}`).digest('base64')}`;
}

describe('svixVerified', () => {
  test('valid signature passes', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(
      svixVerified(body, { id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts) }, secret),
    ).toBe(true);
  });

  test('wrong signature fails', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(
      svixVerified(
        body,
        { id: 'msg_1', timestamp: ts, signature: 'v1,bm90LXRoZS1zaWduYXR1cmU=' },
        secret,
      ),
    ).toBe(false);
  });

  test('stale timestamp fails', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 600);
    expect(
      svixVerified(body, { id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts) }, secret),
    ).toBe(false);
  });

  test('one valid signature among rotation candidates passes', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1,aGVsbG8= v2,ignored ${sign('msg_1', ts)}`;
    expect(svixVerified(body, { id: 'msg_1', timestamp: ts, signature: sig }, secret)).toBe(true);
  });

  test('body tampering fails', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign('msg_1', ts);
    expect(svixVerified(`${body} `, { id: 'msg_1', timestamp: ts, signature: sig }, secret)).toBe(
      false,
    );
  });
});
