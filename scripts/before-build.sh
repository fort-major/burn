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

# check if canisters are created

dfx canister --network=$network create burner && \
dfx canister --network=$network create furnace && \
dfx canister --network=$network create burn_token && \
dfx canister --network=$network create trading && \
dfx canister --network=$network create trading_invites && \
dfx canister --network=$network create internet_identity

# put env vars into backend

file_backend="./backend/.env.$mode"
rm -f $file_backend
touch $file_backend

echo "CAN_BURNER_CANISTER_ID=\"$(dfx canister --network=$network id burner)\"" >> $file_backend
echo "CAN_FURNACE_CANISTER_ID=\"$(dfx canister --network=$network id furnace)\"" >> $file_backend
echo "CAN_BURN_TOKEN_CANISTER_ID=\"$(dfx canister --network=$network id burn_token)\"" >> $file_backend
echo "CAN_TRADING_CANISTER_ID=\"$(dfx canister --network=$network id trading)\"" >> $file_backend
echo "CAN_TRADING_INVITES_CANISTER_ID=\"$(dfx canister --network=$network id trading_invites)\"" >> $file_backend
echo "CAN_II_CANISTER_ID=\"$(dfx canister --network=$network id internet_identity)\"" >> $file_backend
echo "CAN_ROOT_KEY=\"$(dfx ping $network | grep -oP '(?<="root_key": )\[.*\]')\"" >> $file_backend
echo "CAN_MODE=\"$mode\"" >> $file_backend
if [ $mode = dev ]; then
    echo "CAN_IC_HOST=\"http://localhost:$(dfx info webserver-port)\"" >> $file_backend
else
    echo "CAN_IC_HOST=\"https://icp-api.io\"" >> $file_backend
fi

mkdir -p /tmp/msq-burn

sed "1 c const MODE: &str = \"$mode\";" ./backend/src/shared/build.rs >> /tmp/msq-burn/build.rs
mv /tmp/msq-burn/build.rs ./backend/src/shared/build.rs

cargo build --target wasm32-unknown-unknown --package shared

# pub env vars into frontend

file_frontend="./frontend/.env.$mode"
rm -f $file_frontend
touch $file_frontend

echo "VITE_BURNER_CANISTER_ID=\"$(dfx canister --network=$network id burner)\"" >> $file_frontend
echo "VITE_FURNACE_CANISTER_ID=\"$(dfx canister --network=$network id furnace)\"" >> $file_frontend
echo "VITE_BURN_TOKEN_CANISTER_ID=\"$(dfx canister --network=$network id burn_token)\"" >> $file_frontend
echo "VITE_TRADING_CANISTER_ID=\"$(dfx canister --network=$network id trading)\"" >> $file_frontend
echo "VITE_TRADING_INVITES_CANISTER_ID=\"$(dfx canister --network=$network id trading_invites)\"" >> $file_frontend
echo "VITE_II_CANISTER_ID=\"$(dfx canister --network=$network id internet_identity)\"" >> $file_frontend
echo "VITE_ROOT_KEY=\"$(dfx ping $network | grep -oP '(?<="root_key": )\[.*\]')\"" >> $file_frontend

if [ $mode = dev ]; then
    echo "VITE_IC_HOST=\"http://localhost:$(dfx info webserver-port)\"" >> $file_frontend
else
    echo "VITE_IC_HOST=\"https://icp-api.io\"" >> $file_frontend
fi
