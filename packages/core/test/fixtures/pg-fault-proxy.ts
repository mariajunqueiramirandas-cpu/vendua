import net from 'node:net';

/** One frontend message as the proxy saw it: its type byte and, for Query/Parse, its SQL. */
export interface ClientMessage {
  conn: number;
  type: string;
  text: string | null;
}

/**
 * What to do with a client message: pass it on, replace its SQL, or end the connection.
 * - `drop`: the message never reaches Postgres; both sides are torn down at once.
 * - `forwardThenDrop`: Postgres gets the message, then both sides are torn down at once — its
 *   next reply hits a dead socket, so it may stop before running what it already received.
 * - `forwardThenHangUp`: Postgres gets the message, then the end of the stream, and is left to
 *   run everything it received before it sees the client gone (its replies are discarded).
 */
export type Fault = 'forward' | 'drop' | 'forwardThenDrop' | 'forwardThenHangUp' | { sql: string };

/**
 * A TCP proxy in front of Postgres that reads the frontend protocol message by message, so a
 * test can fail or cut a connection at an exact statement. Without SSL (postgres.js sends the
 * StartupMessage first), backend bytes pass through untouched.
 */
export async function faultProxy(databaseUrl: string) {
  const target = new URL(databaseUrl);
  const log: ClientMessage[] = [];
  let rule: (m: ClientMessage) => Fault = () => 'forward';
  let conns = 0;
  const sockets = new Set<net.Socket>();

  const server = net.createServer((client) => {
    const conn = ++conns;
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on('error', () => undefined);
      s.on('close', () => sockets.delete(s));
    }
    let dead = false;
    let hungUp = false;
    let started = false;
    let buf = Buffer.alloc(0);
    upstream.on('data', (d: Buffer) => void (!dead && client.write(d)));
    upstream.on('close', () => client.destroy());
    client.on('close', () => hungUp || upstream.destroy());
    client.on('data', (d: Buffer) => {
      if (dead) return;
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (!started) {
          // StartupMessage: int32 length (itself included), no type byte
          if (buf.length < 4 || buf.length < buf.readInt32BE(0)) return;
          const len = buf.readInt32BE(0);
          upstream.write(buf.subarray(0, len));
          buf = buf.subarray(len);
          started = true;
          continue;
        }
        if (buf.length < 5 || buf.length < 1 + buf.readInt32BE(1)) return;
        const raw = buf.subarray(0, 1 + buf.readInt32BE(1));
        buf = buf.subarray(raw.length);
        const msg = { conn, type: String.fromCharCode(raw[0]!), text: sqlOf(raw) };
        log.push(msg);
        const fault = rule(msg);
        if (fault === 'forward') upstream.write(raw);
        else if (fault === 'forwardThenHangUp') {
          dead = hungUp = true;
          // FIN after the bytes, the socket left open: Postgres reads to the end, then sees EOF
          upstream.end(raw);
          client.destroy();
          return;
        } else if (fault === 'drop' || fault === 'forwardThenDrop') {
          dead = true;
          if (fault === 'forwardThenDrop') upstream.write(raw);
          upstream.destroy();
          client.destroy();
          return;
        } else upstream.write(withSql(raw, fault.sql));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  const url = new URL(databaseUrl);
  url.hostname = '127.0.0.1';
  url.port = String(port);

  return {
    url: url.toString(),
    log,
    /** connections the proxy has accepted so far */
    get connections() {
      return conns;
    },
    set rule(fn: (m: ClientMessage) => Fault) {
      rule = fn;
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

const cstring = (b: Buffer, at: number) => {
  const end = b.indexOf(0, at);
  return { text: b.toString('utf8', at, end), next: end + 1 };
};

/** the SQL of a Query ('Q') or Parse ('P') message */
function sqlOf(raw: Buffer): string | null {
  if (raw[0] === 0x51) return cstring(raw, 5).text;
  if (raw[0] === 0x50) return cstring(raw, cstring(raw, 5).next).text;
  return null;
}

/** the same Query/Parse message with other SQL (a Parse keeps its name and no parameter types) */
function withSql(raw: Buffer, sql: string): Buffer {
  const body =
    raw[0] === 0x51
      ? Buffer.concat([Buffer.from(sql), Buffer.from([0])])
      : Buffer.concat([
          raw.subarray(5, cstring(raw, 5).next),
          Buffer.from(sql),
          Buffer.from([0, 0, 0]),
        ]);
  const head = Buffer.alloc(5);
  head[0] = raw[0]!;
  head.writeInt32BE(4 + body.length, 1);
  return Buffer.concat([head, body]);
}
