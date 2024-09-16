import { HttpAgent, Identity, AnonymousIdentity, Agent, Actor, ActorMethod } from "@fort-major/agent-js-fork";
import { _SERVICE as BurnerActor, idlFactory as BurnerActorIdlFactory } from "../declarations/burner/burner.did";

export function newBurnerActor(agent: Agent): BurnerActor {
  return Actor.createActor(BurnerActorIdlFactory, {
    canisterId: import.meta.env.VITE_BURNER_CANISTER_ID,
    agent,
  });
}

export async function makeAgent(identity?: Identity | undefined, opts?: { mainnet?: boolean }): Promise<Agent> {
  const host = opts?.mainnet ? "https://icp-api.io" : import.meta.env.VITE_IC_HOST;

  const agent = new HttpAgent({
    host,
    identity,
    retryTimes: 10,
  });

  if (import.meta.env.DEV && !opts?.mainnet) {
    await agent.fetchRootKey();
  }

  return agent;
}

export async function makeAnonymousAgent(opts?: { mainnet: boolean }): Promise<Agent> {
  const id = new AnonymousIdentity();
  return makeAgent(id, opts);
}

export function optUnwrap<T>(it: [] | [T] | T[]): T | undefined {
  return it.length > 0 ? it[0] : undefined;
}

export function opt<T>(it: T | undefined): [] | [T] {
  return it !== undefined ? [it] : [];
}

export const icpSwapInfoIdl = ({ IDL }: any) => {
  const Data = IDL.Record({
    id: IDL.Nat,
    volumeUSD1d: IDL.Float64,
    volumeUSD7d: IDL.Float64,
    totalVolumeUSD: IDL.Float64,
    name: IDL.Text,
    volumeUSD: IDL.Float64,
    feesUSD: IDL.Float64,
    priceUSDChange: IDL.Float64,
    address: IDL.Text,
    txCount: IDL.Int,
    priceUSD: IDL.Float64,
    standard: IDL.Text,
    symbol: IDL.Text,
  });

  return IDL.Service({
    getAllTokens: IDL.Func([], [IDL.Vec(Data)], ["query"]),
  });
};

export interface IICPSwapInfoEntry {
  id: bigint;
  volumeUSD1d: number;
  volumeUSD7d: number;
  totalVolumeUSD: number;
  name: string;
  volumeUSD: number;
  feesUSD: number;
  priceUSDChange: number;
  address: string;
  txCount: bigint;
  priceUSD: number;
  standart: string;
  symbol: string;
}

export interface ICPSwapInfoActor {
  getAllTokens: ActorMethod<[], Array<IICPSwapInfoEntry>>;
}

export async function newICPSwapInfoActor() {
  const agent = await makeAnonymousAgent({ mainnet: true });

  return Actor.createActor<ICPSwapInfoActor>(icpSwapInfoIdl, { canisterId: "ggzvv-5qaaa-aaaag-qck7a-cai", agent });
}
