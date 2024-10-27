import { Avatar } from "@components/avatar";
import { Bento } from "@components/bento";
import { Btn } from "@components/btn";
import { Copyable } from "@components/copyable";
import { useFurnace } from "@store/furnace";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { avatarSrcFromPrincipal } from "@utils/common";
import { timestampToStr } from "@utils/encoding";
import { createEffect, createMemo, For, on, Show } from "solid-js";

export interface IRaffleRoundEntryProps {
  timestamp: bigint;
}

export function RaffleRoundEntry(props: IRaffleRoundEntryProps) {
  const { winners, fetchWinners } = useFurnace();
  const { metadata, fetchMetadata } = useTokens();
  const { pid, claimBonfireIcpReward, fetchPidBalance } = useWallet();

  const entry = () => winners[props.timestamp.toString()];
  const meta = () => (entry() ? metadata[entry()!.tokenCanisterId.toText()] : undefined);

  const w = createMemo(() => [...entry()?.winners.toReversed()]);

  createEffect(
    on(meta, (m) => {
      const e = entry();
      if (!e) return;

      if (!m) {
        fetchMetadata(e.tokenCanisterId);
      }
    })
  );

  const canClaim = () => {
    const e = entry();
    if (!e) return false;

    const winner = e.winners.find((w) => pid()?.compareTo(w.pid) === "eq" && !w.claimed);
    if (!winner) return false;

    return true;
  };

  const claim = async () => {
    const e = entry();
    if (!e) return;

    const winnerIdx = e.winners.findIndex((w) => pid()?.compareTo(w.pid) === "eq" && !w.claimed);
    if (winnerIdx === -1) return;

    await claimBonfireIcpReward(props.timestamp, winnerIdx);
    fetchWinners();
    fetchPidBalance(DEFAULT_TOKENS.icp);
  };

  return (
    <Bento class="flex-col gap-6" id={1}>
      <div class="flex justify-between items-center">
        <p class="font-semibold text-xs">Round {(entry()!.round + 1n).toString()}</p>
        <p class="text-xs text-gray-140">{timestampToStr(entry()!.timestampNs)}</p>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1">
          <p class="font-semibold text-xs text-gray-140">Prize Fund</p>
          <p class="font-semibold text-2xl">{entry()!.prizeFundICP.toDynamic().toDecimals(0).toString()} ICP</p>
        </div>

        <div class="flex flex-col gap-1">
          <p class="font-semibold text-xs text-gray-140">Pledged Total</p>
          <p class="font-semibold text-2xl">${entry()!.pledgedUsd.toDynamic().toDecimals(0).toString()}</p>
        </div>

        <div class="col-span-2 flex flex-col gap-1">
          <p class="font-semibold text-xs text-gray-140">Next Selected Token</p>
          <div class="flex items-center gap-2">
            <Show
              when={meta()}
              fallback={<Copyable text={entry()!.tokenCanisterId.toText()} ellipsis ellipsisSymbols={20} />}
            >
              <img src={meta()!.logoSrc} class="w-5 h-5 rounded-full" />
              <p class="font-semibold">{meta()!.name}</p>
              <p class="text-gray-140 relative top-[1px]">{meta()!.ticker}</p>
            </Show>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <p class="font-semibold text-sm text-gray-140">Winners</p>
        <div class="flex flex-col gap-1">
          <For each={w()}>
            {(w, idx) => (
              <div class="grid grid-cols-12 items-center gap-1">
                <p class="text-xs" classList={{ "text-gray-140": w.claimed }}>
                  {idx() + 1}
                </p>
                <Avatar
                  url={avatarSrcFromPrincipal(w.pid)}
                  size="sm"
                  borderColor={pid()?.compareTo(w.pid) === "eq" ? COLORS.chartreuse : COLORS.gray[140]}
                />
                <Copyable class="col-span-4" text={w.pid.toText()} ellipsis ellipsisSymbols={7} />
                <p class="col-span-2 text-xs font-semibold text-center">
                  {w.shareNormalized.toPercent().toShortString({ belowOne: 3, belowThousand: 1, afterThousand: 0 })}%
                </p>
                <p class="col-span-4 font-semibold text-xl text-right">
                  {w.prizeIcp.toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}{" "}
                  <span class="text-sm text-gray-140">ICP</span>
                </p>
              </div>
            )}
          </For>
        </div>
      </div>

      <Show when={canClaim()}>
        <Btn text="Claim Your Prize" class="font-semibold" bgColor={COLORS.orange} onClick={claim} />
      </Show>
    </Bento>
  );
}
