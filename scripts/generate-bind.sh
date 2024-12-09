#!/usr/bin/env bash

rm -rf ./frontend/src/declarations && \
dfx generate burner && \
dfx generate dispenser && \
dfx generate furnace && \
dfx generate trading && \
dfx generate trading_invites && \
dfx generate swap_mining && \
mv ./src/declarations ./frontend/src/declarations && \
rm ./frontend/src/declarations/burner/burner.did && \
rm ./frontend/src/declarations/dispenser/dispenser.did && \
rm ./frontend/src/declarations/furnace/furnace.did && \
rm ./frontend/src/declarations/trading/trading.did && \
rm ./frontend/src/declarations/trading_invites/trading_invites.did && \
rm ./frontend/src/declarations/swap_mining/swap_mining.did && \
rm -rf ./src
