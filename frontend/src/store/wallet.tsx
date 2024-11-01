import { Account } from "@dfinity/ledger-icp";
import { Principal } from "@dfinity/principal";
import { err, ErrorCode, logInfo } from "@utils/error";
import { Fetcher, IChildren, TTimestamp } from "@utils/types";
import { Accessor, createContext, createEffect, createMemo, on, onMount, useContext } from "solid-js";
import { useAuth } from "./auth";
import { DEFAULT_TOKENS, useTokens } from "./tokens";
import { IcrcLedgerCanister } from "@dfinity/ledger-icrc";
import { newBurnerActor, newFurnaceActor, optUnwrap } from "@utils/backend";
import { createLocalStorageSignal } from "@utils/common";

export interface IWalletStoreContext {
  pid: Accessor<Principal | undefined>;
  poolAccount: Accessor<Account | undefined>;
  bonfireAccount: Accessor<Account | undefined>;
  subaccount: Accessor<Uint8Array | undefined>;

  pidBalance: (tokenCanId: Principal) => bigint | undefined;
  fetchPidBalance: (tokenCanId: Principal) => Promise<void>;

  bonfireBalance: (tokenCanId: Principal) => bigint | undefined;
  fetchBonfireBalance: (tokenCanId: Principal) => Promise<void>;

  poolBalance: (tokenCanId: Principal) => bigint | undefined;
  fetchPoolBalance: (tokenCanId: Principal) => Promise<void>;

  savedTokens: Accessor<Principal[]>;
  addSavedToken: (tokenCanId: Principal) => void;
  removeSavedToken: (tokenCanId: Principal) => void;

  transfer: (tokenCanId: Principal, to: Account, qty: bigint) => Promise<bigint>;

  claimPoolBurnReward: () => Promise<bigint>;
  claimBonfireIcpReward: (winningEntryTimestamp: TTimestamp, winnerIdx: number) => Promise<bigint>;

  moveIcpToPoolAccount: (qty: bigint) => Promise<bigint>;
  withdrawIcpFromPoolAccount: (qty: bigint) => Promise<bigint>;

  moveToBonfireAccount: (tokenCanId: Principal, qty: bigint) => Promise<bigint>;
  withdrawFromBonfireAccount: (tokenCanId: Principal, qty: bigint) => Promise<bigint>;

  isWalletExpanded: Accessor<boolean | undefined>;
  setWalletExpanded: (val: boolean) => void;
}

const WalletContext = createContext<IWalletStoreContext>();

export function useWallet(): IWalletStoreContext {
  const ctx = useContext(WalletContext);

  if (!ctx) {
    err(ErrorCode.UNREACHEABLE, "Wallet context is not initialized");
  }

  return ctx;
}

