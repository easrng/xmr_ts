import * as asn1js from "npm:asn1js@3.0.6";
import { decodeHex, encodeHex } from "jsr:@std/encoding/hex";

function createCMSECDSASignature(signatureBuffer: ArrayBuffer): ArrayBuffer {
  const length = signatureBuffer.byteLength / 2;
  const rBuffer = new ArrayBuffer(length);
  const rView = new Uint8Array(rBuffer);
  void rView.set(new Uint8Array(signatureBuffer, 0, length));
  const rInteger = new asn1js.Integer({ valueHex: rBuffer });
  const sBuffer = new ArrayBuffer(length);
  const sView = new Uint8Array(sBuffer);
  void sView.set(new Uint8Array(signatureBuffer, length, length));
  const sInteger = new asn1js.Integer({ valueHex: sBuffer });
  return (new asn1js.Sequence({
    value: [
      rInteger.convertToDER(),
      sInteger.convertToDER(),
    ],
  })).toBER(false);
}
function nLength(
  n: bigint,
  nBitLength?: number,
): {
  nBitLength: number;
  nByteLength: number;
} {
  // Bit size, byte size of CURVE.n
  const _nBitLength = nBitLength !== undefined
    ? nBitLength
    : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function bytesToNumberBE(bytes: Uint8Array): bigint {
  return BigInt("0x" + encodeHex(bytes));
}
function mod(a: bigint, b: bigint): bigint {
  const result = a % b;
  return result >= 0n ? result : b + result;
}
function hashToPrivateScalar(
  hash: Uint8Array,
  groupOrder: bigint,
): bigint {
  const hashLen = hash.length;
  const minLen = nLength(groupOrder).nByteLength + 8;
  if (minLen < 24 || hashLen < minLen || hashLen > 1024) {
    throw new Error(
      "hashToPrivateScalar: expected " + minLen + "-1024 bytes of input, got " +
        hashLen,
    );
  }
  const num = bytesToNumberBE(hash);
  return mod(num, groupOrder - 1n) + 1n;
}
export async function createCert(offset = 0): Promise<{
  cert: ArrayBuffer;
  key: ArrayBuffer;
  notAfter: number;
}> {
  const TWO_WEEKS = 1000 * 60 * 60 * 24 * 14;
  const notBefore = (Math.floor(Date.now() / TWO_WEEKS) + offset) * TWO_WEEKS;
  const notAfter = notBefore + TWO_WEEKS;
  const jwk = await crypto.subtle.exportKey(
    "jwk",
    await crypto.subtle.importKey(
      "pkcs8",
      new asn1js.Sequence({
        value: [
          new asn1js.Integer({
            value: 0,
          }),
          new asn1js.Sequence({
            value: [
              new asn1js.ObjectIdentifier({
                value: "1.2.840.10045.2.1",
              }),
              new asn1js.ObjectIdentifier({
                value: "1.2.840.10045.3.1.7",
              }),
            ],
          }),
          new asn1js.OctetString({
            valueHex: new asn1js.Sequence({
              value: [
                new asn1js.Integer({ value: 1 }),
                new asn1js.OctetString({
                  valueHex: decodeHex(
                    hashToPrivateScalar(
                      new Uint8Array(
                        await crypto.subtle.digest(
                          "SHA-512",
                          new TextEncoder().encode("dummykey@" + notBefore),
                        ),
                        0,
                        48,
                      ),
                      0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
                    ).toString(16).padStart(64, "0"),
                  ),
                }),
              ],
            }).toBER(),
          }),
        ],
      }).toBER(),
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["sign"],
    ),
  );
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    {
      ...jwk,
      d: undefined,
      key_ops: ["verify"],
    },
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["verify"],
  );
  const issuer = new asn1js.Sequence({
    value: [
      new asn1js.Set({
        value: [],
      }),
    ],
  });
  const tbs = new asn1js.Sequence({
    value: [
      new asn1js.Constructed({
        optional: true,
        idBlock: {
          tagClass: 3,
          tagNumber: 0,
        },
        value: [
          new asn1js.Integer({ value: 2 }),
        ],
      }),
      new asn1js.Integer({ value: 1 }),
      new asn1js.Sequence({
        value: [
          new asn1js.ObjectIdentifier({
            value: "1.2.840.10045.4.3.2",
          }),
        ],
      }),
      issuer,
      new asn1js.Sequence({
        value: [
          new asn1js.UTCTime({ valueDate: new Date(notBefore) }),
          new asn1js.UTCTime({ valueDate: new Date(notAfter) }),
        ],
      }),
      issuer,
      asn1js.fromBER(await crypto.subtle.exportKey("spki", publicKey))
        .result,
    ],
  });
  const signature = createCMSECDSASignature(
    await crypto.subtle.sign(
      {
        hash: "SHA-256",
        name: "ECDSA",
      },
      privateKey,
      tbs.toBER(),
    ),
  );
  return {
    cert: new asn1js.Sequence({
      value: [
        tbs,
        new asn1js.Sequence({
          value: [
            new asn1js.ObjectIdentifier({
              value: "1.2.840.10045.4.3.2",
            }),
          ],
        }),
        new asn1js.BitString({ valueHex: signature }),
      ],
    }).toBER(),
    key: await crypto.subtle.exportKey("pkcs8", privateKey),
    notAfter,
  };
}
