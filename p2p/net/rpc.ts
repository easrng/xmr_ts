import { decode, encode } from "npm:@atcute/cbor@2";
import { concat } from "npm:@atcute/uint8array@1";

async function readInto(
  reader: ReadableStreamBYOBReader,
  buffer: ArrayBuffer,
  wants: number,
): Promise<ArrayBuffer> {
  let read = 0;
  while (read < wants) {
    const result = await reader.read(
      new Uint8Array(buffer, read, wants - read),
    );
    if (result.done) throw new Error("unexpected eof");
    buffer = result.value.buffer;
    read += result.value.byteLength;
  }
  return buffer;
}
type RPCRequest = { method: string; params: unknown[]; id: number };
type RPCNotification = { method: string; params: unknown[] };
type RPCResult = { result: unknown; id: number };
type RPCError = {
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
  id?: number;
};
type RPCMessage = RPCRequest | RPCNotification | RPCResult | RPCError;
async function send(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  value: RPCMessage,
): Promise<void> {
  const encoded = encode(value);
  const len = new ArrayBuffer(4);
  void new DataView(len).setUint32(0, encoded.byteLength, true);
  await writer.write(concat([new Uint8Array(len), encoded]));
}
const hasOwn = Object.hasOwn as <O extends object, K extends PropertyKey>(
  o: O,
  k: K,
) => o is O & Record<K, unknown>;
const PARSE_ERROR = { code: -32700, message: "Parse Error" };
const INVALID_REQUEST = { code: -32600, message: "Invalid Request" };
export function rpc<
  T extends Record<
    string,
    (..._: unknown[]) => unknown
  >,
>(
  stream: WebTransportBidirectionalStream,
  rpcHandlers: T,
): {
  closed: Promise<void>;
  close(): void;
  rpc: {
    [K in keyof T]: (
      ..._: Parameters<T[K]>
    ) => Promise<Awaited<ReturnType<T[K]>>>;
  };
} {
  const reader = stream.readable.getReader({ mode: "byob" });
  const writer = stream.writable.getWriter();
  let buffer = new ArrayBuffer(1 << 16);
  const abortController = new AbortController();
  const callbacks = new Map<
    number,
    { resolve: (_: unknown) => void; reject: (_: unknown) => void }
  >();
  void abortController.signal.addEventListener("abort", async () => {
    try {
      await Promise.all([writer.close(), reader.cancel()]);
    } catch {
      // ignore
    }
    const error = new DOMException("Aborted", "AbortError");
    for (const { reject } of callbacks.values()) {
      void reject(error);
    }
    void callbacks.clear();
  });
  let protocolErrors = 0;
  const protocolError = async (error: RPCError["error"]) => {
    if (protocolErrors++ > 5) {
      void abortController.abort();
    } else {
      await send(writer, {
        error,
      });
    }
  };
  const closedPromise: Promise<void> = Promise.all([
    reader.closed.finally(() => abortController.abort()),
    writer.closed.finally(() => abortController.abort()),
    (async () => {
      try {
        while (!abortController.signal.aborted) {
          buffer = await readInto(reader, buffer, 4);
          const toRead = new DataView(buffer).getUint32(0, true);
          if (toRead > buffer.byteLength) buffer = new ArrayBuffer(toRead);
          buffer = await readInto(reader, buffer, toRead);
          let message: unknown;
          try {
            message = decode(new Uint8Array(buffer, 0, toRead));
          } catch {
            await protocolError(PARSE_ERROR);
            continue;
          }
          if (typeof message !== "object" || message === null) {
            await protocolError(INVALID_REQUEST);
            continue;
          }
          if (hasOwn(message, "error")) {
            if (
              !hasOwn(message, "id") ||
              (message.id as number | 0) !== message.id
            ) {
              throw new Error(
                "peer reported rpc protocol error" +
                  (typeof message.error === "object" &&
                      message.error !== null && hasOwn(message.error, "code") &&
                      hasOwn(message.error, "message")
                    ? " " + message.error.code + ": " + message.error.message
                    : ""),
              );
            }
            if (
              hasOwn(message, "result") ||
              hasOwn(message, "method")
            ) {
              await protocolError(INVALID_REQUEST);
              continue;
            }
            callbacks.get(message.id)?.reject(message.error);
          } else if (hasOwn(message, "result")) {
            if (
              hasOwn(message, "error") ||
              hasOwn(message, "method") ||
              !hasOwn(message, "id") ||
              (message.id as number | 0) !== message.id
            ) {
              await protocolError(INVALID_REQUEST);
              continue;
            }
            callbacks.get(message.id)?.resolve(message.result);
          } else if (hasOwn(message, "method")) {
            if (
              hasOwn(message, "error") ||
              hasOwn(message, "result") ||
              typeof message.method !== "string" ||
              !hasOwn(message, "params")
            ) {
              await protocolError(INVALID_REQUEST);
              continue;
            }
            if (!hasOwn(rpcHandlers, message.method)) {
              if (
                hasOwn(message, "id") &&
                typeof message.id === "number"
              ) {
                await send(writer, {
                  error: {
                    code: -32601,
                    message: "Method Not Found",
                  },
                  id: message.id,
                });
              }
              continue;
            }
            const { method, params } = message;
            let promise = Promise.resolve().then(() =>
              rpcHandlers[method](params)
            );
            if (hasOwn(message, "id")) {
              const { id } = message;
              if (typeof id !== "number") {
                await protocolError(INVALID_REQUEST);
                continue;
              }
              promise = promise.then(
                (result) => send(writer, { id: id, result }),
                (error: unknown) =>
                  send(writer, {
                    id: id,
                    error: {
                      code: -32000,
                      message: Error.isError(error)
                        ? error.message
                        : String(error),
                    },
                  }),
              );
            }
            void promise.catch(() => {});
          }
        }
      } catch (e) {
        if (!abortController.signal.aborted) {
          void abortController.abort();
          throw e;
        }
      }
    })(),
  ]).then(() => {});
  let idCount = 0;
  async function rpcCall(this: string, ...params: unknown[]): Promise<unknown> {
    const id = idCount++;
    const promise = Promise.withResolvers();
    void callbacks.set(id, promise);
    await send(writer, {
      method: this,
      params,
      id,
    });
    return promise.promise;
  }
  return {
    closed: closedPromise,
    close: () => {
      void abortController.abort();
    },
    rpc: new Proxy({}, {
      get(_, k): unknown {
        if (typeof k !== "string") return;
        return rpcCall.bind(k);
      },
      // deno-lint-ignore no-explicit-any
    }) as any,
  };
}
