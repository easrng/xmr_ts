import { BytesWrapper } from "npm:@atcute/cbor@2.2.4";

export enum PeerState {
  unchecked,
  alive,
  dead,
}

export interface Types {
  listenPort: number;
  [peer: `peer-${string}`]: {
    address: BytesWrapper;
    port: number;
    state: PeerState;
  };
}
export interface KV {
  get<K extends keyof Types>(k: K): Promise<Types[K] | undefined>;
  set<K extends keyof Types>(k: K, v: Types[K]): Promise<void>;
  delete<K extends keyof Types>(k: K): Promise<void>;
  clear(): Promise<void>;
  entries<K extends keyof Types>(
    prefix?: K,
  ): AsyncIteratorObject<[K, Types[K]]>;
}
