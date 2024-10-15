import { createContext, createEffect, createSignal, on, onCleanup, onMount, useContext } from "solid-js";
import { IChildren, ONE_WEEK_NS } from "../utils/types";
import { ErrorCode, err, logErr, logInfo } from "../utils/error";
import { createStore, Store } from "solid-js/store";
import { iiFeHost, useAuth } from "./auth";
import { newBurnerActor, optUnwrap } from "@utils/backend";
import { DEFAULT_TOKENS, useTokens } from "./tokens";
import { E8s, EDs } from "@utils/math";
import { Principal } from "@dfinity/principal";
import { debugStringify } from "@utils/encoding";
import {
  requestVerifiablePresentation,
  VerifiablePresentationResponse,
} from "@dfinity/verifiable-credentials/request-verifiable-presentation";

export interface ITotals {
  totalSharesSupply: EDs;
  totalTcyclesBurned: EDs;
  totalBurnTokenMinted: E8s;
  currentBurnTokenReward: E8s;
  posStartKey?: Principal;
  currentPosRound: bigint;
  currentBlockShareFee: EDs;
  posRoundDelayNs: bigint;
  isLotteryEnabled: boolean;

  totalBurners: bigint;
  totalVerifiedAccounts: bigint;
  totalLotteryParticipants: bigint;

  totalKamikazePoolSupply: EDs;
  icpToCyclesExchangeRate: EDs;

  isKamikazePoolEnabled: boolean;

  yourKamikazeShareTcycles: EDs;
  yourKamikazePositionCreatedAt?: Date;
  yourShareTcycles: EDs;
  yourUnclaimedReward: E8s;
  yourDecideIdVerificationStatus: boolean;
  yourLotteryEligibilityStatus: boolean;
}

export interface IPoolMember {
  id: Principal;
  share: EDs;
  unclaimedReward: E8s;
  isVerifiedViaDecideID: boolean;
  lotteryRoundsWon: bigint;
}

export interface IKamikazePoolMember {
  id: Principal;
  share: EDs;
  roundsWon: bigint;
  createdAtDate: Date;
}

export interface IBurnerStoreContext {
  totals: Store<{ data?: ITotals }>;
  fetchTotals: () => Promise<void>;

  getMyDepositAccount: () => { owner: Principal; subaccount?: Uint8Array } | undefined;

  canStake: () => boolean;
  stake: () => Promise<void>;
  stakeKamikaze: () => Promise<void>;

  canWithdraw: () => boolean;
  withdraw: (to: Principal) => Promise<void>;

  canClaimReward: () => boolean;
  claimReward: (to: Principal) => Promise<void>;

  poolMembers: () => IPoolMember[];
  fetchPoolMembers: () => Promise<void>;

  kamikazePoolMembers: () => IKamikazePoolMember[];
  fetchKamikazePoolMembers: () => Promise<void>;

  canMigrateMsqAccount: () => boolean;
  migrateMsqAccount: () => Promise<void>;

  canVerifyDecideId: () => boolean;
  verifyDecideId: () => Promise<void>;
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
  const {
    assertReadyToFetch,
    assertAuthorized,
    anonymousAgent,
    isAuthorized,
    agent,
    identity,
    disable,
    enable,
    authProvider,
    iiClient,
    deauthorize,
  } = useAuth();
  const { subaccounts, fetchSubaccountOf, balanceOf, fetchBalanceOf } = useTokens();

