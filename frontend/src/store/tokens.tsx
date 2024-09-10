import { createContext, createEffect, on, useContext } from "solid-js";
import { IChildren } from "../utils/types";
import { ErrorCode, err, logInfo } from "../utils/error";
import { createStore, Store } from "solid-js/store";
import { useAuth } from "./auth";
import { Principal } from "@dfinity/principal";
import { E8s, EDs } from "@utils/math";
import { bytesToHex } from "@utils/encoding";
import { IcrcLedgerCanister, IcrcMetadataResponseEntries } from "@dfinity/ledger-icrc";
import { newBurnerActor, opt, optUnwrap } from "@utils/backend";
import { nowNs } from "@utils/common";

export type TPrincipalStr = string;
export type TSubaccountStr = string;
export type TSubaccount = Uint8Array;
export type TTicker = string;

export interface ITokenMetadata {
  id: Principal;
  fee: EDs;
  ticker: TTicker;
  logoSrc: string;
  name: string;
}

export interface ITokensStoreContext {
  balances: Store<
    Partial<Record<TPrincipalStr, Partial<Record<TPrincipalStr, Partial<Record<TSubaccountStr, bigint>>>>>>
  >;
  balanceOf: (tokenId: Principal, owner: Principal, subaccount?: TSubaccount) => bigint | undefined;
  fetchBalanceOf: (tokenId: Principal, owner: Principal, subaccount?: TSubaccount) => Promise<void>;

  subaccounts: Store<Partial<Record<TPrincipalStr, Uint8Array>>>;
  fetchSubaccountOf: (id: Principal) => Promise<void>;

  metadata: Store<Partial<Record<TPrincipalStr, ITokenMetadata>>>;
  fetchMetadata: (id: Principal) => Promise<void>;

  transfer: (tokenId: Principal, qty: EDs, to: Principal) => Promise<void>;
  canTransfer: (tokenId: Principal) => boolean;
}

const TokensContext = createContext<ITokensStoreContext>();

export function useTokens(): ITokensStoreContext {
  const ctx = useContext(TokensContext);

  if (!ctx) {
    err(ErrorCode.UNREACHEABLE, "Tokens context is not initialized");
  }

  return ctx;
}

export const DEFAULT_TOKENS = {
  burn: Principal.fromText(import.meta.env.VITE_BURN_TOKEN_CANISTER_ID),
  icp: Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai"),
};