export function WalletStore(props: IChildren) {
  const { identity, isReadyToFetch, isAuthorized, assertAuthorized, agent, disable, enable } = useAuth();
  const { subaccounts, fetchSubaccountOf, fetchBalanceOf, balanceOf, fetchMetadata } = useTokens();

  const [savedTokens, setSavedTokens] = createLocalStorageSignal<string[]>("msq-burn-saved-tokens");
  const [isWalletExpanded, setWalletExpanded] = createLocalStorageSignal<boolean>("msq-burn-wallet-expanded");

  createEffect(() => {
    if (isReadyToFetch()) {
      for (let token of getSavedTokens()) {
        fetchMetadata(token);
      }
    }
  });

  createEffect(
    on(savedTokens, (tokens) => {
      if (!tokens || tokens.length === 0) {
        setSavedTokens(Object.values(DEFAULT_TOKENS).map((it) => it.toText()));
      }
    })
  );

  const getSavedTokens: IWalletStoreContext["savedTokens"] = createMemo(() => {
    return (savedTokens() ?? []).map((it) => Principal.fromText(it)) || Object.values(DEFAULT_TOKENS);
  });

  const addSavedToken: IWalletStoreContext["addSavedToken"] = (tokenCanId) => {
    setSavedTokens((prev) => {
      const s = new Set(prev);
      s.add(tokenCanId.toText());

      return [...s];
    });
  };

  const removeSavedToken: IWalletStoreContext["removeSavedToken"] = (tokenCanId) => {
    setSavedTokens((prev) => {
      const s = new Set(prev);
      s.delete(tokenCanId.toText());

      return [...s];
    });
  };

  const pid: IWalletStoreContext["pid"] = () => {
    if (!isAuthorized()) return undefined;

    return identity()?.getPrincipal();
  };

  const pidBalance: IWalletStoreContext["pidBalance"] = (tokenCanId) =>
    pid() ? balanceOf(tokenCanId, pid()!) : undefined;

  const fetchPidBalance: IWalletStoreContext["fetchPidBalance"] = (tokenCanId) => {
    return fetchBalanceOf(tokenCanId, pid()!);
  };

  createEffect(
    on(pid, (p) => {
      if (p) {
        for (let token of getSavedTokens()) {
          if (pidBalance(token) === undefined) {
            fetchPidBalance(token);
          }
        }
      }
    })
  );

  createEffect(
    on(getSavedTokens, (tokens) => {
      const p = pid();
      if (p) {
        for (let token of tokens) {
          if (pidBalance(token) === undefined) {
            fetchPidBalance(token);
          }
        }
      }
    })
  );

  const subaccount = () => {
    const p = pid();
    if (!p) return undefined;

    return subaccounts[p.toText()];
  };

  createEffect(
    on(isAuthorized, (ready) => {
      if (ready && !subaccount()) {
        fetchSubaccountOf(pid()!);
      }
    })
  );

  const poolAccount: IWalletStoreContext["poolAccount"] = () => {
    const s = subaccount();
    if (!s) return undefined;

    return { owner: Principal.from(import.meta.env.VITE_BURNER_CANISTER_ID), subaccount: [s] };
  };

  const bonfireAccount: IWalletStoreContext["bonfireAccount"] = () => {
    const s = subaccount();
    if (!s) return undefined;

    return { owner: Principal.from(import.meta.env.VITE_FURNACE_CANISTER_ID), subaccount: [s] };
  };

  const bonfireBalance: IWalletStoreContext["bonfireBalance"] = (tokenCanId) => {
    const a = bonfireAccount();
    if (!a) return undefined;

    return balanceOf(tokenCanId, a.owner, optUnwrap(a.subaccount) as Uint8Array);
  };

  const fetchBonfireBalance: IWalletStoreContext["fetchBonfireBalance"] = (tokenCanId) => {
    const a = bonfireAccount();
    if (!a) return Promise.resolve();

    return fetchBalanceOf(tokenCanId, a.owner, optUnwrap(a.subaccount) as Uint8Array);
  };

  const poolBalance: IWalletStoreContext["poolBalance"] = (tokenCanId) => {
    let p = poolAccount();
    if (!p) return undefined;

    return balanceOf(tokenCanId, p.owner, optUnwrap(p.subaccount) as Uint8Array);
  };

  const fetchPoolBalance: IWalletStoreContext["fetchPoolBalance"] = (tokenCanId) => {
    const a = poolAccount();
    if (!a) return Promise.resolve();

    return fetchBalanceOf(tokenCanId, a.owner, optUnwrap(a.subaccount) as Uint8Array);
  };

  const transfer: IWalletStoreContext["transfer"] = async (tokenCanId, to, qty) => {
    assertAuthorized();

    disable();

    try {
      const token = IcrcLedgerCanister.create({ agent: agent()!, canisterId: tokenCanId });
      const blockIdx = await token.transfer({
        from_subaccount: undefined,
        to,
        amount: qty,
        fee: undefined,
        created_at_time: undefined,
      });

      return blockIdx;
    } finally {
      await Promise.all([
        fetchBalanceOf(tokenCanId, to.owner, optUnwrap(to.subaccount) as Uint8Array | undefined),
        fetchPidBalance(tokenCanId),
      ]);

      enable();
    }
  };

  const claimPoolBurnReward: IWalletStoreContext["claimPoolBurnReward"] = async () => {
    assertAuthorized();

    disable();

    try {
      const pool = newBurnerActor(agent()!);
      const response = await pool.claim_reward({ to: pid()! });

      if ("Err" in response.result) {
        throw new Error(response.result.Err);
      }

      return response.result.Ok;
    } finally {
      await fetchBalanceOf(DEFAULT_TOKENS.burn, pid()!);

      enable();

      logInfo("Successfully claimed $BURN to the wallet!");
    }
  };

  const claimBonfireIcpReward: IWalletStoreContext["claimBonfireIcpReward"] = async (
    winningEntryTimestamp,
    winnerIdx
  ) => {
    assertAuthorized();

    disable();

    try {
      const bonfire = newFurnaceActor(agent()!);
      const response = await bonfire.claim_reward_icp({
        to: { owner: pid()!, subaccount: [] },
        winning_entry_timestamp_ns: winningEntryTimestamp,
        winner_idx: winnerIdx,
      });

      if ("Err" in response.result) {
        throw new Error(response.result.Err);
      }

      return response.result.Ok;
    } finally {
      fetchBalanceOf(DEFAULT_TOKENS.icp, pid()!);

      enable();

      logInfo("Successfully claimed $ICP to the wallet!");
    }
  };

  const withdrawIcpFromPoolAccount: IWalletStoreContext["withdrawIcpFromPoolAccount"] = async (qty) => {
    assertAuthorized();

    try {
      const pool = newBurnerActor(agent()!);
      const response = await pool.withdraw({ qty_e8s: qty, to: pid()! });

      return response.block_idx;
    } finally {
      const p = poolAccount()!;
      fetchBalanceOf(DEFAULT_TOKENS.icp, p.owner, optUnwrap(p.subaccount) as Uint8Array | undefined);
      fetchBalanceOf(DEFAULT_TOKENS.icp, pid()!);
    }
  };

  const moveIcpToPoolAccount: IWalletStoreContext["moveIcpToPoolAccount"] = async (qty) => {
    assertAuthorized();

    try {
      const icp = IcrcLedgerCanister.create({ canisterId: DEFAULT_TOKENS.icp, agent: agent()! });
      const blockIdx = await icp.transfer({
        to: poolAccount()!,
        amount: qty,
      });

      return blockIdx;
    } finally {
      const p = poolAccount()!;
      fetchBalanceOf(DEFAULT_TOKENS.icp, p.owner, optUnwrap(p.subaccount) as Uint8Array | undefined);
      fetchBalanceOf(DEFAULT_TOKENS.icp, pid()!);
    }
  };

  const withdrawFromBonfireAccount: IWalletStoreContext["withdrawFromBonfireAccount"] = async (tokenCanId, qty) => {
    assertAuthorized();

    try {
      const bonfire = newFurnaceActor(agent()!);
      const response = await bonfire.withdraw({ token_can_id: tokenCanId, to: { owner: pid()!, subaccount: [] }, qty });

      return response.block_idx;
    } finally {
      const p = bonfireAccount()!;
      fetchBalanceOf(tokenCanId, p.owner, optUnwrap(p.subaccount) as Uint8Array | undefined);
      fetchBalanceOf(tokenCanId, pid()!);

      enable();
    }
  };

  const moveToBonfireAccount: IWalletStoreContext["moveToBonfireAccount"] = async (tokenCanId, qty) => {
    assertAuthorized();

    try {
      const token = IcrcLedgerCanister.create({ canisterId: tokenCanId, agent: agent()! });
      const blockIdx = await token.transfer({
        to: bonfireAccount()!,
        amount: qty,
      });

      return blockIdx;
    } finally {
      const p = poolAccount()!;
      fetchBalanceOf(tokenCanId, p.owner, optUnwrap(p.subaccount) as Uint8Array | undefined);
      fetchBalanceOf(tokenCanId, pid()!);
    }
  };

  return (
    <WalletContext.Provider
      value={{
        pid,
        poolAccount,
        bonfireAccount,
        subaccount,

        pidBalance,
        fetchPidBalance,

        bonfireBalance,
        fetchBonfireBalance,

        poolBalance,
        fetchPoolBalance,

        savedTokens: getSavedTokens,
        addSavedToken,
        removeSavedToken,

        transfer,

        claimPoolBurnReward,
        claimBonfireIcpReward,

        moveIcpToPoolAccount,
        withdrawIcpFromPoolAccount,

        moveToBonfireAccount,
        withdrawFromBonfireAccount,

        isWalletExpanded,
        setWalletExpanded,
      }}
    >
      {props.children}
    </WalletContext.Provider>
  );
}
