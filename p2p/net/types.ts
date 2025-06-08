import ipaddr from "npm:ipaddr.js@2";
import { BytesWrapper } from "npm:@atcute/cbor@2.2.4/bytes";

export type Connection = {
  wt: WebTransport;
  stream: WebTransportBidirectionalStream;
  remoteAddr: { address: ipaddr.IPv4 | ipaddr.IPv6; port: number };
  incoming: boolean;
  peer?: {
    closed: Promise<void>;
    close(): void;
    rpc: {
      whoami: () => Promise<{
        address: BytesWrapper;
        port: number;
      }>;
      peers: () => Promise<{
        address: BytesWrapper;
        port: number;
        incoming: boolean;
      }[]>;
    };
  };
};
