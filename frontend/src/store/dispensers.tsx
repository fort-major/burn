import {
  Account,
  DistributionStartCondition,
  DistributionStatus,
  GetDistributionsResponse,
} from "@/declarations/dispenser/dispenser.did";
import { Principal } from "@dfinity/principal";
import { err, ErrorCode, logInfo } from "@utils/error";
import { EDs } from "@utils/math";
import { Fetcher, IChildren, TPrincipalStr } from "@utils/types";
import { Accessor, createContext, createEffect, on, useContext } from "solid-js";
import { createStore, produce, Store } from "solid-js/store";
import { useAuth } from "./auth";
import { useWallet } from "./wallet";
import { newDispenserActor, newFurnaceActor, opt, optUnwrap } from "@utils/backend";
import { delay } from "@fort-major/msq-shared";
import { DEFAULT_TOKENS, useTokens } from "./tokens";
import { IcrcLedgerCanister } from "@dfinity/ledger-icrc";

export interface IDispenser {
  tokenId: Principal;
  canisterId: Principal;
  isCreated: boolean;

  info?: IDispenserInfo;

  activeDistributions?: IDistribution[];
  scheduledDistributions?: IDistribution[];
  pastDistributions?: IDistribution[];
}

export type TDistributionStatus = "Scheduled" | "InProgress" | "Canceled" | "Completed";
export type TDistributionScheme = "Linear" | "Logarithmic";

export interface IDistribution {
  id: bigint;
  status: TDistributionStatus;
  owner: Principal;
  scheme: TDistributionScheme;
  curTickReward: EDs;
  leftoverQty: EDs;
  scheduledQty: EDs;
  name: string;
  durationTicks: bigint;
  startCondition: DistributionStartCondition;
  isHidden: boolean;
  isDistributingToBonfire: boolean;
}

export interface IDispenserInfo {
  initted: boolean;

  tokenCanisterId?: Principal;
  tokenDecimals: number;
  tokenFee: bigint;

  curTick: bigint;
  prevTickTimestamp: bigint;
  tickDelayNs: bigint;
}

export type TDistributionIdStr = string;

export type TDistributionTrigger =
  | { TokenXVotingWinner: Principal }
  | {
      TokenTotalPledged: {
        token_can_id: Principal;
        threshold: bigint;
      };
    };

export interface IDispensersStoreContext {
  // indexed by distributing token Id
  dispenserIdByTokenId: Store<Partial<Record<TPrincipalStr, Principal>>>;
  fetchDispenserIds: Fetcher;

  dispenserInfos: Store<Partial<Record<TPrincipalStr, IDispenserInfo>>>;
  fetchDispenserInfo: (tokenCanId: Principal) => Promise<void>;

  dispenserUnclaimedTokens: Store<Partial<Record<TPrincipalStr, EDs>>>;
  fetchDispenserUnclaimedTokens: (tokenCanId: Principal) => Promise<void>;
  claimDispenserUnclaimedTokens: (tokenCanId: Principal, qty: EDs) => Promise<void>;

  canCreateDispenser: (tokenCanId: Principal) => boolean;
  createDispenser: (tokenCanId: Principal) => Promise<void>;

  distributions: Store<
    Partial<
      Record<TPrincipalStr, Partial<Record<TDistributionStatus, Partial<Record<TDistributionIdStr, IDistribution>>>>>
    >
  >;
  getDistribution: (tokenCanId: Principal, status: TDistributionStatus, id: bigint) => IDistribution | undefined;
  fetchDistributions: (tokenCanId: Principal, status: TDistributionStatus) => Promise<void>;

  distributionTriggerByTokenId: Store<Partial<Record<TPrincipalStr, Record<TDistributionIdStr, TDistributionTrigger>>>>;
  fetchDistributionTriggers: Fetcher;

  createDistribution: (
    tokenCanId: Principal,
    qty: bigint,
    name: string,
    durationTicks: bigint,
    startOnTickDelay?: bigint,
    isHidden?: boolean
  ) => Promise<bigint>;

  createDistributionTrigger: (
    tokenCanId: Principal,
    distributionId: bigint,
    trigger: TDistributionTrigger
  ) => Promise<void>;

