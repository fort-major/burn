import { BalanceOf } from "@components/balance-of";
import { Bento } from "@components/bento";
import { Btn } from "@components/btn";
import { Copyable } from "@components/copyable";
import { Spoiler } from "@components/spoiler";
import { Principal } from "@dfinity/principal";
import { useAuth } from "@store/auth";
import { IDistribution, useDispensers } from "@store/dispensers";
import { useTokens } from "@store/tokens";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { timestampToStr } from "@utils/encoding";
import { EDs } from "@utils/math";
import { IClass } from "@utils/types";
import { createEffect, createMemo, For, Match, on, onMount, Show, Switch } from "solid-js";

export interface IAirdropProps {
  dispenserCanId: Principal;
  tokenCanId: Principal;
}

export function Airdrop(props: IAirdropProps) {
  const { isAuthorized, isReadyToFetch } = useAuth();
  const {
    dispenserUnclaimedTokens,
    fetchDispenserUnclaimedTokens,
    claimDispenserUnclaimedTokens,
    distributionTriggerByTokenId,
    fetchDistributions,
    distributions,
    fetchDistributionTriggers,
    dispenserInfos,
    fetchDispenserInfo,
  } = useDispensers();
  const { metadata, fetchMetadata } = useTokens();

  const unclaimed = () => dispenserUnclaimedTokens[props.dispenserCanId.toText()];
  const meta = () => metadata[props.tokenCanId.toText()];
  const info = () => dispenserInfos[props.dispenserCanId.toText()];
  const scheduled = createMemo(
    () => Object.values(distributions[props.tokenCanId.toText()]?.Scheduled ?? []) as IDistribution[]
  );
  const inProgress = createMemo(
    () => Object.values(distributions[props.tokenCanId.toText()]?.InProgress ?? []) as IDistribution[]
  );

  onMount(() => {
    if (isReadyToFetch()) {
      if (!meta()) {
        fetchMetadata(props.tokenCanId);
      }

      if (!distributionTriggerByTokenId[props.tokenCanId.toText()]) {
        fetchDistributionTriggers();
      }

      fetchDispenserInfo(props.tokenCanId);
      fetchDistributions(props.tokenCanId, "Scheduled");
      fetchDistributions(props.tokenCanId, "InProgress");
    }
  });

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready) {
        if (!meta()) {
          fetchMetadata(props.tokenCanId);
        }

        if (!distributionTriggerByTokenId[props.tokenCanId.toText()]) {
          fetchDistributionTriggers();
        }

        fetchDispenserInfo(props.tokenCanId);
        fetchDistributions(props.tokenCanId, "Scheduled");
        fetchDistributions(props.tokenCanId, "InProgress");
      }
    })
  );

  onMount(() => {
    if (isAuthorized() && !unclaimed()) {
      fetchDispenserUnclaimedTokens(props.tokenCanId);
    }
  });

  createEffect(
    on(isAuthorized, (ready) => {
      if (ready && !unclaimed()) {
        fetchDispenserUnclaimedTokens(props.tokenCanId);
      }
    })
  );

  const canClaim = () => {
    const u = unclaimed();
    if (!u) return false;

    return !u.isZero();
  };

  const handleClaimClick = async () => {
    const u = unclaimed()!;

    await claimDispenserUnclaimedTokens(props.dispenserCanId, u);
    fetchDispenserUnclaimedTokens(props.dispenserCanId);
  };

  return (
    <Bento id={1} class="gap-5 flex-col justify-between">
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-3">
          <Show when={meta()} fallback={<Copyable text={props.tokenCanId.toText()} ellipsis ellipsisSymbols={20} />}>
            <img src={meta()!.logoSrc} class="w-7 h-7 rounded-full" />
            <p class="font-semibold text-xl">{meta()!.name}</p>
          </Show>
        </div>

        <Show when={info()}>
          <div class="flex-col gap-4">
            <p class="font-semibold text-xs text-gray-140">
              At tick #{info()!.curTick.toString()} ({timestampToStr(info()!.prevTickTimestamp)})
            </p>
          </div>
        </Show>

        <Show
          when={inProgress().length > 0}
          fallback={<p class="font-semibold text-gray-140 text-md">No in-progress distributions</p>}
        >
          <div class="flex flex-col">
            <For each={inProgress()}>
              {(d, idx) => <Distribution tokenCanId={props.tokenCanId} d={d} idx={idx()} />}
            </For>
          </div>
        </Show>

        <Show when={scheduled().length > 0}>
          <Spoiler header="Scheduled Distributions">
            <div class="flex flex-col">
              <For each={scheduled()}>
                {(d, idx) => <Distribution tokenCanId={props.tokenCanId} d={d} idx={idx()} />}
              </For>
            </div>
          </Spoiler>
        </Show>
      </div>

      <div class="flex flex-row gap-4 justify-between">
        <BalanceOf
          balance={unclaimed() ? unclaimed()!.toBigIntRaw() : 0n}
          tokenId={props.tokenCanId}
          onRefreshOverride={() => fetchDispenserUnclaimedTokens(props.tokenCanId)}
        />
        <Btn
          text={`Claim${meta() ? ` $${meta()!.ticker}` : ""}`}
          disabled={!canClaim()}
          onClick={handleClaimClick}
          bgColor={COLORS.orange}
          class="font-semibold"
        />
      </div>
    </Bento>
  );
}

