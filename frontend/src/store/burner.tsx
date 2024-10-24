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
import { useWallet } from "./wallet";

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

  canPledgePool: () => boolean;
  pledgePool: (isKamikaze: boolean, qty: bigint) => Promise<void>;

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
  const { fetchSubaccountOf, balanceOf, fetchBalanceOf } = useTokens();
  const { pidBalance, fetchPidBalance, fetchPoolBalance, moveIcpToPoolAccount } = useWallet();

  const [totals, setTotals] = createStore<IBurnerStoreContext["totals"]>();
  const [poolMembers, setPoolMembers] = createSignal<IPoolMember[]>([]);
  const [kamikazePoolMembers, setKamikazePoolMembers] = createSignal<IKamikazePoolMember[]>([]);
  const [int, setInt] = createSignal<NodeJS.Timeout>();
  const [canMigrate, setCanMigrate] = createSignal(false);
  const [fetchingPoolMembers, setFetchingPoolMembers] = createSignal(false);
  const [fetchingKamikazePoolMembers, setFetchingKamikazePoolMembers] = createSignal(false);

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

    if (fetchingPoolMembers()) {
      return;
    } else {
      setFetchingPoolMembers(true);
    }

    let start: [] | [Principal] = [];
    setPoolMembers([]);

    const burner = newBurnerActor(anonymousAgent()!);

    while (true) {
      const { entries } = await burner.get_burners({ start, take: 1000 });
      const members: IPoolMember[] = [];

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

      setPoolMembers((m) => {
        return [...m, ...members].sort((a, b) => {
          if (a.share.gt(b.share)) {
            return -1;
          } else if (a.share.lt(b.share)) {
            return 1;
          } else {
            return 0;
          }
        });
      });

      if (entries.length < 1000) {
        break;
      }
    }

    setFetchingPoolMembers(false);
  };

  const fetchKamikazePoolMembers: IBurnerStoreContext["fetchKamikazePoolMembers"] = async () => {
    assertReadyToFetch();

    if (fetchingKamikazePoolMembers()) {
      return;
    } else {
      setFetchingKamikazePoolMembers(true);
    }

    let start: [] | [Principal] = [];
    setKamikazePoolMembers([]);

    const burner = newBurnerActor(anonymousAgent()!);

    while (true) {
      const { entries } = await burner.get_kamikazes({ start, take: 1000 });
      const members: IKamikazePoolMember[] = [];

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

      setKamikazePoolMembers((m) => {
        return [...m, ...members].sort((a, b) => {
          if (a.share.gt(b.share)) {
            return -1;
          } else if (a.share.lt(b.share)) {
            return 1;
          } else {
            return 0;
          }
        });
      });

      if (entries.length < 1000) {
        break;
      }
    }

    setFetchingKamikazePoolMembers(false);
  };

  const canPledgePool: IBurnerStoreContext["canPledgePool"] = () => {
    const b = pidBalance(DEFAULT_TOKENS.icp);
    if (!b) return false;
    if (b < 1000_0000n) return false;

    return true;
  };

  const pledgePool: IBurnerStoreContext["pledgePool"] = async (isKamikaze: boolean, qty: bigint) => {
    assertAuthorized();

    disable();

    try {
      await moveIcpToPoolAccount(qty);

      const burner = newBurnerActor(agent()!);

      if (isKamikaze) {
        await burner.stake_kamikaze({ qty_e8s_u64: qty - 10_000n });
      } else {
        await burner.stake({ qty_e8s_u64: qty - 10_000n });
      }
    } finally {
      fetchTotals();
      fetchPidBalance(DEFAULT_TOKENS.icp);
      fetchPoolBalance(DEFAULT_TOKENS.icp);

      logInfo(`Successfully pledged ${E8s.new(qty).toString()} ICP`);

      enable();
    }
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

        kamikazePoolMembers,
        fetchKamikazePoolMembers,

        canPledgePool,
        pledgePool,

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