  canCancelDistribution: (tokenCanId: Principal, distributionId: bigint) => boolean;
  cancelDistribution: (tokenCanId: Principal, distributionId: bigint) => Promise<void>;

  dispenserAccount: (dispenserTokenCanId: Principal) => Account | undefined;

  dispenserAccountBalance: (dispenserTokenCanId: Principal, tokenCanId: Principal) => bigint | undefined;
  fetchDispenserAccountBalance: (dispenserTokenCanId: Principal, tokenCanId: Principal) => Promise<void>;

  moveToDispenserAccount: (dispenserTokenCanId: Principal, isIcp: boolean, qty: bigint) => Promise<bigint>;
  withdrawFromDispenserAccount: (dispenserTokenCanId: Principal, isIcp: boolean, qty: bigint) => Promise<bigint>;
}

const DispensersContext = createContext<IDispensersStoreContext>();

export function useDispensers(): IDispensersStoreContext {
  const ctx = useContext(DispensersContext);

  if (!ctx) {
    err(ErrorCode.UNREACHEABLE, "Dispensers context is not initialized");
  }

  return ctx;
}

export function DispensersStore(props: IChildren) {
  const { assertReadyToFetch, isReadyToFetch, assertAuthorized, anonymousAgent, agent, enable, disable } = useAuth();
  const { pid, pidBalance, fetchPidBalance, moveToBonfireAccount, subaccount } = useWallet();
  const { balanceOf, fetchBalanceOf, metadata, fetchMetadata } = useTokens();

  const [dispenserIdByTokenId, setDispenserIdByTokenId] =
    createStore<IDispensersStoreContext["dispenserIdByTokenId"]>();

  const [dispenserUnclaimedTokens, setDispenserUnclaimedTokens] =
    createStore<IDispensersStoreContext["dispenserUnclaimedTokens"]>();
  const [dispenserInfos, setDispenserInfos] = createStore<IDispensersStoreContext["dispenserInfos"]>();
  const [distributions, setDistributions] = createStore<IDispensersStoreContext["distributions"]>();
  const [distributionTriggers, setDistributionTriggers] =
    createStore<IDispensersStoreContext["distributionTriggerByTokenId"]>();

  createEffect(
    on(isReadyToFetch, async (ready) => {
      if (ready) {
        fetchDistributionTriggers();
        await fetchDispenserIds();

        for (let id of Object.keys(dispenserIdByTokenId).map((it) => Principal.from(it))) {
          fetchDistributions(id, "Scheduled");
          fetchDistributions(id, "InProgress");

          const m = metadata[id.toText()];
          if (!m) {
            fetchMetadata(id);
          }
        }
      }
    })
  );

  const fetchDistributionTriggers: IDispensersStoreContext["fetchDistributionTriggers"] = async () => {
    assertReadyToFetch();

    const furnace = newFurnaceActor(anonymousAgent()!);

    let start: [] | [bigint] = [];
    const take = 100n;

    while (true) {
      const resp = await furnace.get_distribution_triggers({ start, take });

      for (let trigger of resp.triggers) {
        setDistributionTriggers(
          produce((s) => {
            if (!s[trigger.dispenser_token_can_id.toText()]) {
              s[trigger.dispenser_token_can_id.toText()] = { [trigger.distribution_id.toString()]: trigger.kind };
            } else {
              s[trigger.dispenser_token_can_id.toText()]![trigger.distribution_id.toString()] = trigger.kind;
            }
          })
        );
      }

      if (resp.triggers.length < Number(take)) {
        break;
      }
    }
  };

  const fetchDistributions: IDispensersStoreContext["fetchDistributions"] = async (
    tokenCanId: Principal,
    status: TDistributionStatus
  ) => {
    assertReadyToFetch();

    const tokenCanIdText = tokenCanId.toText();
    setDistributions(
      produce((s) => {
        if (!s[tokenCanIdText]) {
          s[tokenCanIdText] = { [status]: {} };
        } else {
          s[tokenCanIdText][status] = {};
        }
      })
    );

    const dispenserCanId = dispenserIdByTokenId[tokenCanIdText]!;
    const dispenser = newDispenserActor(dispenserCanId, anonymousAgent()!);

    let skip: [] | [bigint] = [];
    const take = 100n;

    while (true) {
      const resp: GetDistributionsResponse = await dispenser.get_distributions({
        skip,
        take,
        status: { [status]: null } as DistributionStatus,
      });

      for (let d of resp.distributions) {
        const iDistribution: IDistribution = {
          id: d.id,
          name: d.name,
          owner: d.owner,
          status: Object.keys(d.status)[0] as TDistributionStatus,
          scheme: Object.keys(d.scheme)[0] as TDistributionScheme,
          startCondition: d.start_condition,
          scheduledQty: EDs.new(d.scheduled_qty.val, d.scheduled_qty.decimals),
          leftoverQty: EDs.new(d.leftover_qty.val, d.leftover_qty.decimals),
          curTickReward: EDs.new(d.cur_tick_reward.val, d.cur_tick_reward.decimals),
          durationTicks: d.duration_ticks,
          isHidden: d.hidden,
          isDistributingToBonfire: d.distribute_to_bonfire,
        };

        skip = [d.id];

        setDistributions(tokenCanIdText, status, iDistribution.id.toString(), iDistribution);
      }

      if (resp.distributions.length < Number(take)) {
        break;
      }
    }
  };

  const getDistribution: IDispensersStoreContext["getDistribution"] = (
    tokenCanId: Principal,
    status: TDistributionStatus,
    id: bigint
  ) => {
    return distributions[tokenCanId.toText()]?.[status]?.[id.toString()];
  };

  const dispenserAccount: IDispensersStoreContext["dispenserAccount"] = (dispenserTokenCanId: Principal) => {
    const s = subaccount();
    if (!s) return undefined;

    const id = dispenserIdByTokenId[dispenserTokenCanId.toText()];
    if (!id) return undefined;

    return { owner: id, subaccount: [s] };
  };

  const dispenserAccountBalance: IDispensersStoreContext["dispenserAccountBalance"] = (
    dispenserTokenCanId: Principal,
    tokenCanId: Principal
  ) => {
    const acc = dispenserAccount(dispenserTokenCanId);
    if (!acc) return undefined;

    return balanceOf(tokenCanId, acc.owner, acc.subaccount[0] as Uint8Array);
  };

  const fetchDispenserAccountBalance: IDispensersStoreContext["fetchDispenserAccountBalance"] = (
    dispenserTokenCanId: Principal,
    tokenCanId: Principal
  ) => {
    const acc = dispenserAccount(dispenserTokenCanId);
    if (!acc) return Promise.resolve();

    return fetchBalanceOf(tokenCanId, acc.owner, acc.subaccount[0] as Uint8Array);
  };

  const moveToDispenserAccount: IDispensersStoreContext["moveToDispenserAccount"] = async (
    dispenserTokenCanId: Principal,
    isIcp: boolean,
    qty: bigint
  ) => {
    err(ErrorCode.UNKNOWN, "Temporarily unavailable");
    assertAuthorized();

    const acc = dispenserAccount(dispenserTokenCanId);
    if (!acc) {
      err(ErrorCode.UNREACHEABLE, "Dispenser account is not initted");
    }

    const tokenCanId = isIcp ? DEFAULT_TOKENS.icp : dispenserTokenCanId;

    const icp = IcrcLedgerCanister.create({ canisterId: tokenCanId, agent: agent()! });
    const blockIdx = await icp.transfer({
      to: acc,
      amount: qty,
    });

    fetchDispenserAccountBalance(dispenserTokenCanId, tokenCanId);
    fetchPidBalance(tokenCanId);

    return blockIdx;
  };

  const withdrawFromDispenserAccount: IDispensersStoreContext["withdrawFromDispenserAccount"] = async (
    dispenserTokenCanId: Principal,
    isIcp: boolean,
    qty: bigint
  ) => {
    assertAuthorized();

    const dispenserCanId = dispenserIdByTokenId[dispenserTokenCanId.toText()]!;
    const dispenser = newDispenserActor(dispenserCanId, agent()!);

    const resp = await dispenser.withdraw_user_tokens({ icp: isIcp, to: { owner: pid()!, subaccount: [] }, qty });

    return resp.block_idx;
  };

  const createDistribution: IDispensersStoreContext["createDistribution"] = async (
    tokenCanId: Principal,
    qty: bigint,
    name: string,
    durationTicks: bigint,
    startOnTickDelay?: bigint,
    isHidden?: boolean
  ) => {
    err(ErrorCode.UNKNOWN, "Temporarily unavailable");
    assertAuthorized();

    disable();

    try {
      logInfo("Depositing ICP fee and the dispensing token...");

      await Promise.all([
        moveToDispenserAccount(tokenCanId, true, 1_0000_0000n),
        moveToDispenserAccount(tokenCanId, false, qty),
      ]);

      const id = dispenserIdByTokenId[tokenCanId.toText()]!;

      logInfo("Success. Creating the airdrop...");

      const dispenser = newDispenserActor(id, agent()!);
      const { distribution_id } = await dispenser.create_distribution({
        name: name.trim(),
        qty,
        start_condition:
          startOnTickDelay !== undefined ? { AtTickDelay: startOnTickDelay } : { AtFurnaceTrigger: null },
        duration_ticks: durationTicks,
        hidden: !!isHidden,
        distribute_to_bonfire: true,
        scheme: { Linear: null },
      });

      logInfo(`Distribution #${distribution_id} is created!`);

      fetchDistributions(tokenCanId, "Scheduled");

      return distribution_id;
    } finally {
      enable();
    }
  };

  const createDistributionTrigger: IDispensersStoreContext["createDistributionTrigger"] = async (
    tokenCanId: Principal,
    distributionId: bigint,
    trigger: TDistributionTrigger
  ) => {
    err(ErrorCode.UNKNOWN, "Temporarily unavailable");
    assertAuthorized();

    disable();

    try {
      logInfo(`Creating the trigger...`);

      const furnace = newFurnaceActor(agent()!);
      await furnace.create_distribution_trigger({
        trigger: { dispenser_token_can_id: tokenCanId, distribution_id: distributionId, kind: trigger },
      });

      fetchDistributionTriggers();

      logInfo(`Success!`);
    } finally {
      enable();
    }
  };

  const canCancelDistribution: IDispensersStoreContext["canCancelDistribution"] = (
    tokenCanId: Principal,
    distributionId: bigint
  ) => {
    const p = pid();
    if (!p) return false;

    const distribution = getDistribution(tokenCanId, "Scheduled", distributionId);
    if (!distribution) return false;

    if (distribution.owner.compareTo(p) !== "eq") return false;
    if ("AtTickDelay" in distribution.startCondition && distribution.startCondition.AtTickDelay < 3n) return false;

    return true;
  };

  const cancelDistribution: IDispensersStoreContext["cancelDistribution"] = async (
    tokenCanId: Principal,
    distributionId: bigint
  ) => {
    assertAuthorized();

    const dispenserId = dispenserIdByTokenId[tokenCanId.toText()];
    const dispenser = newDispenserActor(dispenserId!, agent()!);

    disable();

    try {
      await dispenser.cancel_distribution({ distribution_id: distributionId });

      fetchDistributions(tokenCanId, "Scheduled");
      fetchDistributions(tokenCanId, "Canceled");
    } finally {
      enable();
    }
  };

  const canCreateDispenser: IDispensersStoreContext["canCreateDispenser"] = (tokenCanId: Principal) => {
    const balance = pidBalance(DEFAULT_TOKENS.icp);
    if (!balance) return false;
    if (balance < 1_0000_0000n) return false;

    const id = dispenserIdByTokenId[tokenCanId.toText()];
    if (id) return false;

    return true;
  };

  const createDispenser: IDispensersStoreContext["createDispenser"] = async (tokenCanId: Principal) => {
    err(ErrorCode.UNKNOWN, "Temporarily unavailable");
    assertAuthorized();

    disable();

    try {
      logInfo("Depositing ICP dispenser creation fee...");

      await moveToBonfireAccount(DEFAULT_TOKENS.icp, 1_0000_0000n);

      logInfo("Success. Sending the dispenser creation request...");

      const furnace = newFurnaceActor(agent()!);
      await furnace.deploy_dispenser({ token_can_id: tokenCanId });

      logInfo("The request is sent. Waiting for canister creation...");
      let id: Principal | undefined = undefined;

      while (true) {
        await delay(2000);

        await fetchDispenserIds();
        id = dispenserIdByTokenId[tokenCanId.toText()];

        if (id) {
          break;
        }
      }

      logInfo("The canister is created. Waiting for the initialization...");

      while (true) {
        await delay(2000);

        await fetchDispenserInfo(tokenCanId);
        const info = dispenserInfos[id.toText()];

        if (info?.initted) {
          break;
        }
      }

      logInfo("The dispenser is created!");
    } finally {
      enable();
    }
  };

  const fetchDispenserInfo: IDispensersStoreContext["fetchDispenserInfo"] = async (tokenCanId: Principal) => {
    assertReadyToFetch();

    const dispenserCanId = dispenserIdByTokenId[tokenCanId.toText()]!;

    const dispenser = newDispenserActor(dispenserCanId, anonymousAgent()!);
    const info = await dispenser.get_info();

    const iInfo: IDispenserInfo = {
      curTick: info.cur_tick,
      initted: info.initted,
      prevTickTimestamp: info.prev_tick_timestamp,
      tickDelayNs: info.tick_delay_ns,
      tokenCanisterId: optUnwrap(info.token_can_id),
      tokenDecimals: info.token_decimals,
      tokenFee: info.token_fee,
    };

    setDispenserInfos(dispenserCanId.toText(), iInfo);
  };

  const fetchDispenserIds: IDispensersStoreContext["fetchDispenserIds"] = async () => {
    assertReadyToFetch();

    const furnace = newFurnaceActor(anonymousAgent()!);
    const resp = await furnace.list_dispensers();

    for (let [tokenCanId, dispenserCanId] of resp) {
      if (dispenserCanId.length === 1) {
        setDispenserIdByTokenId(tokenCanId.toText(), dispenserCanId[0]);
      }
    }
  };

  const fetchDispenserUnclaimedTokens: IDispensersStoreContext["fetchDispenserUnclaimedTokens"] = async (
    tokenCanId: Principal
  ) => {
    assertAuthorized();

    const dispenserCanId = dispenserIdByTokenId[tokenCanId.toText()]!;

    const dispenser = newDispenserActor(dispenserCanId, agent()!);
    const tokens = await dispenser.get_unclaimed_tokens();
    const tokensEds = EDs.new(tokens.val, tokens.decimals);

    setDispenserUnclaimedTokens(dispenserCanId.toText(), tokensEds);
  };

  const claimDispenserUnclaimedTokens: IDispensersStoreContext["claimDispenserUnclaimedTokens"] = async (
    tokenCanId: Principal,
    qty: EDs
  ) => {
    assertAuthorized();

    const dispenserCanId = dispenserIdByTokenId[tokenCanId.toText()]!;

    disable();

    try {
      const dispenser = newDispenserActor(dispenserCanId, agent()!);
      const resp = await dispenser.claim_tokens({
        qty: { val: qty.val, decimals: qty.decimals },
        to: { owner: pid()!, subaccount: [] },
      });

      if ("Err" in resp.result) {
        err(ErrorCode.UNKNOWN, resp.result.Err);
      }
    } finally {
      const [tokenCanId, _] = Object.entries(dispenserIdByTokenId).find(
        ([_, _dispenserCanId]) => _dispenserCanId!.compareTo(dispenserCanId) === "eq"
      )!;
      await fetchPidBalance(Principal.fromText(tokenCanId));

      logInfo("Successfully claimed!");

      enable();
    }
  };

  return (
    <DispensersContext.Provider
      value={{
        dispenserIdByTokenId,
        fetchDispenserIds,

        dispenserInfos,
        fetchDispenserInfo,

        dispenserUnclaimedTokens,
        fetchDispenserUnclaimedTokens,
        claimDispenserUnclaimedTokens,

        canCreateDispenser,
        createDispenser,

        createDistribution,

        canCancelDistribution,
        cancelDistribution,

        dispenserAccount,
        dispenserAccountBalance,
        fetchDispenserAccountBalance,

        moveToDispenserAccount,
        withdrawFromDispenserAccount,

        distributions,
        fetchDistributions,
        getDistribution,

        createDistributionTrigger,

        distributionTriggerByTokenId: distributionTriggers,
        fetchDistributionTriggers,
      }}
    >
      {props.children}
    </DispensersContext.Provider>
  );
}
