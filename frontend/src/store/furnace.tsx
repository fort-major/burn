import { GetCurRoundPositionsResponse, PledgeRequest } from "@/declarations/furnace/furnace.did";
import { Principal } from "@dfinity/principal";
import { err, ErrorCode, logInfo } from "@utils/error";
import { E8s, EDs } from "@utils/math";
import { Fetcher, IChildren } from "@utils/types";
import { Accessor, createContext, createEffect, createSignal, on, onMount, useContext } from "solid-js";
import { useAuth } from "./auth";
import { newFurnaceActor, optUnwrap } from "@utils/backend";
import { useWallet } from "./wallet";
import { useTokens } from "./tokens";

export interface IPosition {
  pid: Principal;
  usd: E8s;
  vp: E8s;
}

export interface IFurnaceInfo {
  curRoundPledgedUsd: E8s;
  curRoundPledgedBurnUsd: E8s;
  isLookingForWinners: boolean;
  icpWonTotal: E8s;
  currentRound: bigint;
  prevRoundTimestamp: bigint;
  totalPledgedUsd: E8s;
  roundDelayNs: bigint;
  devPid?: Principal;
  isOnMaintenance: boolean;
  curTokenX: Principal;
  winnerIcpThreshold: E8s;
}

export interface IFurnaceWinner {
  pid: Principal;
  claimed: boolean;
  prizeIcp: E8s;
}

export interface IFurnaceWinnerHistoryEntry {
  pledgedUsd: E8s;
  prizeFundICP: E8s;
  timestampNs: bigint;
  round: bigint;
  tokenCanisterId: Principal;
  winners: IFurnaceWinner[];
}

export interface ITokenXAlternative {
  tokenCanisterId: Principal;
  votes: E8s;
}

export interface IPledgeRequest {
  pid: Principal;
  qty: bigint;
  tokenCanId: Principal;
  downvote: boolean;
}

export type TTokenXVote = { tokenCanisterId: Principal; normalizedWeight: E8s }[];

export interface IMyShares {
  usd: E8s;
  votingPower: E8s;
}

export interface IFurnaceStoreContext {
  supportedTokens: Accessor<Principal[]>;
  fetchSupportedTokens: Fetcher;

  curRoundPositions: Accessor<IPosition[]>;
  fetchCurRoundPositions: Fetcher;

  info: Accessor<IFurnaceInfo | undefined>;
  fetchInfo: Fetcher;

  winners: Accessor<IFurnaceWinnerHistoryEntry[]>;
  fetchWinners: Fetcher;

  tokenXVotingAlternatives: Accessor<ITokenXAlternative[]>;
  fetchTokenXVotingAlternatives: Fetcher;

  pledge: (req: IPledgeRequest) => Promise<bigint>;
  voteTokenX: (vote: TTokenXVote) => Promise<void>;

  myVoteTokenX: Accessor<TTokenXVote | undefined>;
  fetchMyVoteTokenX: Fetcher;

  myShares: Accessor<IMyShares | undefined>;
  fetchMyShares: Fetcher;
}

const FurnaceContext = createContext<IFurnaceStoreContext>();

export function useFurnace(): IFurnaceStoreContext {
  const ctx = useContext(FurnaceContext);

  if (!ctx) {
    err(ErrorCode.UNREACHEABLE, "Furnace context is not initialized");
  }

  return ctx;
}

