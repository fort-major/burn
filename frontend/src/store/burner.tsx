import { Accessor, createContext, createEffect, createSignal, on, useContext } from "solid-js";
import { IChildren } from "../utils/types";
import { ErrorCode, err, logErr, logInfo } from "../utils/error";
import { createStore, Store } from "solid-js/store";
import { useAuth } from "./auth";
import { GetTotalsResponse } from "@/declarations/burner/burner.did";
import { newBurnerActor } from "@utils/backend";
import { DEFAULT_TOKENS, TPrincipalStr, useTokens } from "./tokens";
import { E8s, EDs } from "@utils/math";
import { Principal } from "@dfinity/principal";
import { debugStringify } from "@utils/encoding";

export interface IBurnerStoreContext {
  totals: Store<Partial<GetTotalsResponse>>;
  fetchTotals: () => Promise<void>;

  shares: Store<Partial<Record<TPrincipalStr, EDs>>>;
  fetchShares: (ids: Principal[]) => Promise<void>;

  getMyDepositAccount: () => { owner: Principal; subaccount?: Uint8Array } | undefined;

  canStake: () => boolean;
  stake: () => Promise<void>;

  canWithdraw: () => boolean;
  withdraw: (to: Principal) => Promise<void>;

  canClaimReward: () => boolean;
  claimReward: (to: Principal) => Promise<void>;
}

const BurnerContext = createContext<IBurnerStoreContext>();

export function useBurner(): IBurnerStoreContext {
  const ctx = useContext(BurnerContext);

  if (!ctx) {
    err(ErrorCode.UNREACHEABLE, "Burner context is not initialized");
  }

  return ctx;
}

export function BurnerStore(props: IChildren) {
  const { assertReadyToFetch, assertAuthorized, anonymousAgent, isAuthorized, agent, identity } = useAuth();
  const { subaccounts, fetchSubaccountOf, balanceOf, fetchBalanceOf } = useTokens();

  const [totals, setTotals] = createStore<IBurnerStoreContext["totals"]>();
  const [shares, setShares] = createStore<IBurnerStoreContext["shares"]>();

  createEffect(
    on(anonymousAgent, (a) => {
      if (!a) return;

      fetchTotals();
    })
  );

  createEffect(
    on(isAuthorized, (ready) => {
      if (ready) {
        fetchSubaccountOf(identity()!.getPrincipal());
        fetchTotals();
      }
    })
  );

  const fetchTotals: IBurnerStoreContext["fetchTotals"] = async () => {
    assertReadyToFetch();

    const ag = agent() ? agent()! : anonymousAgent()!;

    const burner = newBurnerActor(ag);
    const resp = await burner.get_totals();

    setTotals(resp);
  };

  const fetchShares: IBurnerStoreContext["fetchShares"] = async (ids: Principal[]) => {
    assertReadyToFetch();

    const burner = newBurnerActor(anonymousAgent()!);
    const { entries } = await burner.get_balance({ ids });

    for (let i = 0; i < ids.length; i++) {
      setShares(ids[i].toText(), entries[i]);
    }
  };

  const getMyDepositAccount: IBurnerStoreContext["getMyDepositAccount"] = () => {
    if (!isAuthorized()) return undefined;

    const mySubaccount = subaccounts[identity()!.getPrincipal().toText()];
    if (!mySubaccount) return undefined;

    return { owner: Principal.fromText(import.meta.env.VITE_BURNER_CANISTER_ID), subaccount: mySubaccount };
  };

  createEffect(
    on(getMyDepositAccount, (acc) => {
      if (!acc) return;

      fetchBalanceOf(DEFAULT_TOKENS.icp, acc.owner, acc.subaccount);
    })
  );

  const canStake: IBurnerStoreContext["canStake"] = () => {
    if (!isAuthorized()) return false;

    const myDepositAccount = getMyDepositAccount();
    if (!myDepositAccount) return false;

    const b = balanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount);
    if (!b) return false;

    if (E8s.new(b).le(E8s.f0_5())) return false;

    return true;
  };

  const stake: IBurnerStoreContext["stake"] = async () => {
    assertAuthorized();

    const myDepositAccount = getMyDepositAccount()!;

    const b = balanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount)!;

    const burner = newBurnerActor(anonymousAgent()!);
    await burner.stake(b);

    fetchTotals();
    logInfo(`Successfully burned ${E8s.new(b).toString()} ICP`);
  };

  const canWithdraw: IBurnerStoreContext["canWithdraw"] = () => {
    if (!isAuthorized()) return false;

    const myDepositAccount = getMyDepositAccount();
    if (!myDepositAccount) return false;

    const b = balanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount);
    if (!b) return false;

    // min withdraw amount is 0.01 ICP
    if (E8s.new(b).le(E8s.new(100_0000n))) return false;

    return true;
  };

  const withdraw: IBurnerStoreContext["withdraw"] = async (to) => {
    assertAuthorized();

    const myDepositAccount = getMyDepositAccount()!;
    const b = balanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount)!;

    const burner = newBurnerActor(anonymousAgent()!);
    await burner.withdraw(b, to);

    fetchTotals();
    logInfo(`Successfully withdrawn ${E8s.new(b).toString()} ICP`);
  };

  const canClaimReward: IBurnerStoreContext["canClaimReward"] = () => {
    if (!isAuthorized()) return false;

    const r = totals.your_unclaimed_reward_e8s;
    if (!r) return false;

    return true;
  };

  const claimReward: IBurnerStoreContext["claimReward"] = async (to) => {
    assertAuthorized();

    const burner = newBurnerActor(anonymousAgent()!);
    const result = await burner.claim_reward(to);

    if ("Err" in result) {
      logErr(ErrorCode.UNKNOWN, debugStringify(result.Err));
      return;
    }

    logInfo(`Successfully claimed ${E8s.new(result.Ok).toString()} BURN!`);
  };

  return (
    <BurnerContext.Provider
      value={{
        totals,
        fetchTotals,
        shares,
        fetchShares,
        getMyDepositAccount,
        stake,
        canStake,
        withdraw,
        canWithdraw,
        canClaimReward,
        claimReward,
      }}
    >
      {props.children}
    </BurnerContext.Provider>
  );
}
