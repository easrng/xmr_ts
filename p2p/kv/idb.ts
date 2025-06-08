import { KV, Types } from "./types.ts";
import { decode, encode } from "npm:@atcute/cbor@2";
import { type IDBPDatabase, openDB } from "npm:idb@8";
import type {} from "npm:@types/web";

export default class IdbKV implements KV {
  #dbPromise: Promise<IDBPDatabase>;
  constructor() {
    this.#dbPromise = openDB("xmr_ts", 1, {
      upgrade(db): void {
        void db.createObjectStore("kv");
      },
    });
  }
  async get<K extends keyof Types>(key: K): Promise<Types[K] | undefined> {
    const result = await (await this.#dbPromise).get("kv", key);
    return result === undefined ? undefined : decode(result);
  }
  async set<K extends keyof Types>(key: K, value: Types[K]): Promise<void> {
    await (await this.#dbPromise).put("kv", encode(value), key);
  }
  async delete<K extends keyof Types>(key: K): Promise<void> {
    await (await this.#dbPromise).delete("kv", key);
  }
  async clear(): Promise<void> {
    await (await this.#dbPromise).clear("kv");
    await Promise.resolve();
  }
  async *entries<K extends keyof Types>(
    prefix?: K,
  ): AsyncIteratorObject<[K, Types[K]]> {
    const store = (await this.#dbPromise).transaction("kv", "readonly")
      .objectStore("kv");
    for await (
      const o of store.iterate(
        prefix
          ? IDBKeyRange.bound(
            prefix,
            prefix.slice(0, -1) +
              String.fromCodePoint(prefix!.at(-1)!.charCodeAt(0)! + 1),
            false,
            true,
          )
          : null,
      )
    ) {
      yield [o.key as K, decode(o.value)];
    }
    return;
  }
}