export function FurnaceStore(props: IChildren) {
  const { assertReadyToFetch, isReadyToFetch, assertAuthorized, anonymousAgent, agent, disable, enable } = useAuth();
  const { metadata, fetchMetadata } = useTokens();
  const { fetchBonfireBalance } = useWallet();

  const [curRoundPositions, setCurRoundPositions] = createSignal<IPosition[]>([]);
  const [fetchingPositions, setFetchingPositions] = createSignal(false);

  const [supportedTokens, setSupportedTokens] = createSignal<Principal[]>([]);
  const [info, setInfo] = createSignal<IFurnaceInfo>();
  const [winners, setWinners] = createSignal<IFurnaceWinnerHistoryEntry[]>([]);
  const [tokenXVotingAlternatives, setTokenXVotingAlternatives] = createSignal<ITokenXAlternative[]>([]);
  const [myShares, setMyShares] = createSignal<IMyShares>();
  const [myVoteTokenX, setMyVoteTokenX] = createSignal<TTokenXVote>();

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready) {
        fetchInfo();
        fetchSupportedTokens();
        fetchTokenXVotingAlternatives();
      }
    })
  );

  onMount(() => {
    if (isReadyToFetch()) {
      fetchInfo();
      fetchSupportedTokens();
      fetchTokenXVotingAlternatives();
    }
  });

  createEffect(
    on(supportedTokens, (tokens) => {
      for (let token of tokens) {
        if (!metadata[token.toText()]) {
          fetchMetadata(token);
        }
      }
    })
  );

  const fetchMyVoteTokenX: IFurnaceStoreContext["fetchMyVoteTokenX"] = async () => {
    assertAuthorized();

    const furnace = newFurnaceActor(agent()!);
    const vote = optUnwrap(await furnace.get_my_vote_token_x());

    const myVote: TTokenXVote | undefined = vote?.can_ids_and_normalized_weights.map((it) => ({
      tokenCanisterId: it[0],
      normalizedWeight: E8s.new(it[1]),
    }));

    setMyVoteTokenX(myVote);
  };

  const fetchMyShares: IFurnaceStoreContext["fetchMyShares"] = async () => {
    assertAuthorized();

    const furnace = newFurnaceActor(agent()!);
    const [usd, usdBurn] = await furnace.get_my_cur_round_positions();

    const shares: IMyShares = {
      usd: E8s.new(usd),
      votingPower: E8s.new(usdBurn),
    };

    setMyShares(shares);
  };

  const fetchSupportedTokens: IFurnaceStoreContext["fetchSupportedTokens"] = async () => {
    assertReadyToFetch();

    const furnace = newFurnaceActor(anonymousAgent()!);
    const response = await furnace.list_supported_tokens();

    setSupportedTokens(response.map((it) => it.can_id));
  };

  const fetchCurRoundPositions: IFurnaceStoreContext["fetchCurRoundPositions"] = async () => {
    assertReadyToFetch();

    if (fetchingPositions()) {
      return;
    } else {
      setFetchingPositions(true);
    }

    setCurRoundPositions([]);

    const furnace = newFurnaceActor(anonymousAgent()!);

    const take = 100;
    let skip: [] | [Principal] = [];

    while (true) {
      const resp: GetCurRoundPositionsResponse = await furnace.get_cur_round_positions({ take: BigInt(take), skip });
      const positions: IPosition[] = [];

      for (let p of resp.positions) {
        skip = [p.pid];
        positions.push({ pid: p.pid, usd: E8s.new(p.usd), vp: E8s.new(p.vp) });
      }

      setCurRoundPositions((t) =>
        [...t, ...positions].toSorted((a, b) => (a.usd.gt(b.usd) ? -1 : a.usd.lt(b.usd) ? 1 : 0))
      );

      if (resp.positions.length < take) {
        break;
      }
    }

    setFetchingPositions(false);
  };

  const fetchInfo: IFurnaceStoreContext["fetchInfo"] = async () => {
    assertReadyToFetch();

    const furnace = newFurnaceActor(anonymousAgent()!);

    const resp = await furnace.get_furnace_info();

    const info: IFurnaceInfo = {
      curRoundPledgedUsd: E8s.new(resp.cur_round_pledged_usd),
      curRoundPledgedBurnUsd: E8s.new(resp.cur_round_pledged_burn_usd),
      isLookingForWinners: resp.is_looking_for_winners,
      icpWonTotal: E8s.new(resp.icp_won_total),
      currentRound: resp.current_round,
      prevRoundTimestamp: resp.prev_round_timestamp,
      totalPledgedUsd: E8s.new(resp.total_pledged_usd),
      roundDelayNs: resp.round_delay,
      devPid: optUnwrap(resp.dev_pid),
      isOnMaintenance: resp.is_on_maintenance,
      curTokenX: resp.cur_token_x.can_id,
      winnerIcpThreshold: E8s.new(resp.winner_icp_threshold),
    };

    setInfo(info);
  };

  const fetchWinners: IFurnaceStoreContext["fetchWinners"] = async () => {
    assertReadyToFetch();

    const furnace = newFurnaceActor(anonymousAgent()!);

    setWinners([]);

    const take = 100;
    let skip = 0;

    while (true) {
      const resp = await furnace.get_winners({ take: BigInt(take), skip: BigInt(skip) });

      const winners: IFurnaceWinnerHistoryEntry[] = resp.winners.map((it) => {
        const w: IFurnaceWinner[] = it.winners.map((it) => ({
          pid: it.pid,
          claimed: it.claimed,
          prizeIcp: E8s.new(it.prize_icp),
        }));

        return {
          pledgedUsd: E8s.new(it.pledged_usd),
          prizeFundICP: E8s.new(it.prize_fund_icp),
          timestampNs: it.timestamp,
          round: it.round,
          tokenCanisterId: it.token_can_id,
          winners: w,
        };
      });

      setWinners((t) => [...t, ...winners]);

      if (resp.winners.length < take) {
        break;
      }
    }
  };

  const fetchTokenXVotingAlternatives: IFurnaceStoreContext["fetchTokenXVotingAlternatives"] = async () => {
    assertReadyToFetch();

    const furnace = newFurnaceActor(anonymousAgent()!);

    const response = await furnace.list_token_x_alternatives();
    const alternatives: ITokenXAlternative[] = response.map((it) => ({
      tokenCanisterId: it[0],
      votes: E8s.new(it[1]),
    }));

    setTokenXVotingAlternatives(alternatives);
  };

  const pledge: IFurnaceStoreContext["pledge"] = async (req: IPledgeRequest) => {
    assertAuthorized();

    disable();

    try {
      const furnace = newFurnaceActor(agent()!);

      const request = {
        token_can_id: req.tokenCanId,
        pid: req.pid,
        downvote: req.downvote,
        qty: req.qty,
      };
      const resp = await furnace.pledge(request);

      return resp.pledge_value_usd;
    } finally {
      fetchBonfireBalance(req.tokenCanId);
      enable();
    }
  };

  const voteTokenX: IFurnaceStoreContext["voteTokenX"] = async (req: TTokenXVote) => {
    assertAuthorized();

    disable();

    try {
      const furnace = newFurnaceActor(agent()!);

      await furnace.vote_token_x({
        vote: {
          can_ids_and_normalized_weights: req.map((it) => [it.tokenCanisterId, it.normalizedWeight.toBigIntRaw()]),
        },
      });

      logInfo(`Successfully voted for the next bonfire token!`);
    } finally {
      enable();
    }
  };

  return (
    <FurnaceContext.Provider
      value={{
        supportedTokens,
        fetchSupportedTokens,

        curRoundPositions,
        fetchCurRoundPositions,

        info,
        fetchInfo,

        winners,
        fetchWinners,

        tokenXVotingAlternatives,
        fetchTokenXVotingAlternatives,

        pledge,
        voteTokenX,
        myVoteTokenX,
        fetchMyVoteTokenX,

        myShares,
        fetchMyShares,
      }}
    >
      {props.children}
    </FurnaceContext.Provider>
  );
}
