import { Avatar } from "@components/avatar";
import { BalanceOf } from "@components/balance-of";
import { Btn } from "@components/btn";
import { Copyable } from "@components/copyable";
import { EIconKind, Icon } from "@components/icon";
import { Page } from "@components/page";
import { ReturnCalculator } from "@components/return-calc";
import { useAuth } from "@store/auth";
import { useBurner } from "@store/burner";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { COLORS } from "@utils/colors";
import { avatarSrcFromPrincipal } from "@utils/common";
import { E8s, EDs } from "@utils/math";
import { ONE_DAY_NS } from "@utils/types";
import { createEffect, For, on, onMount, Show } from "solid-js";

export const InfoPage = () => {
  const { isReadyToFetch, identity } = useAuth();
  const { icpSwapUsdExchangeRates } = useTokens();
  const { poolMembers, fetchPoolMembers, kamikazePoolMembers, fetchKamikazePoolMembers, totals } = useBurner();

  const burnExchangeRate = () => icpSwapUsdExchangeRates["egjwt-lqaaa-aaaak-qi2aa-cai"] ?? E8s.zero();
  const burnUSDPrice = () =>
    burnExchangeRate()?.toDynamic().toShortString({ belowOne: 4, belowThousand: 2, afterThousand: 2 });
  const tcyclesExchangeRate = () => icpSwapUsdExchangeRates["aanaa-xaaaa-aaaah-aaeiq-cai"] ?? E8s.zero();

  const totalShareWorth = () =>
    poolMembers()
      .map((it) => it.share)
      .reduce((prev, cur) => prev.add(cur), EDs.zero(12))
      .mul(tcyclesExchangeRate().toDynamic().toDecimals(12));

  const totalKamikazeShareWorth = () =>
    kamikazePoolMembers()
      .map((it) => it.share)
      .reduce((prev, cur) => prev.add(cur), EDs.zero(12))
      .mul(tcyclesExchangeRate().toDynamic().toDecimals(12));

  const avgKamikazeShareWorth = () =>
    kamikazePoolMembers()
      .map((it) => it.share)
      .reduce((prev, cur) => prev.add(cur), EDs.zero(12))
      .div(EDs.fromBigIntBase(BigInt(kamikazePoolMembers().length || 1), 12))
      .mul(tcyclesExchangeRate().toDynamic().toDecimals(12));

  const avgShareWorth = () =>
    poolMembers()
      .map((it) => it.share)
      .reduce((prev, cur) => prev.add(cur), EDs.zero(12))
      .div(EDs.fromBigIntBase(BigInt(poolMembers().length || 1), 12))
      .mul(tcyclesExchangeRate().toDynamic().toDecimals(12));

  createEffect(() => {
    console.log(tcyclesExchangeRate().toString(), totals.data?.icpToCyclesExchangeRate.toString());
  });

  onMount(() => {
    if (isReadyToFetch()) {
      fetchPoolMembers();
      fetchKamikazePoolMembers();
    }
  });

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready) {
        fetchPoolMembers();
        fetchKamikazePoolMembers();
      }
    })
  );

  return (
    <Page slim>
      <div class="flex flex-col gap-5">
        <div class="flex items-baseline justify-between">
          <p class="text-white font-bold text-6xl leading-[60px] md:text-[200px] md:leading-[200px]">
            ${burnUSDPrice()}
          </p>
          <p class="text-gray-140 text-lg font-thin italic text-right">per 1 BURN</p>
        </div>
        <div class="flex flex-col-reverse md:flex-row gap-2 md:items-center md:justify-between">
          <div class="flex flex-col md:flex-row gap-2">
            <a
              href="https://dexscreener.com/icp/pfaxf-iiaaa-aaaag-qkiia-cai"
              class="flex flex-grow md:flex-grow-0 items-center justify-center gap-5 text-white font-semibold rounded-full px-6 py-4 bg-gray-110"
              target="_blank"
            >
              <span class="text-nowrap">DEX Screener</span>
            </a>
            <a
              href="https://t5t44-naaaa-aaaah-qcutq-cai.raw.ic0.app/token/egjwt-lqaaa-aaaak-qi2aa-cai/transactions"
              class="flex flex-grow md:flex-grow-0 items-center justify-center gap-2 text-white font-semibold rounded-full px-6 py-4 bg-gray-120"
              target="_blank"
            >
              <span class="text-nowrap">Block Explorer</span>
            </a>
          </div>

          <a
            href="https://app.icpswap.com/swap?input=ryjl3-tyaaa-aaaaa-aaaba-cai&output=egjwt-lqaaa-aaaak-qi2aa-cai"
            class="flex items-center flex-nowrap justify-center gap-2 text-white font-semibold rounded-full px-6 py-4 bg-orange"
            target="_blank"
          >
            <span class="text-nowrap">Trade on</span>
            <img
              class="h-6"
              src="https://app.icpswap.com/static/media/logo-dark.7b8c12091e650c40c5e9f561c57473ba.svg"
            />
          </a>
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <p class="text-white font-semibold text-4xl">Return Calculator</p>
        <ReturnCalculator />
      </div>

      <Show when={totals.data?.isKamikazePoolEnabled}>
        <div class="flex flex-col gap-4">
          <p class="text-white font-semibold text-4xl flex gap-4 items-center">High-Risk Pool Members</p>
          <div class="flex flex-col gap-4">
            <div class="mb-2 grid grid-cols-5 md:grid-cols-6 items-start md:items-center gap-3 text-xs font-semibold text-gray-140">
              <p class="col-span-1 text-right"></p>
              <p class="col-span-1 text-right hidden md:block">PID</p>
              <p class="col-span-1 text-right">Minutes Left</p>
              <p class="col-span-1 text-right">Times Won</p>
              <p class="col-span-1 text-right">Pool Share</p>
              <p class="col-span-1 text-right">Share Worth</p>
            </div>

            <div class="flex flex-col gap-2">
              <Show when={tcyclesExchangeRate().toBool()}>
                <For each={kamikazePoolMembers()} fallback={<p class="text-sm text-gray-140">Nothing here yet :(</p>}>
                  {(member, idx) => {
                    const now = Date.now();
                    const harakiriAt = member.createdAtDate.getTime() + 24 * 60 * 60 * 1000; // 24 hours since creation
                    let minutesLeftStr = "< 1";
                    if (harakiriAt > now) {
                      const dif = harakiriAt - now;
                      const minutesLeft = Math.floor(dif / 60 / 1000);

                      minutesLeftStr =
                        minutesLeft > 1000 ? `${(minutesLeft / 1000.0).toFixed(1)}k` : minutesLeft.toString();
                    }

                    const poolSharePercent = member.share
                      .div(totals.data!.totalKamikazePoolSupply)
                      .toPercent()
                      .toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 1 });

                    const shareWorth = member.share
                      .mul(tcyclesExchangeRate().toDynamic().toDecimals(12))
                      .toShortString({ belowOne: 3, belowThousand: 1, afterThousand: 1 });

                    return (
                      <div class="grid p-2 grid-cols-5 md:grid-cols-6 items-center gap-3 odd:bg-gray-105 even:bg-black relative">
                        <div class="flex items-center gap-1 col-span-1">
                          <p
                            class="text-xs text-gray-140 font-semibold min-w-7"
                            classList={{ ["text-white"]: identity()?.getPrincipal().compareTo(member.id) === "eq" }}
                          >
                            {idx() + 1}
                          </p>
                          <Avatar
                            url={avatarSrcFromPrincipal(member.id)}
                            size="sm"
                            borderColor={
                              identity()?.getPrincipal().compareTo(member.id) === "eq"
                                ? COLORS.chartreuse
                                : COLORS.gray[140]
                            }
                          />
                        </div>

                        <Copyable class="col-span-1 hidden md:flex" text={member.id.toText()} ellipsis />

                        <p class="col-span-1 font-semibold text-gray-140 text-md text-right">{minutesLeftStr}</p>

                        <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                          <Show when={totals.data}>{member.roundsWon.toString()}</Show>
                        </p>

                        <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                          <Show when={totals.data && !totals.data.totalKamikazePoolSupply.isZero()}>
                            {poolSharePercent}%
                          </Show>
                        </p>

                        <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                          <Show when={totals.data && !totals.data.totalKamikazePoolSupply.isZero()}>${shareWorth}</Show>
                        </p>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>

            <div class="grid px-2 grid-cols-5 sm:grid-cols-6 items-center gap-3 text-md font-semibold text-gray-190">
              <p class="col-span-1 sm:col-span-2 text-right">Average</p>
              <p class="col-span-1 text-right font-semibold">${avgKamikazeShareWorth().toDecimals(2).toString()}</p>
              <p class="col-span-2 text-right">Total</p>
              <p class="col-span-1 text-right font-semibold">${totalKamikazeShareWorth().toDecimals(0).toString()}</p>
            </div>
          </div>
        </div>
      </Show>

      <div class="flex flex-col gap-4">
        <p class="text-white font-semibold text-4xl flex gap-4 items-center">
          Classic Pool Members
          <Show when={totals.data?.isLotteryEnabled}>
            <Icon kind={EIconKind.Lottery} color={COLORS.orange} />
          </Show>
        </p>
        <div class="flex flex-col gap-4">
          <div class="mb-2 grid grid-cols-5 md:grid-cols-6 items-start md:items-center gap-3 text-xs font-semibold text-gray-140">
            <p class="col-span-1 text-right"></p>
            <p class="col-span-1 text-right hidden md:block">PID</p>
            <p class="col-span-1 text-right">Fuel Left</p>
            <p class="col-span-1 text-right">Blocks Left</p>
            <p class="col-span-1 text-right">Pool Share</p>
            <p class="col-span-1 text-right">Share Worth</p>
          </div>

          <div class="flex flex-col gap-2">
            <Show when={tcyclesExchangeRate().toBool()}>
              <For each={poolMembers()} fallback={<p class="text-sm text-gray-140">Nothing here yet :(</p>}>
                {(member, idx) => {
                  const blocksLeft = member.share
                    .div(totals.data!.currentBlockShareFee)
                    .toShortString({ belowOne: 0, belowThousand: 0, afterThousand: 1 });

                  const poolSharePercent = member.share
                    .div(totals.data!.totalSharesSupply)
                    .toPercent()
                    .toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 1 });

                  const shareWorth = member.share
                    .mul(tcyclesExchangeRate().toDynamic().toDecimals(12))
                    .toShortString({ belowOne: 3, belowThousand: 1, afterThousand: 1 });

                  const fuelLeft = member.share.toShortString({ belowOne: 4, belowThousand: 2, afterThousand: 1 });

                  return (
                    <div class="grid p-2 grid-cols-5 md:grid-cols-6 items-center gap-3 odd:bg-gray-105 even:bg-black relative">
                      <div class="flex items-center gap-1 col-span-1">
                        <p
                          class="text-xs text-gray-140 font-semibold min-w-7"
                          classList={{ ["text-white"]: identity()?.getPrincipal().compareTo(member.id) === "eq" }}
                        >
                          {idx() + 1}
                        </p>
                        <Avatar
                          url={avatarSrcFromPrincipal(member.id)}
                          size="sm"
                          borderColor={
                            identity()?.getPrincipal().compareTo(member.id) === "eq"
                              ? COLORS.chartreuse
                              : COLORS.gray[140]
                          }
                        />
                      </div>

                      <Copyable class="col-span-1 hidden md:flex" text={member.id.toText()} ellipsis />

                      <p class="col-span-1 font-semibold text-gray-140 text-md text-right">{fuelLeft}</p>

                      <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                        <Show when={totals.data}>{blocksLeft}</Show>
                      </p>

                      <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                        <Show when={totals.data && !totals.data.totalSharesSupply.isZero()}>{poolSharePercent}%</Show>
                      </p>

                      <p class="col-span-1 font-semibold text-gray-140 text-md text-right">
                        <Show when={totals.data && !totals.data.totalSharesSupply.isZero()}>${shareWorth}</Show>
                      </p>

                      <Show when={member.isVerifiedViaDecideID}>
                        <div
                          class={`absolute right-[-10px] top-[-7px] text-black font-semibold text-[10px] leading-[8px] bg-orange rounded-full p-1`}
                        >
                          {member.lotteryRoundsWon.toString()}
                        </div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>

          <div class="grid px-2 grid-cols-5 sm:grid-cols-6 items-center gap-3 text-md font-semibold text-gray-190">
            <p class="col-span-1 sm:col-span-2 text-right">Average</p>
            <p class="col-span-1 text-right font-semibold">${avgShareWorth().toDecimals(0).toString()}</p>
            <p class="col-span-2 text-right">Total</p>
            <p class="col-span-1 text-right font-semibold">${totalShareWorth().toDecimals(0).toString()}</p>
          </div>
        </div>
      </div>
    </Page>
  );
};
