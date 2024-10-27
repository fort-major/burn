#!/usr/bin/env bash

rm -rf ./frontend/src/declarations && \
dfx generate burner && \
dfx generate dispenser && \
dfx generate furnace && \
mv ./src/declarations ./frontend/src/declarations && \
rm ./frontend/src/declarations/burner/burner.did && \
rm ./frontend/src/declarations/dispenser/dispenser.did && \
rm ./frontend/src/declarations/furnace/furnace.did && \
rm -rf ./src
