import { Avatar } from "@components/avatar";
import { BalanceOf } from "@components/balance-of";
import { Bento } from "@components/bento";
import { Btn } from "@components/btn";
import { Copyable } from "@components/copyable";
import { EIconKind, Icon } from "@components/icon";
import { Modal } from "@components/modal";
import { Page } from "@components/page";
import { PledgeForm } from "@components/pledge-form";
import { ProfileFull } from "@components/profile/profile";
import { Timer } from "@components/timer";
import { Principal } from "@dfinity/principal";
import { useAuth } from "@store/auth";
import { useBurner } from "@store/burner";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { avatarSrcFromPrincipal } from "@utils/common";
import { E8s, EDs } from "@utils/math";
import { ONE_DAY_NS } from "@utils/types";
import { createEffect, createSignal, For, Match, on, onMount, Show, Switch } from "solid-js";

export const PoolPage = () => {
  const { isAuthorized } = useAuth();
  const { icpSwapUsdExchangeRates } = useTokens();
  const { totals, fetchTotals, canPledgePool, pledgePool } = useBurner();
  const { claimPoolBurnReward } = useWallet();

  const [isKamikazePool, setIsKamikazePool] = createSignal(false);
  const [pledgeModalOpen, setPledgeModalOpen] = createSignal(false);

  const myClassicPoolShare = () => {
    const t = totals.data;
    if (!t) return E8s.zero();

    if (t.totalSharesSupply.isZero()) return E8s.zero();

    return t.yourShareTcycles.div(t.totalSharesSupply).toDecimals(8).toE8s();
  };

  const myKamikazePoolShare = () => {
    const t = totals.data;
    if (!t) return E8s.zero();

    if (t.totalKamikazePoolSupply.isZero()) return E8s.zero();

    return t.yourKamikazeShareTcycles.div(t.totalKamikazePoolSupply).toDecimals(8).toE8s();
  };

  const myClassicPoolCut = () => {
    const t = totals.data;

    if (!t) return undefined;
    if (t.totalSharesSupply.isZero()) return undefined;
    if (t.yourShareTcycles.isZero()) return undefined;

    const lotteryEnabled = t.isLotteryEnabled || t.isKamikazePoolEnabled;

    const share = t.yourShareTcycles.div(t.totalSharesSupply).toDecimals(8).toE8s();
    const burnPerHour = t.currentBurnTokenReward.mulNum(30n).divNum(2n);

    let rewardPerHour = share.mul(burnPerHour);

    if (lotteryEnabled) {
      rewardPerHour = rewardPerHour.divNum(2n);
    }

    return rewardPerHour;
  };

  const myKamikazePoolCut = () => {
    const t = totals.data;

    if (!t) return undefined;
    if (!t.isKamikazePoolEnabled) return undefined;
    if (t.totalKamikazePoolSupply.isZero()) return undefined;
    if (t.yourKamikazeShareTcycles.isZero()) return undefined;

    const minShare = t.yourKamikazeShareTcycles.div(t.totalKamikazePoolSupply).divNum(2n).toDecimals(8).toE8s();
    const maxShare = t.yourKamikazeShareTcycles.div(t.totalKamikazePoolSupply).mulNum(2n).toDecimals(8).toE8s();

    const burnPerHour = t.currentBurnTokenReward.mulNum(30n).divNum(2n);

    const min = minShare.mul(burnPerHour);
    const max = maxShare.mul(burnPerHour);

    return { min, max };
  };

  const poolCut = () => {
    const classic = () => myClassicPoolCut();
    const highRisk = () => myKamikazePoolCut();

    const value = () => {
      const c = classic();
      const h = highRisk();

      if (c && h) {
        return { min: h.min.add(c), max: h.max.add(c) };
      } else if (c) {
        return { min: c, max: c };
      } else if (h) {
        return h;
      } else {
        return undefined;
      }
    };

    return (
      <Switch>
        <Match when={!value()}>
          <div class="flex items-center gap-1">
            <p class="font-semibold sm:text-[4rem] leading-[3.5rem]">Pledging Required</p>
          </div>
        </Match>
        <Match when={value()!.min.eq(value()!.max)}>
          <div class="flex flex-grow justify-between items-end">
            <div class="flex items-center gap-1">
              <span class="text-2xl font-semibold">~</span>
              <p class="font-semibold sm:text-[4rem] leading-[3.5rem]">
                {value()!.min.toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}
              </p>
            </div>
            <p class="flex flex-row gap-1 text-lg">
              <span class="text-orange font-semibold">$BURN</span> <span>/</span> <span>hour</span>
            </p>
          </div>
        </Match>
        <Match when={!value()!.min.eq(value()!.max)}>
          <div class="flex flex-grow justify-between items-end">
            <div class="flex items-center gap-1">
              <span class="text-2xl font-semibold">~</span>
              <p class="font-semibold sm:text-[4rem] leading-[3.5rem]">
                {value()!.min.toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}
              </p>
              <span class="text-2xl font-semibold">-</span>
              <p class="font-semibold sm:text-[4rem] leading-[3.5rem]">
                {value()!.max.toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}
              </p>
            </div>

            <p class="flex flex-row gap-1 text-lg">
              <span class="text-orange font-semibold">$BURN</span> <span>/</span> <span>hour</span>
            </p>
          </div>
        </Match>
      </Switch>
    );
  };

  const tcyclesExchangeRate = () => icpSwapUsdExchangeRates["aanaa-xaaaa-aaaah-aaeiq-cai"] ?? E8s.zero();

  const classicPoolUsd = () => {
    const t = totals.data;

    if (!t) return E8s.zero();

    return t.yourShareTcycles.toDecimals(8).toE8s().mul(tcyclesExchangeRate());
  };

  const classicPoolLifespan = () => {
    const t = totals.data;
    if (!t) return { days: 0, hours: 0, minutes: 0 };

    const speedMinutes = t.currentBlockShareFee.divNum(2n);
    let minutes = Number(t.yourShareTcycles.div(speedMinutes).toDecimals(0));

    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes / 60) % 24);
    minutes = minutes % 60;

    return { days, hours, minutes };
  };

  const kamikazePoolUsd = () => {
    const t = totals.data;

    if (!t) return E8s.zero();

    return t.yourKamikazeShareTcycles.toDecimals(8).toE8s().mul(tcyclesExchangeRate());
  };

  const kamikazePoolLifespan = () => {
    const t = totals.data;
    if (!t) return { days: 0, hours: 0, minutes: 0 };

    const now = Date.now();
    const then = (t.yourKamikazePositionCreatedAt?.getTime() ?? now) + Number(ONE_DAY_NS / 1000000n);

    const ms = then - now;

    let minutes = Math.floor(ms / 1000 / 60);

    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes / 60) % 24);
    minutes = minutes % 60;

    return { days, hours, minutes };
  };

  const canClaim = () => {
    const t = totals.data;
    if (!t) return false;

    if (t.yourUnclaimedReward.isZero()) return false;

    return true;
  };

  const handleClaim = async () => {
    await claimPoolBurnReward();
    fetchTotals();
  };

  const handlePledgeModalOpenClick = (isKamikaze: boolean) => {
    setIsKamikazePool(isKamikaze);
    setPledgeModalOpen(true);
  };

  const handlePledge = async (_: Principal, qty: bigint) => {
    const isKamikaze = isKamikazePool();

    await pledgePool(isKamikaze, qty);
    fetchTotals();

    handlePledgeModalCloseClick();
  };

  const handlePledgeModalCloseClick = () => {
    setPledgeModalOpen(false);
  };

  return (
    <Page slim>
      <div class="grid grid-cols-4 gap-6">
        <Show when={isAuthorized()}>
          <Bento class="col-span-4 flex-row justify-between items-center gap-2" id={1}>
            <ProfileFull />
          </Bento>
        </Show>

        <Bento class="col-span-2 flex-col" id={2}>
          <div class="flex flex-col gap-8">
            <p class="font-semibold text-xl">Classic Pool</p>

            <ol class="flex flex-col gap-1 list-decimal list-inside text-sm">
              <li>
                Positions <b>slowly expire</b> over time.
              </li>
              <li>
                Pledging more increases <b>position share and lifespan</b>.
              </li>
              <li>
                <b>All positions</b> receive a portion of the block reward.
              </li>
              <li>
                More ICP pledged = <b>larger reward share</b>.
              </li>
              <li>Once a position expires, a new one can be created.</li>
            </ol>

            <Show when={isAuthorized()} fallback={<p class="text-orange">Sign In To Pledge</p>}>
              <div class="flex flex-col gap-4">
                <div class="flex gap-4 justify-between items-baseline">
                  <p class="font-bold text-6xl">
                    ${classicPoolUsd().toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}
                  </p>
                  <p class="text-gray-140">pledged worth of ICP</p>
                </div>

                <div class="flex gap-4 justify-between items-baseline">
                  <p class="font-bold text-4xl">
                    {myClassicPoolShare()
                      .toPercent()
                      .toShortString({ belowOne: 4, belowThousand: 2, afterThousand: 2 })}
                    %
                  </p>
                  <p class="text-gray-140">pool share</p>
                </div>

                <div class="flex gap-4 justify-between items-baseline">
                  <Timer {...classicPoolLifespan()} class="text-xl" descriptionClass="text-md" />
                  <p class="text-gray-140">till removed</p>
                </div>
              </div>

              <Btn
                text="Pledge ICP to Classic Pool"
                bgColor={COLORS.orange}
                class="w-full font-semibold"
                iconColor={COLORS.white}
                disabled={!canPledgePool()}
                onClick={() => handlePledgeModalOpenClick(false)}
              />
            </Show>
          </div>
        </Bento>

        <Bento class="col-span-2 flex-col" id={3}>
          <div class="flex flex-col gap-8">
            <p class="font-semibold text-xl">High-Risk Pool</p>

            <ol class="flex flex-col gap-1 list-decimal list-inside text-sm">
              <li>
                Positions <b>expire 24 hours after</b> creation.
              </li>
              <li>
                Pledging more increases <b>only position share</b>.
              </li>
              <li>
                <b>One random winner</b> receives half the block reward.
              </li>
              <li>
                More ICP pledged = <b>higher chance of winning</b>.
              </li>
              <li>Once a position expires, a new one can be created.</li>
            </ol>

            <Show when={isAuthorized()} fallback={<p class="text-orange">Sign In To Pledge</p>}>
              <div class="flex flex-col gap-4">
                <div class="flex gap-4 justify-between items-baseline">
                  <p class="font-bold text-6xl">
                    ${kamikazePoolUsd().toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}
                  </p>
                  <p class="text-gray-140">pledged worth of ICP</p>
                </div>

                <div class="flex gap-4 justify-between items-baseline">
                  <p class="font-bold text-4xl">
                    {myKamikazePoolShare()
                      .toPercent()
                      .toShortString({ belowOne: 4, belowThousand: 2, afterThousand: 2 })}
                    %
                  </p>
                  <p class="text-gray-140">chance to draw</p>
                </div>

                <div class="flex gap-4 justify-between items-baseline">
                  <Timer {...kamikazePoolLifespan()} class="text-xl" descriptionClass="text-md" />
                  <p class="text-gray-140">till removed</p>
                </div>
              </div>

              <Btn
                text="Pledge ICP to High-Risk Pool"
                bgColor={COLORS.orange}
                class="w-full font-semibold"
                iconColor={COLORS.white}
                disabled={!canPledgePool()}
                onClick={() => handlePledgeModalOpenClick(true)}
              />
            </Show>
          </div>
        </Bento>
      </div>

      <Show when={totals.data && isAuthorized()}>
        <div class="grid grid-cols-4 gap-6">
          <Bento class="col-span-3 flex-col justify-end" id={5}>
            <div class="flex flex-col gap-4">
              <div class="flex flex-col gap-4">
                <p class="text-gray-165 font-semibold text-xl">Burn Minting</p>
                {poolCut()}
              </div>
            </div>
          </Bento>

          <Bento class="col-span-1 flex-col justify-center items-center gap-2" id={4}>
            <BalanceOf
              tokenId={DEFAULT_TOKENS.burn}
              onRefreshOverride={fetchTotals}
              balance={totals.data!.yourUnclaimedReward.toBigIntRaw()}
            />
            <Btn
              text="Claim"
              icon={EIconKind.ArrowUpRight}
              bgColor={COLORS.orange}
              class="w-full font-semibold"
              iconClass="rotate-180"
              iconColor={COLORS.white}
              disabled={!canClaim()}
              onClick={handleClaim}
            />
          </Bento>
        </div>
      </Show>

      <KamikazePoolTable />

      <ClassicPoolTable />

      <Show when={pledgeModalOpen()}>
        <Modal
          onClose={handlePledgeModalCloseClick}
          title={`Pledge ICP to ${isKamikazePool() ? "High-Risk" : "Classic"} Pool`}
        >
          <PledgeForm min={EDs.new(1000_0000n, 8)} tokenCanId={DEFAULT_TOKENS.icp} onPledge={handlePledge} />
        </Modal>
      </Show>
    </Page>
  );
};

