import { DistributionStartCondition } from "@/declarations/dispenser/dispenser.did";
import { Principal } from "@dfinity/principal";
import { err, ErrorCode } from "@utils/error";
import { EDs } from "@utils/math";
import { Fetcher, IChildren } from "@utils/types";
import { Accessor, createContext, useContext } from "solid-js";

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
  isStopped: boolean;
  isDistributing: boolean;
  initted: boolean;

  tokenCanisterId: Principal;
  tokenDecimals: number;
  tokenFee: bigint;

  curTick: bigint;
  prevTickTimestamp: bigint;
  tickDelayNs: bigint;
}

export interface IDispensersStoreContext {
  dispensers: Accessor<IDispenser[]>;
  fetchDispensers: Fetcher;
  fetchDispenserInfo: Fetcher;
  fetchActiveDistributions: Fetcher;
  fetchScheduledDistributions: Fetcher;
  fetchPastDistributions: Fetcher;

  unclaimedTokens: Accessor<EDs | undefined>;
  fetchUnclaimedTokens: Fetcher;
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
  return <DispensersContext.Provider value={{}}>{props.children}</DispensersContext.Provider>;
}
