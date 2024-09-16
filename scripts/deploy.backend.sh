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

if [ $mode = dev ]; then
    dfx deploy --network=$network internet_identity 

    dfx deploy --network=$network burn_token --argument "(variant { Init = record { \
        token_symbol = \"BURN\"; \
        token_name = \"MSQ Cycle Burn\"; \
        minting_account = record { owner = principal \"$CAN_BURNER_CANISTER_ID\"  }; \
        transfer_fee = 10_000; \
        metadata = vec { record { \"icrc1:logo\"; variant { Text = \"data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAwIiBoZWlnaHQ9IjUwMCIgdmlld0JveD0iMCAwIDUwMCA1MDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI1MDAiIGhlaWdodD0iNTAwIiByeD0iMjUwIiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBkPSJNMTc0LjkwMSAxODguNTUzQzE3My4zOTYgMjA0LjYwOCAxNzIuMzQgMjMzLjAyMSAxODEuODIgMjQ1LjExNUMxODEuODIgMjQ1LjExNSAxNzcuMzU3IDIxMy45MDMgMjE3LjM2MyAxNzQuNzQyQzIzMy40NyAxNTguOTc4IDIzNy4xOTQgMTM3LjUzNiAyMzEuNTY5IDEyMS40NTRDMjI4LjM3NCAxMTIuMzQ0IDIyMi41MzggMTA0LjgxOCAyMTcuNDY4IDk5LjU2MzZDMjE0LjUxMSA5Ni40NzQxIDIxNi43ODIgOTEuMzc3NyAyMjEuMDg2IDkxLjU2MjVDMjQ3LjEyMiA5Mi43MjQ0IDI4OS4zMiA5OS45NTk3IDMwNy4yNDkgMTQ0Ljk1NkMzMTUuMTE4IDE2NC43MDggMzE1LjY5OSAxODUuMTIgMzExLjk1IDIwNS44NzVDMzA5LjU3MyAyMTkuMTMxIDMwMS4xMjMgMjQ4LjYgMzIwLjQgMjUyLjIxOEMzMzQuMTU3IDI1NC44MDYgMzQwLjgxMiAyNDMuODc0IDM0My43OTYgMjM2LjAwNUMzNDUuMDM3IDIzMi43MyAzNDkuMzQxIDIzMS45MTIgMzUxLjY2NSAyMzQuNTI2QzM3NC45MDIgMjYwLjk1OSAzNzYuODgzIDI5Mi4wOTIgMzcyLjA3NyAzMTguODk0QzM2Mi43ODIgMzcwLjcwMyAzMTAuMzEzIDQwOC40MTEgMjU4LjE4NyA0MDguNDExQzE5My4wNjkgNDA4LjQxMSAxNDEuMjMzIDM3MS4xNTIgMTI3Ljc5MyAzMDMuNzFDMTIyLjM3OSAyNzYuNDg1IDEyNS4xMjYgMjIyLjYxNyAxNjcuMTExIDE4NC41OTJDMTcwLjIyNyAxODEuNzQgMTc1LjMyNCAxODQuMjc1IDE3NC45MDEgMTg4LjU1M1oiIGZpbGw9InVybCgjcGFpbnQwX3JhZGlhbF84MTlfMjQ3OCkiLz4KPHBhdGggZD0iTTI4MS45NzkgMjg1LjQzN0MyNTcuOTc2IDI1NC41NDIgMjY4LjcyMyAyMTkuMjg5IDI3NC42MTEgMjA1LjI0MUMyNzUuNDA0IDIwMy4zOTMgMjczLjI5MSAyMDEuNjUgMjcxLjYyOCAyMDIuNzg2QzI2MS4zMDMgMjA5LjgxIDI0MC4xNTEgMjI2LjM0IDIzMC4zMDIgMjQ5LjYwNEMyMTYuOTY3IDI4MS4wNTQgMjE3LjkxNyAyOTYuNDQ5IDIyNS44MTMgMzE1LjI1QzIzMC41NjYgMzI2LjU3OCAyMjUuMDQ3IDMyOC45ODEgMjIyLjI3NCAzMjkuNDA0QzIxOS41ODEgMzI5LjgyNiAyMTcuMDk5IDMyOC4wMyAyMTUuMTE4IDMyNi4xNTZDMjA5LjQyMiAzMjAuNjg1IDIwNS4zNjIgMzEzLjczNiAyMDMuMzk0IDMwNi4wODdDMjAyLjk3MSAzMDQuNDUgMjAwLjgzMiAzMDQuMDAxIDE5OS44NTUgMzA1LjM0N0MxOTIuNDYyIDMxNS41NjcgMTg4LjYzMyAzMzEuOTY1IDE4OC40NDggMzQzLjU1N0MxODcuODY3IDM3OS4zOTEgMjE3LjQ2OCA0MDguNDM3IDI1My4yNzUgNDA4LjQzN0MyOTguNDAzIDQwOC40MzcgMzMxLjI3OSAzNTguNTMgMzA1LjM0OCAzMTYuODA4QzI5Ny44MjMgMzA0LjY2MSAyOTAuNzQ2IDI5Ni43MTMgMjgxLjk3OSAyODUuNDM3WiIgZmlsbD0idXJsKCNwYWludDFfcmFkaWFsXzgxOV8yNDc4KSIvPgo8ZGVmcz4KPHJhZGlhbEdyYWRpZW50IGlkPSJwYWludDBfcmFkaWFsXzgxOV8yNDc4IiBjeD0iMCIgY3k9IjAiIHI9IjEiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiBncmFkaWVudFRyYW5zZm9ybT0idHJhbnNsYXRlKDI0NS4yODkgNDA5LjIzMikgcm90YXRlKC0xNzkuNzUxKSBzY2FsZSgxODYuMzk2IDMwNS44MzgpIj4KPHN0b3Agb2Zmc2V0PSIwLjMwNSIgc3RvcC1jb2xvcj0iI0ZGQ0E0MyIvPgo8c3RvcCBvZmZzZXQ9IjAuNjgiIHN0b3AtY29sb3I9IiNGRTUxMjkiLz4KPHN0b3Agb2Zmc2V0PSIwLjk3MiIgc3RvcC1jb2xvcj0iI0ZDMkQyRCIvPgo8L3JhZGlhbEdyYWRpZW50Pgo8cmFkaWFsR3JhZGllbnQgaWQ9InBhaW50MV9yYWRpYWxfODE5XzI0NzgiIGN4PSIwIiBjeT0iMCIgcj0iMSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIGdyYWRpZW50VHJhbnNmb3JtPSJ0cmFuc2xhdGUoMjU1Ljc1NyAyMjMuNzQ4KSByb3RhdGUoOTAuNTc4Nykgc2NhbGUoMTk1LjAyNyAxNDYuNzczKSI+CjxzdG9wIG9mZnNldD0iMC4yMTQiIHN0b3AtY29sb3I9IiNGRkYxNzYiLz4KPHN0b3Agb2Zmc2V0PSIwLjMyOCIgc3RvcC1jb2xvcj0iI0ZGRjI3RCIvPgo8c3RvcCBvZmZzZXQ9IjAuNDg3IiBzdG9wLWNvbG9yPSIjRkZGNDhGIi8+CjxzdG9wIG9mZnNldD0iMC42NzIiIHN0b3AtY29sb3I9IiNGRkY3QUQiLz4KPHN0b3Agb2Zmc2V0PSIwLjc5MyIgc3RvcC1jb2xvcj0iI0ZGRjlDNCIvPgo8c3RvcCBvZmZzZXQ9IjAuODIyIiBzdG9wLWNvbG9yPSIjRkZGOEJEIiBzdG9wLW9wYWNpdHk9IjAuODA0Ii8+CjxzdG9wIG9mZnNldD0iMC44NjMiIHN0b3AtY29sb3I9IiNGRkY2QUIiIHN0b3Atb3BhY2l0eT0iMC41MjkiLz4KPHN0b3Agb2Zmc2V0PSIwLjkxIiBzdG9wLWNvbG9yPSIjRkZGMzhEIiBzdG9wLW9wYWNpdHk9IjAuMjA5Ii8+CjxzdG9wIG9mZnNldD0iMC45NDEiIHN0b3AtY29sb3I9IiNGRkYxNzYiIHN0b3Atb3BhY2l0eT0iMCIvPgo8L3JhZGlhbEdyYWRpZW50Pgo8L2RlZnM+Cjwvc3ZnPgo=\" } } }; \
        feature_flags = opt record { icrc2 = true }; \
        initial_balances = vec {}; \
        archive_options = record { \
            num_blocks_to_archive = 2000; \
            trigger_threshold = 1000; \
            controller_id = principal \"r7inp-6aaaa-aaaaa-aaabq-cai\" \
        }; \
    }})"

    dfx canister update-settings --network=$network burn_token --add-controller r7inp-6aaaa-aaaaa-aaabq-cai
fi
