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

dfx deploy --network=$network burner --argument "()"

dfx deploy --network=$network burn_token --argument "(variant { Init = record { \
  token_symbol = \"BURN\"; \
  token_name = \"MSQ Cycle Burn\"; \
  minting_account = record { owner = principal \"$CAN_BURNER_CANISTER_ID\"  }; \
  transfer_fee = 10_000; \
  metadata = vec { record { \"icrc1:logo\"; variant { Text = \"data:image/png;base64,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\" } } }; \
  feature_flags = opt record { icrc2 = true }; \
  initial_balances = vec {}; \
  archive_options = record { \
    num_blocks_to_archive = 2000; \
    trigger_threshold = 1000; \
    controller_id = principal \"r7inp-6aaaa-aaaaa-aaabq-cai\" \
  }; \
}})"

dfx canister update-settings --network=$network burn_token --add-controller r7inp-6aaaa-aaaaa-aaabq-cai