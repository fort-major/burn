#!/usr/bin/env bash

if [[ -z "$1" ]]; then
    echo "Must provide network name (dev OR ic)" 1>&2
    exit 1
fi

mode=$1
if [ $mode = "dev" ]; then 
    network="local" 
else 
    network=$mode
fi
file_name="./backend/.env.$mode"

source $file_name

dfx build --check dispenser
dispenser_wasm_path="./target/wasm32-unknown-unknown/release/dispenser.wasm"

# adapted this line from the Internet Identity - https://github.com/dfinity/internet-identity/blob/6c80aa0e30162d1aa09fb7348cbd6e4469cd1836/scripts/deploy-archive#L96
dfx canister --network=$network call "$CAN_FURNACE_CANISTER_ID" update_dispenser_wasm --argument-file <(echo "(blob \"$(hexdump -ve '1/1 "%.2x"' "$dispenser_wasm_path" | sed 's/../\\&/g')\")")

dfx canister --network=$network call "$CAN_FURNACE_CANISTER_ID" upgrade_dispensers