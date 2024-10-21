import { Account } from "@dfinity/ledger-icp";
import { Principal } from "@dfinity/principal";
import { err, ErrorCode } from "@utils/error";
import { Fetcher, IChildren, TTimestamp } from "@utils/types";
import { Accessor, createContext, createEffect, on, onMount, useContext } from "solid-js";
import { useAuth } from "./auth";
import { DEFAULT_TOKENS, useTokens } from "./tokens";
import { IcrcLedgerCanister } from "@dfinity/ledger-icrc";
import { newBurnerActor, newFurnaceActor, optUnwrap } from "@utils/backend";

export interface IWalletStoreContext {
  pid: Accessor<Principal | undefined>;
  poolAccount: Accessor<Account | undefined>;
  bonfireAccount: Accessor<Account | undefined>;

  pidBalance: (tokenCanId: Principal) => bigint | undefined;
  fetchPidBalance: (tokenCanId: Principal) => Promise<void>;

  bonfireBalance: (tokenCanId: Principal) => bigint | undefined;
  fetchBonfireBalance: (tokenCanId: Principal) => Promise<void>;

  transfer: (tokenCanId: Principal, to: Account, qty: bigint) => Promise<bigint>;

  claimPoolBurnReward: () => Promise<bigint>;
  claimBonfireIcpReward: (winningEntryTimestamp: TTimestamp, winnerIdx: number) => Promise<bigint>;

  moveIcpToPoolAccount: (qty: bigint) => Promise<bigint>;
  withdrawIcpFromPoolAccount: (qty: bigint) => Promise<bigint>;

  moveToBonfireAccount: (tokenCanId: Principal, qty: bigint) => Promise<bigint>;
  withdrawFromBonfireAccount: (tokenCanId: Principal, qty: bigint) => Promise<bigint>;
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
  const { identity, isAuthorized, assertAuthorized, agent, disable, enable } = useAuth();
  const { subaccounts, fetchSubaccountOf, fetchBalanceOf, balanceOf } = useTokens();

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
        for (let token of Object.values(DEFAULT_TOKENS)) {
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
      fetchBalanceOf(tokenCanId, to.owner, optUnwrap(to.subaccount) as Uint8Array | undefined);
      fetchBalanceOf(tokenCanId, pid()!);
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
      fetchBalanceOf(DEFAULT_TOKENS.burn, pid()!);
      enable();
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
    }
  };

  const withdrawIcpFromPoolAccount: IWalletStoreContext["withdrawIcpFromPoolAccount"] = async (qty) => {
    assertAuthorized();

    disable();

    try {
      const pool = newBurnerActor(agent()!);
      const response = await pool.withdraw({ qty_e8s: qty, to: pid()! });

      return response.block_idx;
    } finally {
      const p = poolAccount()!;
      fetchBalanceOf(DEFAULT_TOKENS.icp, p.owner, optUnwrap(p.subaccount) as Uint8Array | undefined);
      fetchBalanceOf(DEFAULT_TOKENS.icp, pid()!);

      enable();
    }
  };

  const moveIcpToPoolAccount: IWalletStoreContext["moveIcpToPoolAccount"] = async (qty) => {
    assertAuthorized();

    disable();

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

      enable();
    }
  };

  const withdrawFromBonfireAccount: IWalletStoreContext["withdrawFromBonfireAccount"] = async (tokenCanId, qty) => {
    assertAuthorized();

    disable();

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

    disable();

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

      enable();
    }
  };

  return (
    <WalletContext.Provider
      value={{
        pid,
        poolAccount,
        bonfireAccount,

        pidBalance,
        fetchPidBalance,

        bonfireBalance,
        fetchBonfireBalance,

        transfer,

        claimPoolBurnReward,
        claimBonfireIcpReward,

        moveIcpToPoolAccount,
        withdrawIcpFromPoolAccount,

        moveToBonfireAccount,
        withdrawFromBonfireAccount,
      }}
    >
      {props.children}
    </WalletContext.Provider>
  );
}
