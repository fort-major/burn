import { DistributionStartCondition } from "@/declarations/dispenser/dispenser.did";
import { Principal } from "@dfinity/principal";
import { err, ErrorCode, logInfo } from "@utils/error";
import { EDs } from "@utils/math";
import { Fetcher, IChildren } from "@utils/types";
import { Accessor, createContext, createEffect, on, useContext } from "solid-js";
import { createStore, Store } from "solid-js/store";
import { useAuth } from "./auth";
import { useWallet } from "./wallet";
import { newDispenserActor, newFurnaceActor, optUnwrap } from "@utils/backend";

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
  curTickReward: bigint;
  leftoverQty: bigint;
  scheduledQty: bigint;
  name: string;
  durationTicks: bigint;
  startCondition: DistributionStartCondition;
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

export interface IDispensersStoreContext {
  dispenserIds: Store<Partial<Record<string, Principal>>>;
  fetchDispenserIds: Fetcher;

  dispenserInfos: Store<Partial<Record<string, IDispenserInfo>>>;
  fetchDispenserInfo: (dispenserId: Principal) => Promise<void>;

  dispenserUnclaimedTokens: Store<Partial<Record<string, EDs>>>;
  fetchDispenserUnclaimedTokens: (dispenserId: Principal) => Promise<void>;
  claimDispenserUnclaimedTokens: (dispenserId: Principal, qty: EDs) => Promise<void>;
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
  const { pid, fetchPidBalance } = useWallet();

  const [dispenserIds, setDispenserIds] = createStore<IDispensersStoreContext["dispenserIds"]>();
  const [dispenserUnclaimedTokens, setDispenserUnclaimedTokens] =
    createStore<IDispensersStoreContext["dispenserUnclaimedTokens"]>();
  const [dispenserInfos, setDispenserInfos] = createStore<IDispensersStoreContext["dispenserInfos"]>();

  const fetchDispenserInfo: IDispensersStoreContext["fetchDispenserInfo"] = async (dispenserCanId: Principal) => {
    assertReadyToFetch();

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
      if (dispenserCanId.length === 0) continue;

      setDispenserIds(tokenCanId.toText(), dispenserCanId[0]);
    }
  };

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready) {
        fetchDispenserIds();
      }
    })
  );

  const fetchDispenserUnclaimedTokens: IDispensersStoreContext["fetchDispenserUnclaimedTokens"] = async (
    dispenserCanId: Principal
  ) => {
    assertAuthorized();

    const dispenser = newDispenserActor(dispenserCanId, agent()!);
    const tokens = await dispenser.get_unclaimed_tokens();
    const tokensEds = EDs.new(tokens.val, tokens.decimals);

    setDispenserUnclaimedTokens(dispenserCanId.toText(), tokensEds);
  };

  const claimDispenserUnclaimedTokens: IDispensersStoreContext["claimDispenserUnclaimedTokens"] = async (
    dispenserCanId: Principal,
    qty: EDs
  ) => {
    assertAuthorized();

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
      const [tokenCanId, _] = Object.entries(dispenserIds).find(
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
        dispenserIds,
        fetchDispenserIds,

        dispenserInfos,
        fetchDispenserInfo,

        dispenserUnclaimedTokens,
        fetchDispenserUnclaimedTokens,
        claimDispenserUnclaimedTokens,
      }}
    >
      {props.children}
    </DispensersContext.Provider>
  );
}
