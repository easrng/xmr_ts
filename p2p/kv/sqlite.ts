import { DatabaseSync, StatementSync } from "node:sqlite";
import { KV, Types } from "./types.ts";
import { decode, encode } from "npm:@atcute/cbor@2";
import { Adapt } from "jsr:@404wolf/xdg-portable@0.1.0";
import { join } from "jsr:@std/path@^1.0.8/join";

declare module "node:sqlite" {
  interface StatementSync {
    iterate(
      ...anonymousParameters: SupportedValueType[]
    ): IteratorObject<unknown>;
    iterate(
      namedParameters: Record<string, SupportedValueType>,
      ...anonymousParameters: SupportedValueType[]
    ): IteratorObject<unknown>;
  }
}

export default class SqliteKV implements KV {
  #get: StatementSync;
  #set: StatementSync;
  #delete: StatementSync;
  #clear: StatementSync;
  #entries: StatementSync;
  #entriesPrefixed: StatementSync;
  constructor() {
    const dataPath = join(Adapt().data(), "xmr_ts");
    void Deno.mkdirSync(dataPath, { recursive: true });
    const db = new DatabaseSync(join(dataPath, "/xmr_ts.db"));
    void db.exec(
      `PRAGMA journal_mode=wal; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value BLOB) STRICT;`,
    );
    this.#get = db.prepare(`SELECT value from kv WHERE key = :key`);
    this.#delete = db.prepare(`DELETE from kv WHERE key = :key`);
    this.#clear = db.prepare(`DELETE from kv`);
    this.#set = db.prepare(
      `INSERT INTO kv (key, value) VALUES (:key, :value) ON CONFLICT (key) DO UPDATE SET key = :key`,
    );
    this.#entries = db.prepare(
      `SELECT key, value from kv`,
    );
    this.#entriesPrefixed = db.prepare(
      `SELECT key, value from kv WHERE key >= :prefix AND key < :prefixEnd`,
    );
  }
  async get<K extends keyof Types>(key: K): Promise<Types[K] | undefined> {
    const result = this.#get.get({
      key,
    }) as (undefined | { value: Uint8Array });
    await Promise.resolve();
    return result === undefined ? undefined : decode(result.value);
  }
  async set<K extends keyof Types>(
    key: K,
    value: Types[K],
  ): Promise<void> {
    void this.#set.run({
      key,
      value: encode(value),
    });
    await Promise.resolve();
  }
  async delete<K extends keyof Types>(key: K): Promise<void> {
    void this.#delete.run({
      key,
    });
    await Promise.resolve();
  }
  async clear(): Promise<void> {
    void this.#clear.run();
    await Promise.resolve();
  }
  async *entries<K extends keyof Types>(
    prefix?: K,
  ): AsyncIteratorObject<[K, Types[K]]> {
    let query;
    if (prefix === undefined) {
      query = this.#entries.iterate();
    } else {
      const codepoints = [...prefix];
      query = this.#entriesPrefixed.iterate({
        prefix,
        prefixEnd: codepoints.slice(0, -1).join("") +
          String.fromCodePoint(codepoints.at(-1)!.codePointAt(0)! + 1),
      });
    }
    for (const o of query as Iterable<{ key: string; value: Uint8Array }>) {
      yield [o.key as K, decode(o.value)];
    }
    return;
  }
}