export interface IDistributionProps {
  idx: number;
  d: IDistribution;
  tokenCanId: Principal;
}

export function Distribution(props: IDistributionProps) {
  const { distributionTriggerByTokenId } = useDispensers();
  const { metadata } = useTokens();

  const meta = () => metadata[props.tokenCanId.toText()];

  const trigger = () => distributionTriggerByTokenId[props.tokenCanId.toText()]?.[props.d.id.toString()];
  const triggerW = createMemo(() => {
    const t = trigger();
    if (!t) return undefined;
    if (!("AtFurnaceTrigger" in props.d.startCondition)) return undefined;

    if ("TokenXVotingWinner" in t) {
      const m = metadata[t.TokenXVotingWinner.toText()];
      if (!m) return undefined;

      return (
        <p class="text-gray-140 text-xs flex gap-1 items-center">
          starts if <img src={m.logoSrc} class="w-4 h-4 rounded-full" /> {m.ticker} is selected
        </p>
      );
    }

    if ("TokenTotalPledged" in t) {
      const m = metadata[t.TokenTotalPledged.token_can_id.toText()];
      if (!m) return undefined;

      const qty = EDs.new(t.TokenTotalPledged.threshold, m.fee.decimals);

      return (
        <p class="text-gray-140 text-xs flex gap-1 items-center">
          starts if{" "}
          <span class="font-semibold">{qty.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}</span>{" "}
          <img src={m.logoSrc} class="w-4 h-4 rounded-full" /> {m.ticker} is pledged
        </p>
      );
    }
  });

  return (
    <div
      class="flex flex-col gap-2 py-2 px-2"
      classList={{ "bg-gray-105": props.idx % 2 === 1, "bg-gray-110": props.idx % 2 === 0 }}
    >
      <div class="flex gap-1 justify-between">
        <p class="font-semibold text-md">{props.d.name}</p>
        <div class="flex items-center gap-1">
          <span class="font-semibold text-xs text-gray-140">by</span>{" "}
          <Copyable text={props.d.owner.toText()} ellipsis ellipsisSymbols={4} />
        </div>
      </div>
      <Show when={props.d.status === "Scheduled"}>
        <div class="flex flex-col gap-1">
          <Switch>
            <Match when={"AtTickDelay" in props.d.startCondition}>
              <p class="text-gray-140 text-xs">
                starts in {(props.d.startCondition as { AtTickDelay: bigint }).AtTickDelay.toString()} hours
              </p>
            </Match>
            <Match when={"AtFurnaceTrigger" in props.d.startCondition}>
              <Show when={triggerW()}>{triggerW()}</Show>
            </Match>
          </Switch>
        </div>
      </Show>

      <div class="flex items-center justify-between">
        <p class="font-semibold flex items-baseline gap-1">
          <span>
            <Show when={!props.d.isHidden || props.d.status === "InProgress"} fallback="???">
              {props.d.curTickReward.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
            </Show>
          </span>{" "}
          <span class="text-gray-140">{meta()!.ticker}</span> <span class="text-gray-140 text-xs">per hour</span>
        </p>
        <p class="flex font-semibold gap-2 items-baseline">
          <span class="text-xl">
            <Show when={!props.d.isHidden || props.d.status === "InProgress"} fallback="???">
              {props.d.leftoverQty.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
            </Show>{" "}
            /
          </span>{" "}
          <span class="text-xs text-gray-140">
            <Show when={!props.d.isHidden || props.d.status === "InProgress"} fallback="???">
              {props.d.scheduledQty.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
            </Show>
          </span>
        </p>
      </div>

      <div class="flex gap-1 justify-end text-[10px] leading-[10px]">
        <p>
          Pools{" "}
          <Show when={props.d.isDistributingToBonfire}>
            <span class="text-orange">+ Bonfire</span>
          </Show>
        </p>
      </div>
    </div>
  );
}
