import { BalanceOf } from "@components/balance-of";
import { Bento } from "@components/bento";
import { Btn } from "@components/btn";
import { EIconKind } from "@components/icon";
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
import { createLocalStorageSignal } from "@utils/common";
import { E8s, EDs } from "@utils/math";
import { ONE_DAY_NS } from "@utils/types";
import { createSignal, Match, Show, Switch } from "solid-js";

export const PoolPage = () => {
  const { isAuthorized } = useAuth();
  const { icpSwapUsdExchangeRates } = useTokens();
  const { totals, fetchTotals, canPledgePool, pledgePool } = useBurner();
  const { pid, claimPoolBurnReward } = useWallet();

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
      <Show when={value()}>
        <Switch>
          <Match when={value()!.min.eq(value()!.max)}>
            <div class="flex items-center gap-1">
              <span class="text-2xl font-semibold">~</span>
              <p class="font-semibold sm:text-[4rem] leading-[3.5rem]">
                {value()!.min.toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 2 })}
              </p>
            </div>
          </Match>
          <Match when={!value()!.min.eq(value()!.max)}>
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
          </Match>
        </Switch>
      </Show>
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

            <Show when={isAuthorized()}>
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

            <Show when={isAuthorized()}>
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

      <div class="grid grid-cols-4 gap-6">
        <Bento class="col-span-3 flex-col justify-end" id={5}>
          <div class="flex flex-row gap-4 items-end justify-between">
            <div class="flex flex-col gap-4">
              <p class="text-gray-165 font-semibold text-xl">Burn Minting</p>
              <div class="col-span-5">{poolCut()}</div>
            </div>
            <p class="flex flex-row gap-1 text-lg col-span-2">
              <span class="text-orange font-semibold">$BURN</span> <span>/</span> <span>hour</span>
            </p>
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
