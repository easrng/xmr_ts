import ipaddr from "npm:ipaddr.js@2";

export const reservedv4 = [
  "127.0.0.1/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "233.252.0.0/24",
  "255.255.255.255/32",
].map((cidr) => ipaddr.parseCIDR(cidr));

export const reservedv6 = [
  "::/128",
  "::1/128",
  "::ffff:0:0/96",
  "::ffff:0:0:0/96",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
  "100::/64",
  "2001::/32",
  "2001:20::/28",
  "2001:db8::/32",
  "2002::/16",
  "3fff::/20",
  "5f00::/16",
  "fc00::/7",
  "fe80::/64",
  "ff00::/8",
].map((cidr) => ipaddr.parseCIDR(cidr));

export function publicIPs() {
  const publicIPv4: ipaddr.IPv4[] = [];
  const publicIPv6: ipaddr.IPv6[] = [];
  iface: for (const iface of Deno.networkInterfaces()) {
    const parsed = ipaddr.parse(iface.address);
    for (const range of iface.family === "IPv4" ? reservedv4 : reservedv6) {
      if (parsed.match(range)) continue iface;
    }
    if (parsed instanceof ipaddr.IPv4) {
      void publicIPv4.push(parsed);
    } else {
      void publicIPv6.push(parsed);
    }
  }
  return { publicIPv4, publicIPv6 };
}
