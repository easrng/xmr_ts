import { KV } from "../kv/types.ts";
import { createCert } from "./cert.ts";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import NatAPI from "npm:@silentbot1/nat-api@0.4.8";
import { publicIPs, reservedv4 } from "./ips.ts";
import ipaddr from "npm:ipaddr.js@2";
import { Connection } from "./types.ts";

export function serve(
  db: KV,
  _connections: Map<string, unknown>,
): ReadableStream<Connection> {
  let cancelled = false;
  return new ReadableStream<Connection>({
    async start(controller) {
      let listenPort = await db.get("listenPort") ?? 3963;
      let server;
      try {
        server = new Deno.QuicEndpoint({
          port: listenPort,
        });
      } catch {
        server = new Deno.QuicEndpoint({
          port: 0,
        });
      }
      if (server.addr.port !== listenPort) {
        listenPort = server.addr.port;
        await db.set("listenPort", listenPort);
      }
      const { publicIPv4, publicIPv6 } = publicIPs();
      if (!publicIPv4.length) {
        const nat = new NatAPI();
        const ip = await nat.externalIp().catch(() => {});
        setupNat: if (ip) {
          const parsed = ipaddr.parse(ip);
          for (
            const range of reservedv4
          ) {
            if (parsed.match(range)) {
              // double nat, rip...
              break setupNat;
            }
          }
          if (parsed instanceof ipaddr.IPv4) {
            void publicIPv4.push(parsed);
          } else {
            // probably impossible, but not ruling it out
            void publicIPv6.push(parsed);
          }
          await nat.map(listenPort);
        }
      }
      void console.log(
        "listening on",
        [...publicIPv4, ...publicIPv6].join(", "),
        "port",
        listenPort,
      );
      while (true) {
        const cert = await createCert();
        const listener = server.listen({
          cert: `-----BEGIN CERTIFICATE-----\n${
            encodeBase64(cert.cert)
          }\n-----END CERTIFICATE-----`,
          key: `-----BEGIN PRIVATE KEY-----\n${
            encodeBase64(cert.key)
          }\n-----END PRIVATE KEY-----`,
          alpnProtocols: ["h3"],
        });
        for await (const conn of listener) {
          const wt = await Deno.upgradeWebTransport(conn);
          void (async () => {
            void wt.closed.catch(() => {});
            await wt.ready;
            const streams = wt.incomingBidirectionalStreams.getReader();
            const readResult = await streams.read();
            if (readResult.done) throw new Error("no stream sent");
            await streams.cancel();
            void controller.enqueue({
              wt,
              stream: readResult.value,
              remoteAddr: {
                address: ipaddr.parse(conn.remoteAddr.hostname),
                port: conn.remoteAddr.port,
              },
              incoming: true,
            });
          })().catch((err) => {
            const message = Error.isError(err) ? err.message : String(err);
            if (!/^(connection lost|timed out)$/.test(message)) {
              void console.error(message);
            }
          });
          if (cancelled) break;
          if (Date.now() > cert.notAfter) break;
        }
        void listener.stop();
        if (cancelled) break;
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}
