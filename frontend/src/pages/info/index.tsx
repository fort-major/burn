import { Page } from "@components/page";
import { ReturnCalculator } from "@components/return-calc";
import { useAuth } from "@store/auth";
import { useBurner } from "@store/burner";
import { useFurnace } from "@store/furnace";
import { DEFAULT_TOKENS, useTokens } from "@store/tokens";
import { E8s } from "@utils/math";
import { ONE_SEC_NS } from "@utils/types";
import { createEffect, on, onMount, Show } from "solid-js";

export const InfoPage = () => {
  const { isReadyToFetch } = useAuth();
  const { icpSwapUsdExchangeRates, totalBurnSupply } = useTokens();
  const { totals, poolMembers, fetchPoolMembers } = useBurner();
  const { totalTokensBurned } = useFurnace();

  onMount(() => {
    if (!isReadyToFetch()) return;
    if (poolMembers().length !== 0) return;

    fetchPoolMembers();
  });

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (!ready) return;
      if (poolMembers().length !== 0) return;

      fetchPoolMembers();
    })
  );

  const circulatingSupply = () => {
    const sup = totalBurnSupply() ?? E8s.zero();

    const nonMinted = poolMembers()
      .map((it) => it.unclaimedReward)
      .reduce((prev, cur) => prev.add(cur), E8s.zero());

    return sup.add(nonMinted);
  };
  const totalMined = () => {
    const sup = totals.data?.totalBurnTokenMinted ?? E8s.zero();

    const nonMinted = poolMembers()
      .map((it) => it.unclaimedReward)
      .reduce((prev, cur) => prev.add(cur), E8s.zero());

    return sup.add(nonMinted);
  };
  const totalBurned = () => totalTokensBurned[DEFAULT_TOKENS.burn.toText()]?.toE8s() ?? E8s.zero();

  const burnExchangeRate = () => icpSwapUsdExchangeRates["egjwt-lqaaa-aaaak-qi2aa-cai"] ?? E8s.zero();
  const burnUSDPrice = () =>
    burnExchangeRate()?.toDynamic().toShortString({ belowOne: 4, belowThousand: 2, afterThousand: 2 });

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

      <div class="flex flex-col gap-10">
        <h3 class="font-primary font-semibold text-2xl">Stats</h3>

        <Show when={totals.data}>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-16">
            <Stat
              data={totals.data!.totalTcyclesBurned.toShortString({ belowOne: 4, belowThousand: 2, afterThousand: 0 })}
              title="Total Burned TCycles"
            />
            <Stat
              data={totals.data!.currentBurnTokenReward.toDynamic().toDecimals(4).toString()}
              title="Current Block BURN Reward"
            />
            <Stat data={`${totals.data!.posRoundDelayNs / ONE_SEC_NS}s`} title="Block Time" />
            <Stat data={totals.data!.currentPosRound.toString()} title="Current Block Index" />
            <Show when={totals.data!.currentBurnTokenReward.gt(E8s.new(140000n))}>
              <Stat
                data={(5040n - (totals.data!.currentPosRound % 5040n)).toString() + " blocks"}
                title={"Until Reward Halving"}
              />
            </Show>
            <Stat
              data={circulatingSupply()!.toDynamic().toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 1 })}
              title="Circulating BURN Supply"
            />
            <Stat
              data={totalMined()!.toDynamic().toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 1 })}
              title="Total Minted BURN"
            />
            <Stat
              data={totalBurned()!.toDynamic().toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 1 })}
              title="Total Burned BURN"
            />
            <Show when={totals.data!.totalVerifiedAccounts > 0}>
              <Stat data={totals.data!.totalVerifiedAccounts.toString()} title="Verified Accounts" />
            </Show>
          </div>
        </Show>
      </div>
    </Page>
  );
};

const Stat = (props: { title: string; data?: string }) => (
  <div
    style={{ direction: "ltr" }}
    class="flex flex-row items-center justify-between sm:items-start sm:justify-start sm:flex-col gap-5 pt-5 sm:pt-0 sm:pl-10 border-t sm:border-t-0 sm:border-l border-gray-120"
  >
    <h4 class="font-semibold text-xs sm:text-md leading-[150%] text-gray-150">{props.title}</h4>
    <p class="font-semibold text-white text-right sm:text-left text-5xl sm:text-[60px] tracking-tight leading-[100%]">
      {props.data ?? "Loading..."}
    </p>
  </div>
);
