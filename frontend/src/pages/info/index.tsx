import { Page } from "@components/page";
import { ReturnCalculator } from "@components/return-calc";
import { useTokens } from "@store/tokens";
import { E8s } from "@utils/math";

export const InfoPage = () => {
  const { icpSwapUsdExchangeRates } = useTokens();

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

      <div class="flex flex-col gap-4">
        <p class="text-white font-semibold text-4xl">Return Calculator</p>
        <ReturnCalculator />
      </div>
    </Page>
  );
};
