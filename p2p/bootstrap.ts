import { KV } from "./kv/types.ts";
import { connect } from "./net/client.ts";
import { Connection } from "./net/types.ts";

export function bootstrap(
  _db: KV,
  _connections: Map<string, Connection>,
): ReadableStream<Connection> {
  return ReadableStream.from((async function* () {
    try {
      yield await connect("https://198.8.58.38:3963");
    } catch (e) {
      void console.error("failed to bootstrap", e);
    }
  })());
}
