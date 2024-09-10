import { EIconKind, Icon } from "@components/icon";
import { Principal } from "@dfinity/principal";
import { useAuth } from "@store/auth";
import { useTokens } from "@store/tokens";
import { COLORS } from "@utils/colors";
import { EDs } from "@utils/math";
import { createEffect, createSignal, on, onMount, Show } from "solid-js";

export interface IBalanceOfProps {
  tokenId: Principal;
  owner: Principal;
  subaccount?: Uint8Array;
  precision?: number;
}

export const BalanceOf = (props: IBalanceOfProps) => {
  const { balanceOf, fetchBalanceOf, metadata, fetchMetadata } = useTokens();
  const { isReadyToFetch } = useAuth();

  const [fetching, setFetching] = createSignal(false);

  const meta = () => metadata[props.tokenId.toText()];
  const balance = () => {
    const m = meta();
    if (!m) return undefined;

    const b = balanceOf(props.tokenId, props.owner, props.subaccount);
    if (b === undefined) return undefined;

    return EDs.new(b, m.fee.decimals);
  };

  onMount(async () => {
    if (!isReadyToFetch()) return;

    if (!balance()) {
      setFetching(true);
      await fetchBalanceOf(props.tokenId, props.owner, props.subaccount);
      setFetching(false);
    }
  });

  createEffect(
    on(isReadyToFetch, async (ready) => {
      if (!ready) return;

      if (!balance() && !fetching()) {
        setFetching(true);
        await fetchBalanceOf(props.tokenId, props.owner, props.subaccount);
        setFetching(false);
      }
    })
  );

  const handleClickRefresh = async () => {
    if (!isReadyToFetch() || fetching()) return;

    setFetching(true);
    await fetchBalanceOf(props.tokenId, props.owner, props.subaccount);
    setFetching(false);
  };

  return (
    <div class="flex gap-2 items-center min-w-40">
      <Show when={meta()} fallback={<div class="w-6 h-6 rounded-full bg-gray-140 animate-pulse" />}>
        <img src={meta()!.logoSrc} alt={meta()?.ticker} class="w-6 h-6 rounded-full" />
      </Show>
      <div class="flex gap-1 items-baseline">
        <p class="font-semibold text-white text-lg">{balance() ? balance()!.toDecimals(2).toString() : "0.00"}</p>
        <p class="font-thin text-gray-140 text-sm">{meta()?.ticker ?? "TOK"}</p>
      </div>
      <Icon
        kind={EIconKind.Refresh}
        color={fetching() ? COLORS.gray[140] : COLORS.white}
        class={fetching() ? "" : "cursor-pointer"}
        onClick={handleClickRefresh}
      />
    </div>
  );
};
