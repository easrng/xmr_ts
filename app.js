import init, { timestamp, verify } from "./pkg/xmr_ts.js";
import encodeQR from "./vendor/qr.js";
const initPromise = init();
document
  .getElementById("timestamp")
  .addEventListener("submit", async (event) => {
    try {
      document.getElementById("timestamp-err").textContent = "";
      document.getElementById("timestamp-result").style.display = "none";
      event.preventDefault();
      await initPromise;
      const hash = new Uint8Array(
        await crypto.subtle.digest(
          "sha-512",
          new TextEncoder().encode(
            document.getElementById("timestamp-data").value,
          ),
        ),
      );
      const address = timestamp(0, hash);
      document.getElementById("qr").src =
        `data:image/svg+xml,${encodeURIComponent(
          encodeQR(`monero:${address}?tx_amount=0.000000000001`, "svg"),
        )}`;
      document.getElementById("address").textContent = address;
      document.getElementById("timestamp-result").style.display = "flex";
    } catch (e) {
      console.error(e);
      document.getElementById("timestamp-err").textContent = e + "";
    }
  });
document.getElementById("verify").addEventListener("submit", async (event) => {
  try {
    document.getElementById("verify-result").textContent = "\nloading tx...";
    event.preventDefault();
    await initPromise;
    const tx = (
      await (
        await fetch(
          new URL("/gettransactions", document.getElementById("node").value),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              txs_hashes: [document.getElementById("txid").value],
            }),
          },
        )
      ).json()
    ).txs[0];
    const txBytes = Uint8Array.fromHex(tx.as_hex);
    const hash = new Uint8Array(
      await crypto.subtle.digest(
        "sha-512",
        new TextEncoder().encode(document.getElementById("verify-data").value),
      ),
    );
    verify(hash, txBytes);
    document.getElementById("verify-result").textContent =
      `\nverified!\nblock height: ${
        tx.block_height
      }\nblock timestamp: ${new Date(tx.block_timestamp * 1000).toISOString()}`;
  } catch (e) {
    console.error(e);
    document.getElementById("verify-result").textContent = "\n" + e;
  }
});
