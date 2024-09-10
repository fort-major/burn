#!/usr/bin/env bash

rm -rf ./frontend/src/declarations && \
dfx generate burner && \
mv ./src/declarations ./frontend/src/declarations && \
rm ./frontend/src/declarations/burner/burner.did && \
rm -rf ./src
