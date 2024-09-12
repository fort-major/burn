import { Accessor, createContext, createEffect, createSignal, on, onCleanup, onMount, useContext } from "solid-js";
import { IChildren, ONE_MIN_NS } from "../utils/types";
import { ErrorCode, err, logErr, logInfo } from "../utils/error";
import { createStore, produce, Store } from "solid-js/store";
import { useAuth } from "./auth";
import { GetTotalsResponse } from "@/declarations/burner/burner.did";
import { newBurnerActor, optUnwrap } from "@utils/backend";
import { DEFAULT_TOKENS, TPrincipalStr, useTokens } from "./tokens";
import { E8s, EDs } from "@utils/math";
import { Principal } from "@dfinity/principal";
import { debugStringify } from "@utils/encoding";

export interface ITotals {
  totalSharesSupply: EDs;
  totalTcyclesBurned: EDs;
  totalBurnTokenMinted: E8s;
  totalBurners: bigint;
  currentBurnTokenReward: E8s;
  posStartKey?: Principal;
  currentPosRound: bigint;
  currentBlockShareFee: EDs;
  posRoundDelayNs: bigint;
  yourShareTcycles: EDs;
  yourUnclaimedReward: E8s;
}

export interface IPoolMember {
  id: Principal;
  share: EDs;
  unclaimedReward: E8s;
}

export interface IBurnerStoreContext {
  totals: Store<{ data?: ITotals }>;
  fetchTotals: () => Promise<void>;

  getMyDepositAccount: () => { owner: Principal; subaccount?: Uint8Array } | undefined;

  canStake: () => boolean;
  stake: () => Promise<void>;

  canWithdraw: () => boolean;
  withdraw: (to: Principal) => Promise<void>;

  canClaimReward: () => boolean;
  claimReward: (to: Principal) => Promise<void>;

  poolMembers: () => IPoolMember[];
  fetchPoolMembers: () => Promise<void>;
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
  const { assertReadyToFetch, assertAuthorized, anonymousAgent, isAuthorized, agent, identity, disable, enable } =
    useAuth();
  const { subaccounts, fetchSubaccountOf, balanceOf, fetchBalanceOf } = useTokens();

  const [totals, setTotals] = createStore<IBurnerStoreContext["totals"]>();
  const [poolMembers, setPoolMembers] = createSignal<IPoolMember[]>([]);
  const [int, setInt] = createSignal<NodeJS.Timeout>();

  onMount(() => {
    const t = setInterval(() => {
      fetchTotals();
    }, 1000 * 60 * 2);

    setInt(t);
  });

  onCleanup(() => {
    const t = int();
    if (!t) return;

    clearInterval(t);
  });

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

    const iTotals: ITotals = {
      totalSharesSupply: EDs.new(resp.total_share_supply, 12),
      totalTcyclesBurned: EDs.new(resp.total_tcycles_burned, 12),
      totalBurnTokenMinted: E8s.new(resp.total_burn_token_minted),
      totalBurners: resp.total_burners,
      currentBurnTokenReward: E8s.new(resp.current_burn_token_reward),
      posStartKey: optUnwrap(resp.pos_start_key),
      posRoundDelayNs: resp.pos_round_delay_ns,
      currentPosRound: resp.current_pos_round,
      yourShareTcycles: EDs.new(resp.your_share_tcycles, 12),
      yourUnclaimedReward: E8s.new(resp.your_unclaimed_reward_e8s),
      currentBlockShareFee: EDs.new(resp.current_share_fee, 12),
    };

    setTotals({ data: iTotals });
  };

  const fetchPoolMembers: IBurnerStoreContext["fetchPoolMembers"] = async () => {
    assertReadyToFetch();

    let start: [] | [Principal] = [];
    const members = [];

    const burner = newBurnerActor(anonymousAgent()!);

    while (true) {
      const { entries } = await burner.get_burners({ start, take: 1000 });

      if (entries.length === 0) {
        break;
      }

      for (let entry of entries) {
        let iPoolMember: IPoolMember = {
          id: entry[0],
          share: EDs.new(entry[1], 12),
          unclaimedReward: E8s.new(entry[2]),
        };

        members.push(iPoolMember);
        start = [iPoolMember.id];
      }
    }

    setPoolMembers(
      members.sort((a, b) => {
        if (a.share.gt(b.share)) {
          return -1;
        } else if (a.share.lt(b.share)) {
          return 1;
        } else {
          return 0;
        }
      })
    );
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

    disable();

    const myDepositAccount = getMyDepositAccount()!;
    const b = balanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount)!;
    const burner = newBurnerActor(agent()!);
    await burner.stake(b - 10_000n);

    enable();

    fetchTotals();
    fetchBalanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount);

    logInfo(`Successfully burned ${E8s.new(b).toString()} ICP`);
  };

  const canWithdraw: IBurnerStoreContext["canWithdraw"] = () => {
    if (!isAuthorized()) return false;

    const myDepositAccount = getMyDepositAccount();
    if (!myDepositAccount) return false;

    const b = balanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount);
    if (!b) return false;

    // min withdraw amount is 0.1 ICP
    if (E8s.new(b).le(E8s.new(10_0000n))) return false;

    return true;
  };

  const withdraw: IBurnerStoreContext["withdraw"] = async (to) => {
    assertAuthorized();

    disable();

    const myDepositAccount = getMyDepositAccount()!;
    const b = balanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount)!;

    const burner = newBurnerActor(agent()!);
    await burner.withdraw(b - 10_000n, to);

    enable();

    fetchTotals();
    fetchBalanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount);
    logInfo(`Successfully withdrawn ${E8s.new(b).toString()} ICP`);
  };

  const canClaimReward: IBurnerStoreContext["canClaimReward"] = () => {
    if (!isAuthorized()) return false;

    if (!totals.data) return false;

    return totals.data.yourUnclaimedReward.gt(E8s.zero());
  };

  const claimReward: IBurnerStoreContext["claimReward"] = async (to) => {
    assertAuthorized();

    disable();

    const burner = newBurnerActor(agent()!);
    const result = await burner.claim_reward(to);

    if ("Err" in result) {
      logErr(ErrorCode.UNKNOWN, debugStringify(result.Err));
      enable();

      return;
    }

    enable();

    fetchTotals();
    logInfo(`Successfully claimed all BURN!`);
  };

  return (
    <BurnerContext.Provider
      value={{
        totals,
        fetchTotals,
        poolMembers,
        fetchPoolMembers,
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