function KamikazePoolTable() {
  const { isReadyToFetch, identity } = useAuth();
  const { icpSwapUsdExchangeRates } = useTokens();
  const { kamikazePoolMembers, fetchKamikazePoolMembers, totals } = useBurner();

  const tcyclesExchangeRate = () => icpSwapUsdExchangeRates["aanaa-xaaaa-aaaah-aaeiq-cai"] ?? E8s.zero();

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

  onMount(() => {
    if (isReadyToFetch()) {
      fetchKamikazePoolMembers();
    }
  });

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready) {
        fetchKamikazePoolMembers();
      }
    })
  );

  return (
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
  );
}

function ClassicPoolTable() {
  const { isReadyToFetch, identity } = useAuth();
  const { icpSwapUsdExchangeRates } = useTokens();
  const { poolMembers, fetchPoolMembers, totals } = useBurner();

  const tcyclesExchangeRate = () => icpSwapUsdExchangeRates["aanaa-xaaaa-aaaah-aaeiq-cai"] ?? E8s.zero();

  const totalShareWorth = () =>
    poolMembers()
      .map((it) => it.share)
      .reduce((prev, cur) => prev.add(cur), EDs.zero(12))
      .mul(tcyclesExchangeRate().toDynamic().toDecimals(12));

  const avgShareWorth = () =>
    poolMembers()
      .map((it) => it.share)
      .reduce((prev, cur) => prev.add(cur), EDs.zero(12))
      .div(EDs.fromBigIntBase(BigInt(poolMembers().length || 1), 12))
      .mul(tcyclesExchangeRate().toDynamic().toDecimals(12));

  onMount(() => {
    if (isReadyToFetch()) {
      fetchPoolMembers();
    }
  });

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready) {
        fetchPoolMembers();
      }
    })
  );

  return (
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
          <Show when={tcyclesExchangeRate().toBool() && totals.data}>
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
  );
}
