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
file_name="./frontend/app/.env.$mode"

if ! [ -f $file_name ]; then
  echo "Env file for $mode does not exist."
fi

cd ./frontend && pnpm run build --mode=$mode && cd .. && dfx deploy --network=$network frontend
