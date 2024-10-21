import { Avatar } from "@components/avatar";
import { BalanceOf } from "@components/balance-of";
import { Bento, BentoBox } from "@components/bento";
import { Btn } from "@components/btn";
import { Copyable } from "@components/copyable";
import { EIconKind, Icon } from "@components/icon";
import { Page } from "@components/page";
import { QtyInput } from "@components/qty-input";
import { Principal } from "@dfinity/principal";
import { useAuth } from "@store/auth";
import { useFurnace } from "@store/furnace";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { avatarSrcFromPrincipal } from "@utils/common";
import { E8s, EDs } from "@utils/math";
import { eventHandler } from "@utils/security";
import { getTimeUntilNextSunday15UTC } from "@utils/time";
import { Result } from "@utils/types";
import { createEffect, createSignal, For, on, onMount, Show } from "solid-js";

export function BonfirePage() {
  const { identity, isReadyToFetch } = useAuth();
  const { fetchBalanceOf, balanceOf, metadata, icpSwapUsdExchangeRates } = useTokens();
  const { pidBalance, transfer, moveToBonfireAccount, pid } = useWallet();
  const { pledge, curRoundPositions, fetchCurRoundPositions, fetchInfo, info } = useFurnace();

  const [qtyToPledge, setQtyToPledge] = createSignal<Result<EDs, string>>(Result.Err("0"));

  const burnMetadata = () => metadata[DEFAULT_TOKENS.burn.toText()];

  const prizeFund = () => {
    const furnaceBalance = balanceOf(DEFAULT_TOKENS.icp, Principal.fromText(import.meta.env.VITE_FURNACE_CANISTER_ID));

    if (furnaceBalance === undefined) {
      return E8s.zero();
    }

    return E8s.new(furnaceBalance).mul(E8s.new(8500_0000n));
  };

  onMount(() => {
    if (isReadyToFetch()) {
      if (prizeFund().eq(E8s.zero())) {
        fetchBalanceOf(DEFAULT_TOKENS.icp, Principal.fromText(import.meta.env.VITE_FURNACE_CANISTER_ID));
      }

      fetchInfo();

      if (curRoundPositions().length == 0) {
        fetchCurRoundPositions();
      }
    }
  });

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready) {
        if (prizeFund().eq(E8s.zero())) {
          fetchBalanceOf(DEFAULT_TOKENS.icp, Principal.fromText(import.meta.env.VITE_FURNACE_CANISTER_ID));
        }

        fetchInfo();

        if (curRoundPositions().length == 0) {
          fetchCurRoundPositions();
        }
      }
    })
  );

  const timer = () => {
    const { hours, days, minutes } = getTimeUntilNextSunday15UTC();

    return (
      <div class="flex gap-3 items-center font-semibold text-6xl">
        <Show when={days > 0}>
          <p>
            {days} <span class="text-2xl">days</span>
          </p>
        </Show>
        <Show when={hours > 0}>
          <p>
            {hours} <span class="text-2xl">hours</span>
          </p>
        </Show>
        <Show when={minutes > 0} fallback={<p>few seconds</p>}>
          <p>
            {minutes} <span class="text-2xl">minutes</span>
          </p>
        </Show>
      </div>
    );
  };

  const canPledgeBurn = () => qtyToPledge().isOk();

  const handlePledgeBurn = async () => {
    const qty = qtyToPledge().unwrapOk();

    const blockIdx1 = await moveToBonfireAccount(DEFAULT_TOKENS.burn, qty.val);
    console.log("Moved $BURN to bonfire at block", blockIdx1);

    await pledge({
      tokenCanId: DEFAULT_TOKENS.burn,
      pid: pid()!,
      qty: qty.sub(burnMetadata()!.fee),
      downvote: false,
    });
  };

  const handleMaxClick = eventHandler(() => {
    setQtyToPledge(Result.Ok<EDs, string>(EDs.new(pidBalance(DEFAULT_TOKENS.burn)!, 8).sub(burnMetadata()!.fee)));
  });

  return (
    <Page slim>
      <div class="flex gap-5 flex-col justify-center items-center">
        <p class="text-xl sm:text-4xl">This Week's Prize Fund</p>
        <div class="flex gap-4 sm:gap-6 items-center">
          <Icon kind={EIconKind.ICP} color="white" size={window.innerWidth > 800 ? 180 : 60} />
          <h2 class="font-semibold leading-[70px] text-[70px] sm:leading-[200px] sm:text-[200px]">
            {prizeFund().toShortString({ belowOne: 2, belowThousand: 2, afterThousand: 2 })}{" "}
            <span class="text-xl italic font-normal">ICP</span>
          </h2>
        </div>
      </div>

      <div class="flex flex-col gap-6">
        <div class="grid grid-cols-1 sm:grid-cols-5 gap-6">
          <Bento class="sm:col-span-3 gap-5 flex-grow justify-between" id={1}>
            <div class="flex flex-col gap-1">
              <p class="text-xl font-semibold">
                Pledge <span class="text-orange">$BURN</span> to have a chance
              </p>
              <p class="text-gray-140">The more you pledge, the better your odds</p>
            </div>

            <Show when={identity() && burnMetadata()} fallback={<p class="text-orange">Sign In To Participate</p>}>
              <div class="flex flex-col gap-1">
                <QtyInput
                  value={qtyToPledge()}
                  symbol={burnMetadata()!.ticker}
                  decimals={burnMetadata()!.fee.decimals}
                  onChange={setQtyToPledge}
                  validations={[
                    { required: null },
                    {
                      min: burnMetadata()!.fee,
                      max: EDs.new(
                        (pidBalance(DEFAULT_TOKENS.burn) || burnMetadata()!.fee.val) - burnMetadata()!.fee.val,
                        burnMetadata()!.fee.decimals
                      ),
                    },
                  ]}
                />
                <Show when={pidBalance(DEFAULT_TOKENS.burn)}>
                  <p class="self-end text-sm italic underline text-gray-140 cursor-pointer" onClick={handleMaxClick}>
                    max
                  </p>
                </Show>
              </div>

              <Btn text="Pledge $BURN" bgColor={COLORS.orange} disabled={!canPledgeBurn()} onClick={handlePledgeBurn} />
            </Show>
          </Bento>
          <Bento class="sm:col-span-2" id={2}>
            <div class="flex flex-col gap-6">
              <p class="font-semibold text-xl">Rules</p>
              <div class="flex flex-col gap-2">
                <p>
                  <span class="text-gray-140">1.</span> One Winners Takes All
                </p>
                <p>
                  <span class="text-gray-140">2.</span> More Pledged Tokens = Better Odds
                </p>
                <p>
                  <span class="text-gray-140">3.</span> New Round Every Week
                </p>
                <p>
                  <span class="text-gray-140">4.</span> New Token to Pledge is Voted Every Week
                </p>
              </div>
            </div>
          </Bento>
        </div>
        <div class="grid grid-cols-1">
          <Bento id={3}>
            {timer()}
            <p class="text-gray-140">Before the winner is selected</p>
          </Bento>
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <p class="text-white font-semibold text-4xl flex gap-4 items-center">Current Round Participants</p>
        <div class="flex flex-col gap-4">
          <div class="mb-2 grid grid-cols-4 md:grid-cols-5 items-start md:items-center gap-3 text-xs font-semibold text-gray-140">
            <p class="col-span-1 text-right"></p>
            <p class="col-span-1 text-right hidden md:block">PID</p>
            <p class="col-span-1 text-right">Deposited $</p>
            <p class="col-span-1 text-right">Voting Power</p>
            <p class="col-span-1 text-right">Draw %</p>
          </div>

          <div class="flex flex-col gap-2">
            <Show when={info()}>
              <For each={curRoundPositions()} fallback={<p class="text-sm text-gray-140">Nothing here yet :(</p>}>
                {(position, idx) => {
                  const i = info()!;

                  const poolSharePercent = position.usd
                    .div(i.curRoundPledgedUsd || E8s.fromBigIntBase(1n))
                    .toPercent()
                    .toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 1 });

                  return (
                    <div class="grid p-2 grid-cols-4 md:grid-cols-5 items-center gap-3 odd:bg-gray-105 even:bg-black relative">
                      <div class="flex items-center gap-1 col-span-1">
                        <p
                          class="text-xs text-gray-140 font-semibold min-w-7"
                          classList={{ ["text-white"]: identity()?.getPrincipal().compareTo(position.pid) === "eq" }}
                        >
                          {idx() + 1}
                        </p>
                        <Avatar
                          url={avatarSrcFromPrincipal(position.pid)}
                          size="sm"
                          borderColor={
                            identity()?.getPrincipal().compareTo(position.pid) === "eq"
                              ? COLORS.chartreuse
                              : COLORS.gray[140]
                          }
                        />
                      </div>

                      <Copyable class="col-span-1 hidden md:flex" text={position.pid.toText()} ellipsis />

                      <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                        {position.usd.toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
                      </p>

                      <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                        <Show when={i.curRoundPledgedUsd.toBigIntRaw() > 0n}>{poolSharePercent}%</Show>
                      </p>

                      <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                        <Show when={i.curRoundPledgedUsd.toBigIntRaw() > 0n}>{poolSharePercent}%</Show>
                      </p>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Page>
  );
}
