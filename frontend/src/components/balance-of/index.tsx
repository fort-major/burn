import { EIconKind, Icon } from "@components/icon";
import { Principal } from "@dfinity/principal";
import { useAuth } from "@store/auth";
import { useTokens } from "@store/tokens";
import { COLORS } from "@utils/colors";
import { EDs } from "@utils/math";
import { IClass } from "@utils/types";
import { createEffect, createSignal, on, onMount, Show } from "solid-js";

export interface IBalanceOfProps extends IClass {
  tokenId: Principal;
  owner?: Principal;
  subaccount?: Uint8Array;
  precision?: number;
  balance?: bigint;
  onRefreshOverride?: () => Promise<void>;
}

export const BalanceOf = (props: IBalanceOfProps) => {
  const { balanceOf, fetchBalanceOf, metadata } = useTokens();
  const { isReadyToFetch } = useAuth();

  const [fetching, setFetching] = createSignal(false);

  const fetch = () => {
    return props.onRefreshOverride
      ? props.onRefreshOverride()
      : props.owner
      ? fetchBalanceOf(props.tokenId, props.owner, props.subaccount)
      : Promise.resolve();
  };

  const meta = () => metadata[props.tokenId.toText()];
  const balance = () => {
    const m = meta();
    if (!m) return undefined;

    if (props.balance !== undefined) return EDs.new(props.balance, m.fee.decimals);
    if (!props.owner) return;

    const b = balanceOf(props.tokenId, props.owner, props.subaccount);
    if (b === undefined) return undefined;

    return EDs.new(b, m.fee.decimals);
  };

  onMount(async () => {
    if (!isReadyToFetch()) return;

    if (!balance() && props.owner) {
      setFetching(true);
      await fetch();
      setFetching(false);
    }
  });

  createEffect(
    on(isReadyToFetch, async (ready) => {
      if (!ready) return;

      if (!balance() && !fetching() && props.owner) {
        setFetching(true);
        await fetch();
        setFetching(false);
      }
    })
  );

  const handleClickRefresh = async () => {
    if (!isReadyToFetch() || fetching()) return;

    setFetching(true);
    await fetch();
    setFetching(false);
  };

  return (
    <div class="flex gap-2 items-center min-w-40" classList={{ [props.class!]: !!props.class }}>
      <Show when={meta()} fallback={<div class="w-6 h-6 rounded-full bg-gray-140 animate-pulse" />}>
        <img src={meta()!.logoSrc} alt={meta()?.ticker} class="w-6 h-6 rounded-full" />
      </Show>
      <div class="flex gap-1 items-baseline">
        <p class="font-semibold text-white text-lg">{balance() ? balance()!.toDecimals(2).toString() : "0.00"}</p>
        <p class="font-thin text-gray-140 text-sm">{meta()?.ticker ?? "TOK"}</p>
      </div>

      <Show when={props.balance === undefined || props.onRefreshOverride !== undefined}>
        <Icon
          kind={EIconKind.Refresh}
          color={fetching() ? COLORS.gray[140] : COLORS.white}
          class={fetching() ? "" : "cursor-pointer"}
          onClick={handleClickRefresh}
          hoverColor={COLORS.gray[140]}
          size={15}
        />
      </Show>
    </div>
  );
};