  const [totals, setTotals] = createStore<IBurnerStoreContext["totals"]>();
  const [poolMembers, setPoolMembers] = createSignal<IPoolMember[]>([]);
  const [kamikazePoolMembers, setKamikazePoolMembers] = createSignal<IKamikazePoolMember[]>([]);
  const [int, setInt] = createSignal<NodeJS.Timeout>();
  const [canMigrate, setCanMigrate] = createSignal(false);

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
    on(agent, (a) => {
      if (a!) {
        fetchSubaccountOf(identity()!.getPrincipal());
        fetchTotals();

        if (authProvider() === "MSQ") {
          fetchCanMigrateMsqAccount();
        }
      }
    })
  );

  const fetchTotals: IBurnerStoreContext["fetchTotals"] = async () => {
    assertReadyToFetch();

    const ag = agent() ? agent()! : anonymousAgent()!;

    const burner = newBurnerActor(ag);
    const resp = await burner.get_totals();

    const kamikazePositionCreatedAtNs = optUnwrap(resp.your_kamikaze_position_created_at);
    const kamikazePositionCreatedAtDate = kamikazePositionCreatedAtNs
      ? new Date(Number(kamikazePositionCreatedAtNs / 1_000_000n))
      : undefined;

    const iTotals: ITotals = {
      totalSharesSupply: EDs.new(resp.total_share_supply, 12),
      totalTcyclesBurned: EDs.new(resp.total_tcycles_burned, 12),
      totalBurnTokenMinted: E8s.new(resp.total_burn_token_minted),
      currentBurnTokenReward: E8s.new(resp.current_burn_token_reward),
      posStartKey: optUnwrap(resp.pos_start_key),
      posRoundDelayNs: resp.pos_round_delay_ns,
      currentPosRound: resp.current_pos_round,
      currentBlockShareFee: EDs.new(resp.current_share_fee, 12),
      isLotteryEnabled: resp.is_lottery_enabled,

      totalBurners: resp.total_burners,
      totalLotteryParticipants: resp.total_lottery_participants,
      totalVerifiedAccounts: resp.total_verified_accounts,

      totalKamikazePoolSupply: EDs.new(resp.total_kamikaze_pool_supply || 1n, 12),
      icpToCyclesExchangeRate: EDs.new(resp.icp_to_cycles_exchange_rate, 12),

      isKamikazePoolEnabled: resp.is_kamikaze_pool_enabled,

      yourKamikazeShareTcycles: EDs.new(resp.your_kamikaze_share_tcycles, 12),
      yourKamikazePositionCreatedAt: kamikazePositionCreatedAtDate,
      yourShareTcycles: EDs.new(resp.your_share_tcycles, 12),
      yourUnclaimedReward: E8s.new(resp.your_unclaimed_reward_e8s),
      yourDecideIdVerificationStatus: resp.your_decide_id_verification_status,
      yourLotteryEligibilityStatus: resp.your_lottery_eligibility_status,
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
          id: entry.pid,
          share: EDs.new(entry.share, 12),
          unclaimedReward: E8s.new(entry.unclaimed_reward),
          isVerifiedViaDecideID: entry.is_lottery_participant,
          lotteryRoundsWon: entry.lottery_rounds_won,
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

  const fetchKamikazePoolMembers: IBurnerStoreContext["fetchKamikazePoolMembers"] = async () => {
    assertReadyToFetch();

    let start: [] | [Principal] = [];
    const members = [];

    const burner = newBurnerActor(anonymousAgent()!);

    while (true) {
      const { entries } = await burner.get_kamikazes({ start, take: 1000 });

      if (entries.length === 0) {
        break;
      }

      for (let entry of entries) {
        let iPoolMember: IKamikazePoolMember = {
          id: entry.pid,
          share: EDs.new(entry.share, 12),
          roundsWon: entry.rounds_won,
          createdAtDate: new Date(Number(entry.created_at / 1_000_000n)),
        };

        members.push(iPoolMember);
        start = [iPoolMember.id];
      }
    }

    setKamikazePoolMembers(
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
    await burner.stake({ qty_e8s_u64: b - 10_000n });

    enable();

    fetchTotals();
    fetchBalanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount);

    logInfo(`Successfully pledged ${E8s.new(b).toString()} ICP`);
  };

  const stakeKamikaze: IBurnerStoreContext["stakeKamikaze"] = async () => {
    assertAuthorized();

    disable();

    const myDepositAccount = getMyDepositAccount()!;
    const b = balanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount)!;
    const burner = newBurnerActor(agent()!);
    await burner.stake_kamikaze({ qty_e8s_u64: b - 10_000n });

    enable();

    fetchTotals();
    fetchBalanceOf(DEFAULT_TOKENS.icp, myDepositAccount.owner, myDepositAccount.subaccount);

    logInfo(`Successfully pledged ${E8s.new(b).toString()} ICP`);
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
    await burner.withdraw({ qty_e8s: b - 10_000n, to });

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
    const result = await burner.claim_reward({ to });

    if ("Err" in result) {
      logErr(ErrorCode.UNKNOWN, debugStringify(result.Err));
      enable();

      return;
    }

    enable();

    fetchTotals();
    logInfo(`Successfully claimed all BURN!`);
  };

  const fetchCanMigrateMsqAccount = async () => {
    assertAuthorized();

    const burner = newBurnerActor(agent()!);
    const result = await burner.can_migrate_msq_account();

    setCanMigrate(result);
  };

  const canMigrateMsqAccount = () => {
    if (!isAuthorized()) return false;
    if (!canMigrate()) return false;
    if (authProvider() === "II") return false;

    return true;
  };

  const migrateMsqAccount: IBurnerStoreContext["migrateMsqAccount"] = async () => {
    assertAuthorized();

    disable();

    try {
      const iiIdentity = await accessIiIdentity();

      const burner = newBurnerActor(agent()!);
      await burner.migrate_msq_account({ to: iiIdentity.getPrincipal() });

      await deauthorize();
      window.location.reload();
    } finally {
      enable();
    }
  };

  const accessIiIdentity = async () => {
    const client = iiClient();
    if (!client) {
      enable();
      err(ErrorCode.AUTH, "Uninitialized auth client");
    }

    const isAuthenticated = await client.isAuthenticated();

    if (isAuthenticated) {
      return client.getIdentity();
    }

    await new Promise((res, rej) =>
      client.login({
        identityProvider: iiFeHost(),
        onSuccess: res,
        onError: rej,
        maxTimeToLive: ONE_WEEK_NS,
      })
    );

    return client.getIdentity();
  };

  const canVerifyDecideId: IBurnerStoreContext["canVerifyDecideId"] = () => {
    if (!isAuthorized()) return false;

    const t = totals.data;
    if (!t) return false;

    const p = authProvider();
    if (p === "MSQ") return false;

    return !t.yourDecideIdVerificationStatus;
  };

  const verifyDecideId: IBurnerStoreContext["verifyDecideId"] = async () => {
    assertAuthorized();

    disable();

    try {
      const userPrincipal = identity()!.getPrincipal();

      const jwt: string = await new Promise((res, rej) => {
        requestVerifiablePresentation({
          onSuccess: async (verifiablePresentation: VerifiablePresentationResponse) => {
            if ("Ok" in verifiablePresentation) {
              res(verifiablePresentation.Ok);
            } else {
              rej(new Error(verifiablePresentation.Err));
            }
          },
          onError(err) {
            rej(new Error(err));
          },
          issuerData: {
            origin: "https://id.decideai.xyz",
            canisterId: Principal.fromText("qgxyr-pyaaa-aaaah-qdcwq-cai"),
          },
          credentialData: {
            credentialSpec: {
              credentialType: "ProofOfUniqueness",
              arguments: {},
            },
            credentialSubject: userPrincipal,
          },
          identityProvider: new URL(iiFeHost()),
        });
      });

      const burner = newBurnerActor(agent()!);
      await burner.verify_decide_id({ jwt });

      fetchTotals();
    } finally {
      enable();
    }
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

        kamikazePoolMembers,
        fetchKamikazePoolMembers,
        stakeKamikaze,

        canMigrateMsqAccount,
        migrateMsqAccount,
        canVerifyDecideId,
        verifyDecideId,
      }}
    >
      {props.children}
    </BurnerContext.Provider>
  );
}