export function TokensStore(props: IChildren) {
  const { assertReadyToFetch, assertAuthorized, anonymousAgent, isAuthorized, agent, identity } = useAuth();

  const [balances, setBalances] = createStore<ITokensStoreContext["balances"]>();
  const [subaccounts, setSubaccounts] = createStore<ITokensStoreContext["subaccounts"]>();
  const [metadata, setMetadata] = createStore<ITokensStoreContext["metadata"]>();

  createEffect(
    on(anonymousAgent, (a) => {
      if (!a) return;

      fetchMetadata(DEFAULT_TOKENS.burn);
      fetchMetadata(DEFAULT_TOKENS.icp);
    })
  );

  const balanceOf: ITokensStoreContext["balanceOf"] = (tokenId, owner, subaccount) => {
    return balances[tokenId.toText()]?.[owner.toText()]?.[bytesToHex(orDefaultSubaccount(subaccount))];
  };

  const fetchBalanceOf: ITokensStoreContext["fetchBalanceOf"] = async (tokenId, owner, subaccount) => {
    assertReadyToFetch();

    const ledger = IcrcLedgerCanister.create({ agent: anonymousAgent()!, canisterId: tokenId });
    const balance = await ledger.balance({ owner: owner, subaccount });

    const tId = tokenId.toText();
    const oId = owner.toText();
    const sub = bytesToHex(orDefaultSubaccount(subaccount));

    if (!balances[tId]) {
      setBalances(tId, {});
    }

    if (!balances[tId]?.[oId]) {
      setBalances(tId, oId, {});
    }

    setBalances(tId, oId, sub, balance);
  };

  const fetchSubaccountOf: ITokensStoreContext["fetchSubaccountOf"] = async (id) => {
    assertReadyToFetch();

    const burner = newBurnerActor(anonymousAgent()!);
    const subaccount = await burner.subaccount_of(id);

    setSubaccounts(id.toText(), subaccount as Uint8Array);
  };

  const fetchMetadata: ITokensStoreContext["fetchMetadata"] = async (id) => {
    assertReadyToFetch();

    const ledger = IcrcLedgerCanister.create({ agent: anonymousAgent()!, canisterId: id });
    const metadata = await ledger.metadata({ certified: false });

    const name = (metadata.find((it) => it[0] === IcrcMetadataResponseEntries.NAME)![1] as { Text: string }).Text;
    const symbol = (metadata.find((it) => it[0] === IcrcMetadataResponseEntries.SYMBOL)![1] as { Text: string }).Text;
    const fee = (metadata.find((it) => it[0] === IcrcMetadataResponseEntries.FEE)![1] as { Nat: bigint }).Nat;
    const decimals = (metadata.find((it) => it[0] === IcrcMetadataResponseEntries.DECIMALS)![1] as { Nat: bigint }).Nat;

    let logoEntry = metadata.find((it) => it[0] === IcrcMetadataResponseEntries.LOGO);
    let logo: string | undefined = undefined;

    if (logoEntry) {
      logo = (logoEntry![1] as { Text: string }).Text;

      if (!logo && id.compareTo(DEFAULT_TOKENS.icp) === "eq") {
        logo =
          "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzgwM18yNTUxKSI+CjxwYXRoIGQ9Ik01MCAyNUM1MCAzOC44MDcgMzguODA3IDUwIDI1IDUwQzExLjE5MjkgNTAgMCAzOC44MDcgMCAyNUMwIDExLjE5MjkgMTEuMTkyOSAwIDI1IDBDMzguODA3IDAgNTAgMTEuMTkyOSA1MCAyNVoiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik0zNC45NDI2IDI5LjYxNjdDMzIuODM0MiAyOS42MTY3IDMwLjYwODIgMjguMjM4MSAyOS41MTU3IDI3LjIzODNDMjguMzIwNyAyNi4xNDQ0IDI1LjAzOCAyMi41ODM4IDI1LjAyMzYgMjIuNTY3N0MyMi44NzA5IDIwLjE2NiAxOS45NzY1IDE3LjUgMTcuMDg5IDE3LjVDMTMuNjExMyAxNy41IDEwLjU3NzkgMTkuOTA4NiA5Ljc4OTA2IDIzLjA5OTJDOS44NDkyNyAyMi44ODg4IDEwLjk1NSAxOS45NjYxIDE1LjEwNTIgMTkuOTY2MUMxNy4yMTM2IDE5Ljk2NjEgMTkuNDM5NiAyMS4zNDQ0IDIwLjUzMjEgMjIuMzQ0NEMyMS43MjcxIDIzLjQzODEgMjUuMDA5NiAyNi45OTkgMjUuMDI0MiAyNy4wMTQ4QzI3LjE3NjcgMjkuNDE2NyAzMC4wNzEzIDMyLjA4MjcgMzIuOTU5NCAzMi4wODI3QzM2LjQzNzEgMzIuMDgyNyAzOS40Njk5IDI5LjY3NCA0MC4yNTk0IDI2LjQ4MzVDNDAuMTk5MiAyNi42OTM4IDM5LjA5MjggMjkuNjE2NyAzNC45NDI2IDI5LjYxNjdaIiBmaWxsPSIjMjlBQUUxIi8+CjxwYXRoIGQ9Ik0yNS4wMjI3IDI3LjAxNTZDMjUuMDE1MiAyNy4wMDY2IDI0LjA2OTkgMjUuOTgxOSAyMy4wMDk3IDI0Ljg2MzVDMjIuNDM2OCAyNS41NDM3IDIxLjYxMTQgMjYuNDcwNCAyMC42NjI4IDI3LjMwMTJDMTguODk0MiAyOC44NTEyIDE3Ljc0NDggMjkuMTc2NCAxNy4wODc1IDI5LjE3NjRDMTQuNjA3NiAyOS4xNzY0IDEyLjU4NDQgMjcuMjA5NCAxMi41ODQ0IDI0Ljc5MTZDMTIuNTg0NCAyMi4zNzM5IDE0LjYwNDggMjAuNDIyIDE3LjA4NzUgMjAuNDA2OEMxNy4xNzc0IDIwLjQwNjggMTcuMjg2OCAyMC40MTU4IDE3LjQxODMgMjAuNDM5NEMxNi42NzI0IDIwLjE1MjkgMTUuODgwMSAxOS45NjYxIDE1LjEwMzcgMTkuOTY2MUMxMC45NTQ4IDE5Ljk2NjEgOS44NDk0MyAyMi44ODc1IDkuNzg4NTMgMjMuMDk5MUM5LjY1NDMgMjMuNjQzMSA5LjU4MjAzIDI0LjIwOTEgOS41ODIwMyAyNC43OTE2QzkuNTgyMDMgMjguODEyNSAxMi44OTg1IDMyLjA4MzMgMTcuMDM0MiAzMi4wODMzQzE4Ljc1ODUgMzIuMDgzMyAyMC42ODk3IDMxLjE5OTggMjIuNjc4NSAyOS40NTZDMjMuNjE4NyAyOC42MzE5IDI0LjQzMzkgMjcuNzUwNCAyNS4wNDYyIDI3LjA0MTlDMjUuMDM4NyAyNy4wMzI5IDI1LjAzMDQgMjcuMDI0NiAyNS4wMjI3IDI3LjAxNTZaIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfODAzXzI1NTEpIi8+CjxwYXRoIGQ9Ik0yNS4wMjQgMjIuNTY3N0MyNS4wMzE1IDIyLjU3NjcgMjUuOTc2NSAyMy42MDE1IDI3LjAzNjUgMjQuNzE5OEMyNy42MDk0IDI0LjAzOTYgMjguNDM0OCAyMy4xMTI5IDI5LjM4MzUgMjIuMjgyMUMzMS4xNTIxIDIwLjczMjEgMzIuMzAxNSAyMC40MDY4IDMyLjk1ODcgMjAuNDA2OEMzNS40Mzg3IDIwLjQwNjggMzcuNDYxOSAyMi4zNzQgMzcuNDYxOSAyNC43OTE3QzM3LjQ2MTkgMjcuMTk1NCAzNS40NDE1IDI5LjE2MTIgMzIuOTU4NyAyOS4xNzY1QzMyLjg2ODcgMjkuMTc2NSAzMi43NTk2IDI5LjE2NzUgMzIuNjI3OSAyOS4xNDRDMzMuMzc0IDI5LjQzMDQgMzQuMTY2MiAyOS42MTczIDM0Ljk0MjUgMjkuNjE3M0MzOS4wOTIxIDI5LjYxNzMgNDAuMTk3OSAyNi42OTU4IDQwLjI1ODcgMjYuNDg0MkM0MC4zOTI5IDI1Ljk0MDIgNDAuNDY1IDI1LjM3NDQgNDAuNDY1IDI0Ljc5MTdDNDAuNDY1IDIwLjc3MDggMzcuMDk0NiAxNy41IDMyLjk1ODcgMTcuNUMzMS4yMzQ0IDE3LjUgMjkuMzU3MyAxOC4zODM2IDI3LjM2NzkgMjAuMTI3M0MyNi40Mjc1IDIwLjk1MTUgMjUuNjEyNSAyMS44MzI5IDI1IDIyLjU0MTVDMjUuMDA3NyAyMi41NTA0IDI1LjAxNjIgMjIuNTU4OCAyNS4wMjQgMjIuNTY3N1oiIGZpbGw9InVybCgjcGFpbnQxX2xpbmVhcl84MDNfMjU1MSkiLz4KPC9nPgo8ZGVmcz4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzgwM18yNTUxIiB4MT0iMzQuODczMyIgeTE9IjQyLjU1MjMiIHgyPSIwLjY3NzQ5OSIgeTI9IjE0LjgwNDYiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agb2Zmc2V0PSIwLjIyIiBzdG9wLWNvbG9yPSIjRUMxRTc5Ii8+CjxzdG9wIG9mZnNldD0iMC44OSIgc3RvcC1jb2xvcj0iIzUyMjc4NCIvPgo8L2xpbmVhckdyYWRpZW50Pgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MV9saW5lYXJfODAzXzI1NTEiIHgxPSIyOS4wNjEiIHkxPSIxOC40NjA0IiB4Mj0iMzkuMjE3MyIgeTI9IjI4Ljk3NzkiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agb2Zmc2V0PSIwLjIxIiBzdG9wLWNvbG9yPSIjRjA1QTI0Ii8+CjxzdG9wIG9mZnNldD0iMC42OCIgc3RvcC1jb2xvcj0iI0ZBQUYzQiIvPgo8L2xpbmVhckdyYWRpZW50Pgo8Y2xpcFBhdGggaWQ9ImNsaXAwXzgwM18yNTUxIj4KPHJlY3Qgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSJ3aGl0ZSIvPgo8L2NsaXBQYXRoPgo8L2RlZnM+Cjwvc3ZnPgo=";
      }
    }

    const meta: ITokenMetadata = {
      name,
      ticker: symbol,
      fee: EDs.new(fee, Number(decimals)),
      id,
      logoSrc: logo!,
    };

    setMetadata(id.toText(), meta);
  };

  const canTransfer: ITokensStoreContext["canTransfer"] = (tokenId) => isAuthorized() && !!metadata[tokenId.toText()];

  const transfer: ITokensStoreContext["transfer"] = async (tokenId, qty, to) => {
    assertAuthorized();

    const meta = metadata[tokenId.toText()]!;

    const ledger = IcrcLedgerCanister.create({ agent: agent()!, canisterId: tokenId });

    const blockIdx = await ledger.transfer({
      to: {
        owner: to,
        subaccount: [],
      },
      amount: qty.val,
      fee: meta.fee.val,
      created_at_time: nowNs(),
    });

    logInfo(`Transferred ${qty.toString()} ${meta.ticker} at #${blockIdx.toString()}`);
  };

  return (
    <TokensContext.Provider
      value={{
        balances,
        balanceOf,
        fetchBalanceOf,
        subaccounts,
        fetchSubaccountOf,
        metadata,
        fetchMetadata,
        transfer,
        canTransfer,
      }}
    >
      {props.children}
    </TokensContext.Provider>
  );
}

function orDefaultSubaccount(subaccount?: TSubaccount): TSubaccount {
  return subaccount ? subaccount : new Uint8Array(32);
}
