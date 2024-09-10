import { HttpAgent, Identity, AnonymousIdentity, Agent, Actor } from "@fort-major/agent-js-fork";
import { _SERVICE as BurnerActor, idlFactory as BurnerActorIdlFactory } from "../declarations/burner/burner.did";

export function newBurnerActor(agent: Agent): BurnerActor {
  return Actor.createActor(BurnerActorIdlFactory, {
    canisterId: import.meta.env.VITE_BURNER_CANISTER_ID,
    agent,
  });
}

export async function makeAgent(identity?: Identity | undefined): Promise<Agent> {
  const agent = new HttpAgent({
    host: import.meta.env.VITE_IC_HOST,
    identity,
    retryTimes: 10,
  });

  if (import.meta.env.DEV) {
    await agent.fetchRootKey();
  }

  return agent;
}

export async function makeAnonymousAgent(): Promise<Agent> {
  const id = new AnonymousIdentity();
  return makeAgent(id);
}

export function optUnwrap<T>(it: [] | [T] | T[]): T | undefined {
  return it.length > 0 ? it[0] : undefined;
}

export function opt<T>(it: T | undefined): [] | [T] {
  return it !== undefined ? [it] : [];
}
