import ipaddr from "npm:ipaddr.js@2";

export const toHostString = (ip: ipaddr.IPv4 | ipaddr.IPv6) =>
  ip.kind() === "ipv4" ? ip.toString() : `[${ip.toString()}]`;
