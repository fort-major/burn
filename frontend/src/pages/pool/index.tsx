import { Airdrop } from "@components/airdrop";
import { Avatar } from "@components/avatar";
import { BalanceOf } from "@components/balance-of";
import { Bento } from "@components/bento";
import { Btn } from "@components/btn";
import { Copyable } from "@components/copyable";
import { HelpBtn } from "@components/help-btn";
import { EIconKind, Icon } from "@components/icon";
import { Modal } from "@components/modal";
import { Page } from "@components/page";
import { PledgeForm } from "@components/pledge-form";
import { ProfileFull } from "@components/profile/profile";
import { Timer } from "@components/timer";
import { TokenIcon } from "@components/token-icon";
import { Principal } from "@dfinity/principal";
import { useAuth } from "@store/auth";
import { useBurner } from "@store/burner";
import { IDistribution, useDispensers } from "@store/dispensers";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { avatarSrcFromPrincipal } from "@utils/common";
import { E8s, EDs } from "@utils/math";
import { ONE_DAY_NS } from "@utils/types";
import { createEffect, createMemo, createSignal, For, Match, on, onMount, Show, Switch } from "solid-js";

export const PoolPage = () => {
  const { isAuthorized } = useAuth();
  const { icpSwapUsdExchangeRates, metadata } = useTokens();
  const { totals, fetchTotals, canPledgePool, pledgePool, spikeAccountBalance } = useBurner();
  const { claimPoolBurnReward } = useWallet();
  const { distributions } = useDispensers();

  const [isKamikazePool, setIsKamikazePool] = createSignal(false);
  const [pledgeModalOpen, setPledgeModalOpen] = createSignal(false);

  const allInProgressDistributions = createMemo(() => {
    const result: [string, IDistribution[]][] = [];

    for (let tokenId in distributions) {
      const r = [];

      const ds = distributions[tokenId]!.InProgress!;
      for (let distributionId in ds) {
        r.push(ds[distributionId]!);
      }

      result.push([tokenId, r]);
    }

    return result;
  });

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

  const poolHourlyRewards = createMemo(() => {
    const result: [string, Principal, EDs][] = [];

    if (totals.data) {
      const mintedBurn = totals.data.currentBurnTokenReward.mul(E8s.new(15_0000_0000n)).toDynamic();
      result.push(["🔥 Newly minted", DEFAULT_TOKENS.burn, mintedBurn]);
    }

    const ds = allInProgressDistributions();

    for (let [tokenId, distributions] of ds) {
      if (distributions.length === 0) continue;

      for (let distribution of distributions) {
        result.push([`🎁 ${distribution.name}`, Principal.fromText(tokenId), distribution.curTickReward.divNum(3n)]);
      }
    }

    return result;
  });

  const totalHourlyRewardsUsd = createMemo(() => {
    const r = poolHourlyRewards();

    let resultUsd = E8s.zero();

    for (let [_, tokenId, value] of r) {
      const exchangeRate = icpSwapUsdExchangeRates[tokenId.toText()] ?? E8s.zero();

      resultUsd = resultUsd.add(value.toDecimals(8).toE8s().mul(exchangeRate));
    }

    return resultUsd.mulNum(2n);
  });

  const dailyPoolRewardUsd = () => totalHourlyRewardsUsd().mulNum(12n);

  const myRewards = createMemo(() => {
    const t = totals.data;
    if (!t) return [];

    const classicCut = t.yourShareTcycles.div(t.totalSharesSupply.isZero() ? EDs.one(12) : t.totalSharesSupply);
    const highRiskCut = t.yourKamikazeShareTcycles.div(
      t.totalKamikazePoolSupply.isZero() ? EDs.one(12) : t.totalKamikazePoolSupply
    );

    const hourlyRewards = poolHourlyRewards();

    const result: Record<string, EDs> = {};

    for (let [_, tokenId, value] of hourlyRewards) {
      const t = tokenId.toText();
      if (!result[t]) {
        result[t] = EDs.zero(value.decimals);
      }

      const classic = value.mul(classicCut.toDecimals(value.decimals));
      const highRisk = value.mul(highRiskCut.toDecimals(value.decimals));

      result[t] = result[t].add(classic).add(highRisk);
    }

    return Object.entries(result).filter((it) => !it[1].isZero());
  });

  const myTotalRewardUsd = createMemo(() => {
    const r = myRewards();

    let resultUsd = E8s.zero();

    for (let [tokenId, value] of r) {
      const exchangeRate = icpSwapUsdExchangeRates[tokenId] ?? E8s.zero();

      resultUsd = resultUsd.add(value.toDecimals(8).toE8s().mul(exchangeRate));
    }

    return resultUsd;
  });

  return (
    <Page slim>
      <div class="flex gap-5 flex-col justify-center items-center">
        <p class="flex flex-col gap-2 items-center text-xl sm:text-4xl">
          <span>
            Pledge <span class="font-semibold text-orange">$ICP</span> To Mint{" "}
            <span class="font-semibold text-orange">$BURN</span>
          </span>
          <span>and other tokens</span>
        </p>
      </div>

      <div class="grid grid-cols-4 gap-6">
        <Show when={isAuthorized()}>
          <Bento class="col-span-4 flex-row justify-between items-center gap-2" id={1}>
            <ProfileFull />
          </Bento>
        </Show>

        <Bento class="col-span-4 sm:col-span-3 flex-col gap-8 justify-between" id={1}>
          <div class="flex flex-row items-center justify-between">
            <p class="font-semibold text-xl">Hourly Pool Rewards</p>
            <p class="text-xl text-gray-140">
              ${totalHourlyRewardsUsd().toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
            </p>
          </div>

          <Show when={poolHourlyRewards()}>
            <div class="flex flex-col gap-2">
              <div class="flex flex-col">
                <For each={poolHourlyRewards()}>
                  {([title, tokenCanId, value], idx) => {
                    const m = metadata[tokenCanId.toText()];

                    return (
                      <div
                        class="flex flex-row justify-between gap-8 px-2 py-4 items-center"
                        classList={{ "bg-gray-105": idx() % 2 == 0, "bg-gray-110": idx() % 2 == 1 }}
                      >
                        <p class="font-semibold text-md text-gray-140 text-ellipsis overflow-hidden sm:text-nowrap">
                          {title}
                        </p>
                        <div class="flex flex-row gap-1 items-center min-w-36">
                          <Show when={m}>
                            <TokenIcon tokenCanId={tokenCanId} class="w-5 h-5" />
                          </Show>
                          <div class="flex flex-row gap-1 items-baseline">
                            <p class="font-semibold text-2xl">
                              {value.mulNum(2n).toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}
                            </p>
                            <Show when={m}>
                              <span class="text-gray-140 text-xs">{m!.ticker}</span>
                            </Show>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>
        </Bento>

        <Bento id={1} class="col-span-4 sm:col-span-1 flex-col gap-4 justify-between">
          <Show when={totals.data && spikeAccountBalance()}>
            <div class="flex flex-row gap-4 justify-between">
              <p class="font-semibold text-xl leading-5">ICP Burning Spike Event</p>
              <HelpBtn>
                <p class="text-sm">
                  We accumulate <span class="text-orange">$ICP</span> to transform them into cycles and burn in one go,
                  producing a big spike on the charts. 47.5% of all pledged <span class="text-orange">$ICP</span> go
                  here.
                </p>
              </HelpBtn>
            </div>
            <div class="flex flex-col">
              <p class="font-semibold text-6xl text-orange animate-pulse">
                {spikeAccountBalance()!.toShortString({ belowOne: 2, belowThousand: 0, afterThousand: 1 })}{" "}
              </p>
              <p class="font-semibold text-gray-140 text-lg self-end">
                / {totals.data!.icpSpikeTarget.toShortString({ belowOne: 2, belowThousand: 0, afterThousand: 1 })}{" "}
                <span class="text-sm text-gray-140">ICP</span>
              </p>
            </div>
          </Show>
        </Bento>

        <Bento class="col-span-4 sm:col-span-2 flex-col" id={2}>
          <div class="flex flex-col gap-8">
            <div class="flex items-center justify-between">
              <p class="font-semibold text-xl flex gap-4 items-baseline">
                <span>Classic Pool</span>
                <span class="text-gray-140 text-sm">
                  earns ${dailyPoolRewardUsd().toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })} a day
                </span>
              </p>
              <HelpBtn>
                <ol class="flex flex-col gap-2 list-decimal list-inside text-sm">
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
                    More <span class="text-orange">$ICP</span> pledged = <b>larger reward share</b>.
                  </li>
                  <li>Once a position expires, a new one can be created.</li>
                  <li>
                    All Classic pool members <b>are eligible</b> for airdrops, which are distributed according to
                    member's share.
                  </li>
                </ol>
              </HelpBtn>
            </div>

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

        <Bento class="col-span-4 sm:col-span-2 flex-col" id={2}>
          <div class="flex flex-col gap-8">
            <div class="flex items-center justify-between">
              <p class="font-semibold text-xl flex gap-4 items-baseline">
                <span>High-Risk Pool</span>
                <span class="text-gray-140 text-sm">
                  earns ${dailyPoolRewardUsd().toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })} a day
                </span>
              </p>
              <HelpBtn>
                <ol class="flex flex-col gap-2 list-decimal list-inside text-sm">
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
                    More <span class="text-orange">$ICP</span> pledged = <b>higher chance of winning</b>.
                  </li>
                  <li>Once a position expires, a new one can be created.</li>
                  <li>
                    All High-Risk pool members <b>are eligible</b> for airdrops, which are distributed according to
                    member's draw chance.
                  </li>
                </ol>
              </HelpBtn>
            </div>

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

        <Show when={totals.data && isAuthorized()}>
          <div class="grid col-span-4 grid-cols-4 gap-6">
            <Bento class="col-span-4 sm:col-span-3 flex-col gap-4 justify-between" id={1}>
              <div class="flex items-center justify-between">
                <p class="font-semibold text-2xl">My Approx. Hourly Rewards</p>
                <p class="text-xl text-gray-140">
                  ${myTotalRewardUsd().toShortString({ belowOne: 2, belowThousand: 1, afterThousand: 2 })}
                </p>
              </div>
              <div class="flex flex-row gap-8 flex-wrap">
                <For
                  each={myRewards()}
                  fallback={<p class="font-semibold text-4xl text-gray-140">Pledge to receive rewards</p>}
                >
                  {([tokenId, reward]) => {
                    const m = metadata[tokenId];

                    return (
                      <div class="flex flex-row gap-1 items-center min-w-36">
                        <Show when={m}>
                          <TokenIcon tokenCanId={Principal.fromText(tokenId)} class="w-5 h-5" />
                        </Show>
                        <div class="flex flex-row gap-1 items-baseline">
                          <p class="font-semibold text-2xl">
                            {reward.toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}
                          </p>
                          <Show when={m}>
                            <span class="text-gray-140 text-md">{m!.ticker}</span>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Bento>

            <Bento class="col-span-4 sm:col-span-1 flex-col justify-center items-center gap-2" id={4}>
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
      </div>

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
            <p class="col-span-1 sm:col-span-2 text-right text-gray-140 text-xs">Average</p>
            <p class="col-span-1 text-right font-semibold">${avgKamikazeShareWorth().toDecimals(2).toString()}</p>
            <p class="col-span-2 text-right text-gray-140 text-xs">Total</p>
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
          <p class="col-span-1 sm:col-span-2 text-right text-gray-140 text-xs">Average</p>
          <p class="col-span-1 text-right font-semibold">${avgShareWorth().toDecimals(0).toString()}</p>
          <p class="col-span-2 text-right text-gray-140 text-xs">Total</p>
          <p class="col-span-1 text-right font-semibold">${totalShareWorth().toDecimals(0).toString()}</p>
        </div>
      </div>
    </div>
  );
}
