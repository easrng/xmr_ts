use clap::ArgMatches;
use clap::{Arg, ArgGroup, Command};
use curve25519_dalek::scalar::Scalar;
use miette::{IntoDiagnostic, MietteDiagnostic, Result, WrapErr};
use monero::network::Network;
use monero::util::address::Address;
use monero::util::key::PrivateKey;
use monero::util::key::PublicKey;
use monero::{Transaction, ViewPair};
use sha2::{Digest, Sha512};
use std::fs::File;
use std::io::BufReader;
use std::io::Read;

fn hash_file(filename: &String) -> Result<Sha512> {
    let file = File::open(filename)
        .into_diagnostic()
        .wrap_err("failed to open file")?;
    let mut reader = BufReader::new(file);
    let mut buffer = [0; 4096];
    let mut hasher = Sha512::new();

    loop {
        let bytes_read = reader
            .read(&mut buffer)
            .into_diagnostic()
            .wrap_err("failed to read file")?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    Ok(hasher)
}

fn hash_data(data: &String) -> Result<Sha512> {
    let mut hasher = Sha512::new();
    hasher.update(data);
    Ok(hasher)
}

fn should_never_happen() -> MietteDiagnostic {
    MietteDiagnostic::new("this should never happen")
}

fn hash_from_args(args: &ArgMatches) -> Result<Sha512> {
    args.get_one("data").map_or_else(
        || hash_file(args.get_one("file").ok_or(should_never_happen())?),
        hash_data,
    )
}

fn derive_address(hasher: Sha512) -> Result<(Address, ViewPair)> {
    let scalar = Scalar::from_hash(hasher);
    let private_view = PrivateKey::from_scalar(scalar);
    let public_view = PublicKey::from_private_key(&private_view);
    let public_spend = PublicKey::from_slice(&[0; 32])
        .into_diagnostic()
        .wrap_err("failed to derive public spend key")?;
    Ok((
        Address::standard(Network::Stagenet, public_spend, public_view),
        ViewPair {
            view: private_view,
            spend: public_spend,
        },
    ))
}

#[tokio::main]
async fn main() -> Result<()> {
    let matches = Command::new("xmr_ts")
        .about("timestamp data in the monero blockchain")
        .subcommand(
            Command::new("hash")
                .about(
                    "hash data and display the address to send to to save the timestamp on chain",
                )
                .arg(
                    Arg::new("data")
                        .short('d')
                        .long("data")
                        .value_name("data")
                        .help("data to hash")
                        .conflicts_with("file"),
                )
                .arg(
                    Arg::new("file")
                        .short('f')
                        .long("file")
                        .value_name("path")
                        .help("file to hash")
                        .conflicts_with("data"),
                )
                .group(
                    ArgGroup::new("data_group")
                        .args(["data", "file"])
                        .required(true),
                ),
        )
        .subcommand(
            Command::new("verify")
                .about("verify that data has a valid timestamp on chain")
                .arg(
                    Arg::new("data")
                        .short('d')
                        .long("data")
                        .value_name("data")
                        .help("data to hash")
                        .conflicts_with("file"),
                )
                .arg(
                    Arg::new("file")
                        .short('f')
                        .long("file")
                        .value_name("path")
                        .help("file to hash")
                        .conflicts_with("data"),
                )
                .group(
                    ArgGroup::new("data_group")
                        .args(["data", "file"])
                        .required(true),
                )
                .arg(
                    Arg::new("txid")
                        .short('t')
                        .long("txid")
                        .value_name("txid")
                        .help("transaction id to verify")
                        .required(true),
                )
                .arg(
                    Arg::new("node")
                        .short('n')
                        .long("node")
                        .value_name("node")
                        .help("monero node url")
                        .required(true),
                ),
        )
        .subcommand_required(true)
        .get_matches();
    match matches.subcommand() {
        Some(("hash", sub_matches)) => {
            let hasher = hash_from_args(sub_matches)?;
            let (address, _) = derive_address(hasher)?;
            println!(
                "send 0.000000000001 XMR to {} to save the timestamp on chain",
                address
            );
        }
        Some(("verify", sub_matches)) => {
            let hasher = hash_from_args(sub_matches)?;
            let (_, view_pair) = derive_address(hasher)?;
            let rpc_client = monero_rpc::RpcClientBuilder::new()
                .build(
                    sub_matches
                        .get_one::<String>("node")
                        .ok_or(should_never_happen())?,
                )
                .map_err(|err| MietteDiagnostic::new(err.to_string()))
                .wrap_err("failed to create rpc client")?;
            let daemon_rpc_client = rpc_client.daemon_rpc();
            let mut fixed_hash: [u8; 32] = [0; 32];
            hex::decode_to_slice(
                sub_matches
                    .get_one::<String>("txid")
                    .ok_or(should_never_happen())?,
                &mut fixed_hash,
            )
            .into_diagnostic()
            .wrap_err("transaction id is not hexadecimal")?;
            let txs_response = daemon_rpc_client
                .get_transactions(vec![fixed_hash.into()], Some(false), Some(false))
                .await
                .map_err(|err| MietteDiagnostic::new(err.to_string()))
                .wrap_err("failed to get transaction from remote node")?;
            let not_found = || MietteDiagnostic::new("transaction not found");
            let txs = txs_response.txs.ok_or(not_found())?;
            let rpc_tx = txs.get(0).ok_or(not_found())?;
            let block_height = rpc_tx
                .block_height
                .ok_or(MietteDiagnostic::new("transaction is still pending"))?;
            let tx_bytes = hex::decode(&rpc_tx.as_hex)
                .into_diagnostic()
                .wrap_err("remote node returned invalid hexadecimal transaction data")?;
            if tx_bytes.is_empty() {
                Err(MietteDiagnostic::new("empty transaction"))?
            }
            let tx = monero::consensus::deserialize::<Transaction>(&tx_bytes[..])
                .into_diagnostic()
                .wrap_err("failed to decode transaction")?;
            let outputs = tx
                .check_outputs(&view_pair, 0..1, 0..1)
                .into_diagnostic()
                .wrap_err("failed to check transaction for outputs")?;
            if outputs.is_empty() {
                Err(MietteDiagnostic::new(
                    "transaction does not include a timestamp for the data",
                ))?
            }
            println!("timestamp was added to the chain in block {}", block_height)
        }
        _ => unreachable!(),
    }
    Ok(())
}
