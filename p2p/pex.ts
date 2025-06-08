import { KV, PeerState } from "./kv/types.ts";
import { connect } from "./net/client.ts";
import { Connection } from "./net/types.ts";
import { toHostString } from "./net/util.ts";
import ipaddr from "npm:ipaddr.js@2";

export function pex(
  db: KV,
  connections: Map<string, Connection>,
): ReadableStream<Connection> {
  let timeout: number;
  let cancelled = false;
  return new ReadableStream({
    start(controller) {
      const run = () => {
        try {
          for (const conn of connections.values()) {
            const peer = conn.peer;
            if (!peer) continue;
            void (async () => {
              const peers = await peer.rpc.peers();
              for (const peer of peers) {
                const url = `https://${
                  toHostString(ipaddr.fromByteArray(
                    (peer.address.buf satisfies ArrayLike<number>) as ArrayLike<
                      number
                    > as number[],
                  ))
                }:${peer.port}`;
                if (connections.has(url)) continue;
                void connect(
                  url,
                ).then(async (conn) => {
                  await db.set(`peer-${url}`, {
                    address: peer.address,
                    port: peer.port,
                    state: PeerState.alive,
                  });
                  void controller.enqueue(conn);
                }).catch((e) => {
                  void console.error(e);
                });
              }
            })().catch((e) => console.error(e));
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
