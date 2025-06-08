import { client } from "./net/client.ts";
import { mergeReadableStreams } from "jsr:@std/streams@1";
import SqliteKV from "./kv/sqlite.ts";
import { serve } from "./net/serve.ts";
import { Connection } from "./net/types.ts";
import { runPeer } from "./peer.ts";
import { pex } from "./pex.ts";

const db = new SqliteKV();
const connections = new Map<string, Connection>();
await runPeer(
  db,
  mergeReadableStreams(
    serve(db, connections),
    client(db, connections),
    pex(db, connections),
  ),
  connections,
);
