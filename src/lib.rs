use curve25519_dalek::scalar::Scalar;
use monero::network::Network;
use monero::util::address::Address;
use monero::util::key::PrivateKey;
use monero::util::key::PublicKey;
use monero::{Transaction, ViewPair};
use wasm_bindgen::prelude::*;

fn derive_keys(hash: &[u8]) -> Result<ViewPair, String> {
    let scalar = Scalar::from_bytes_mod_order_wide(
        hash.try_into()
            .map_err(|e: std::array::TryFromSliceError| e.to_string())?,
    );
    let private_view = PrivateKey::from_scalar(scalar);
    let public_view = PublicKey::from_private_key(&private_view);
    Ok(ViewPair {
        view: private_view,
        spend: public_view,
    })
}

#[wasm_bindgen]
pub fn timestamp(network: u8, hash: &[u8]) -> Result<String, String> {
    let view_pair = derive_keys(hash)?;
    Ok(Address::standard(
        match network {
            0 => Network::Mainnet,
            1 => Network::Stagenet,
            2 => Network::Testnet,
            _ => Err("invalid network")?,
        },
        view_pair.spend,
        view_pair.spend,
    )
    .to_string())
}

#[wasm_bindgen]
pub fn verify(hash: &[u8], tx_bytes: &[u8]) -> Result<(), String> {
    let view_pair = derive_keys(hash)?;
    let tx = monero::consensus::deserialize::<Transaction>(&tx_bytes)
        .map_err(|e| format!("failed to decode transaction: {:?}", e))?;
    let outputs = tx
        .check_outputs(&view_pair, 0..1, 0..1)
        .map_err(|e| format!("failed to check transaction for outputs: {:?}", e))?;
    if outputs.is_empty() {
        Err(("transaction is not a timestamp for the data").to_string())?
    }
    return Ok(());
}
