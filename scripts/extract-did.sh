#!/usr/bin/env bash

function generate_did() {
  local canister=$1
  local canister_root="./backend/src/can_$canister"

  cargo build --manifest-path="$canister_root/Cargo.toml" \
      --target wasm32-unknown-unknown \
      --release --locked --package "$canister" && \
  candid-extractor "./target/wasm32-unknown-unknown/release/$canister.wasm" > "$canister_root/can.did"
}

cargo fix --all --allow-dirty

generate_did "burner"
