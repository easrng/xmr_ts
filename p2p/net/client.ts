import { KV, PeerState } from "../kv/types.ts";
import { createCert } from "./cert.ts";
import { Connection } from "./types.ts";
import ipaddr from "npm:ipaddr.js@2";
import { toHostString } from "./util.ts";

export async function connect(url: string): Promise<Connection> {
  const opts = {
    allowPooling: false,
    serverCertificateHashes: await Promise.all(
      (await Promise.all([createCert(0), createCert(1), createCert(-1)])).map(
        async (cert) => ({
          algorithm: "sha-256",
          value: new Uint8Array(
            await crypto.subtle.digest("sha-256", cert.cert),
          ),
        }),
      ),
    ),
  };
  const desc = Object.getOwnPropertyDescriptor(URL.prototype, "hostname")!;
  let wt;
  try {
    void Object.defineProperty(URL.prototype, "hostname", {
      ...desc,
      get(): string {
        return desc.get!.call(this).replace(/^\[|\]$/g, "");
      },
    });
    wt = new WebTransport(url, opts);
  } finally {
    void Object.defineProperty(URL.prototype, "hostname", desc);
  }
  const parsed = new URL(url);
  void wt.closed.catch(() => {});
  const stream = await wt.createBidirectionalStream();
  return {
    wt,
    stream,
    remoteAddr: {
      address: ipaddr.parse(parsed.hostname.replace(/^\[|\]$/g, "")),
      port: +parsed.port,
    },
    incoming: false,
  };
}

export function client(
  db: KV,
  connections: Map<string, unknown>,
): ReadableStream<Connection> {
  let timeout: number;
  let cancelled = false;
  return new ReadableStream({
    start(controller) {
      const run = async () => {
        try {
          for await (const [id, val] of db.entries("peer-")) {
            if (cancelled) break;
            if (
              val.state === PeerState.unchecked ||
              val.state === PeerState.alive ||
              (val.state === PeerState.dead && Math.random() < 0.1)
            ) {
              const url = `https://${
                toHostString(ipaddr.fromByteArray(
                  (val.address.buf satisfies ArrayLike<number>) as ArrayLike<
                    number
                  > as number[],
                ))
              }:${val.port}`;
              if (connections.has(url)) continue;
              void connect(
                url,
              ).then(async (conn) => {
                if (val.state !== PeerState.alive) {
                  await db.set(id, { ...val, state: PeerState.alive });
                }
                void controller.enqueue(conn);
              }).catch(async (e) => {
                try {
                  if (val.state === PeerState.alive) {
                    await db.set(id, { ...val, state: PeerState.dead });
                  } else if (val.state === PeerState.unchecked) {
                    await db.delete(id);
                  }
                } catch (e2) {
                  e = new AggregateError([e, e2]);
                }
                void console.error(e);
              });
            }
          }
          if (!cancelled) {
            timeout = setTimeout(run, 10000);
          }
        } catch (e) {
          void console.error(e);
        }
      };
      void run();
    },
    cancel() {
      cancelled = true;
      void clearTimeout(timeout);
    },
  });
}
