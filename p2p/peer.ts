import { BytesWrapper } from "npm:@atcute/cbor@2.2.4/bytes";
import { KV, PeerState } from "./kv/types.ts";
import { rpc } from "./net/rpc.ts";
import { toHostString } from "./net/util.ts";
import { Connection } from "./net/types.ts";

export async function runPeer(
  db: KV,
  connectionStream: ReadableStream<Connection>,
  connections: Map<string, Connection>,
) {
  for await (
    const conn of connectionStream
      .values()
  ) {
    void (async () => {
      const url = `https://${
        toHostString(conn.remoteAddr.address)
      }:${conn.remoteAddr.port}`;
      void console.log("got peer " + url);
      let addedToConnections = false;
      if (!connections.has(url)) {
        void connections.set(url, conn);
        addedToConnections = true;
      }
      if (conn.incoming) {
        await db.set(`peer-${url}`, {
          address: new BytesWrapper(
            new Uint8Array(conn.remoteAddr.address.toByteArray()),
          ),
          port: conn.remoteAddr.port,
          state: PeerState.unchecked,
        });
      }
      const peer = rpc(conn.stream, {
        whoami() {
          return {
            address: new BytesWrapper(
              new Uint8Array(conn.remoteAddr.address.toByteArray()),
            ),
            port: conn.remoteAddr.port,
          };
        },
        peers() {
          return connections.values().map((conn) => ({
            address: new BytesWrapper(
              new Uint8Array(conn.remoteAddr.address.toByteArray()),
            ),
            port: conn.remoteAddr.port,
            incoming: conn.incoming,
          })).toArray();
        },
      });
      void peer.closed.finally(() => {
        if (addedToConnections) {
          void connections.delete(url);
        }
        void conn.wt.close();
      }).catch((e) => console.error(e));
      conn.peer = peer;
      void console.log(await peer.rpc.whoami());
    })().catch((e) => console.error(e));
  }
}
