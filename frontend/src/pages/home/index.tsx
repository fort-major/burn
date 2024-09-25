import { Copyable } from "@components/copyable";
import { EIconKind, Icon } from "@components/icon";
import { useAuth } from "@store/auth";
import { useBurner } from "@store/burner";
import { COLORS } from "@utils/colors";
import { E8s } from "@utils/math";
import { eventHandler } from "@utils/security";
import { IClass, ONE_MIN_NS, ONE_SEC_NS } from "@utils/types";
import { createEffect, createSignal, For, JSX, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";

const Btn = (props: {
  color: string;
  text?: string;
  icon: EIconKind;
  onClick?: () => void;
  linkTo?: string;
  linkTarget?: string;
  iconSize?: number;
  iconColor?: string;
  class?: string;
  innerClass?: string;
  shadow?: string;
}) => {
  const c = () => (
    <div
      class="flex items-center gap-2 rounded-full py-4 px-6 h-[50px]"
      style={{
        background: props.color,
        "box-shadow": props.shadow ? props.shadow : "",
      }}
      classList={{
        [props.innerClass!]: !!props.innerClass,
        "w-[50px]": !props.text,
        "justify-center": !props.text,
      }}
    >
      <Show when={props.text}>
        <span class="font-primary font-semibold text-nowrap text-sm sm:text-md text-white leading-4">{props.text}</span>
      </Show>
      <Icon size={props.iconSize} kind={props.icon} color={props.iconColor ?? COLORS.white} />
    </div>
  );

  return (
    <Switch>
      <Match when={props.onClick}>
        <button
          class="bg-none flex border-none"
          classList={{ [props.class!]: !!props.class }}
          onClick={() => eventHandler(props.onClick!)}
        >
          {c()}
        </button>
      </Match>
      <Match when={props.linkTo}>
        <a href={props.linkTo!} target={props.linkTarget} classList={{ [props.class!]: !!props.class }}>
          {c()}
        </a>
      </Match>
    </Switch>
  );
};

const AboutCard = (props: { title: string; desc: string; class?: string; btn?: JSX.Element; whiteText?: boolean }) => (
  <div class="flex flex-col gap-4 px-6 sm:px-10 py-10 rounded-[24px]" classList={{ [props.class!]: !!props.class }}>
    <h4 class="font-semibold text-[32px] leading-[32px] tracking-tight">{props.title}</h4>
    <p class="font-normal text-md leading-[150%] text-gray-175" classList={{ ["text-white"]: !!props.whiteText }}>
      {props.desc}
    </p>
    <Show when={props.btn}>{props.btn}</Show>
  </div>
);

const getColsNum = () => {
  if (window.innerWidth >= 1536) return 4;
  if (window.innerWidth >= 1024) return 3;
  if (window.innerWidth >= 640) return 2;
  return 1;
};

const AboutCols = (props: { children: JSX.Element[] }) => {
  const [cols, setCols] = createSignal(getColsNum());

  const listener = () => {
    setCols(getColsNum());
  };

  onMount(() => {
    window.addEventListener("resize", listener);
  });

  onCleanup(() => {
    window.removeEventListener("resize", listener);
  });

  return (
    <div class="grid gap-5 lg:gap-10 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      <For each={Array(cols()).fill(0)}>
        {(_, idx) => (
          <div class="flex flex-col gap-5 lg:gap-10">
            <For each={props.children.filter((_, id) => id % cols() === idx())}>{(child) => child}</For>
          </div>
        )}
      </For>
    </div>
  );
};

const Stat = (props: { title: string; data?: string }) => (
  <div
    style={{ direction: "ltr" }}
    class="flex flex-row items-center justify-between sm:items-start sm:justify-start sm:flex-col gap-5 pt-5 sm:pt-0 sm:pl-10 border-t sm:border-t-0 sm:border-l border-gray-120"
  >
    <h4 class="font-semibold text-xs sm:text-md leading-[150%] text-gray-150">{props.title}</h4>
    <p class="font-semibold text-white text-right sm:text-left text-5xl sm:text-[80px] tracking-tight leading-[100%]">
      {props.data ?? "Loading..."}
    </p>
  </div>
);

export const areWeOnMobile = () => window.innerWidth <= 640;

export function HomePage() {
  const { isReadyToFetch } = useAuth();
  const { totals, poolMembers, fetchPoolMembers } = useBurner();

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

  const circulatingSupply = () => totals.data?.totalBurnTokenMinted;
  const totalSupply = () => {
    const c = circulatingSupply();
    if (!c) return;

    const nonMinted = poolMembers()
      .map((it) => it.unclaimedReward)
      .reduce((prev, cur) => prev.add(cur), E8s.zero());

    return c.add(nonMinted);
  };

  return (
    <div class="bg-black text-white relative flex flex-col gap-20 pb-32 sm:pb-10">
      <div class="fixed bottom-5 right-5 z-10 flex sm:hidden gap-2">
        <Btn
          icon={EIconKind.Twitter}
          linkTo="https://x.com/msqwallet"
          linkTarget="_blank"
          color={COLORS.white}
          iconSize={24}
          innerClass="px-[8px] py-[8px]"
          shadow="2px 2px 15px rgba(0, 0, 0, .25)"
          iconColor={COLORS.black}
        />
        <Btn
          icon={EIconKind.Github}
          linkTo="https://github.com/fort-major/burn"
          linkTarget="_blank"
          color={COLORS.white}
          iconSize={24}
          innerClass="px-[8px] py-[8px]"
          shadow="2px 2px 15px rgba(0, 0, 0, .25)"
          iconColor={COLORS.black}
        />
      </div>

      <div class="flex flex-col relative h-[calc(100svh-48px)] lg:h-[calc(100dvh-80px)]">
        <Switch>
          <Match when={areWeOnMobile()}>
            <img src="/heroscreen-mobile.svg" class="absolute w-full bottom-0 left-0 right-0 rounded-b-3xl" />
          </Match>
          <Match when={!areWeOnMobile()}>
            <img src="/heroscreen-pc.svg" class="absolute w-full bottom-0 left-0 right-0 rounded-b-3xl" />
          </Match>
        </Switch>

        <div class="relative flex flex-col gap-12 sm:pt-20 pb-40 pt-10 px-5 lg:px-20 lg:flex-row lg:gap-5 sm:items-center sm:justify-center bg-gradient-to-b from-50% from-black">
          <div class="flex flex-col lg:self-auto items-center justify-between sm:justify-center gap-14 sm:gap-10">
            <h2 class="font-primary font-semibold text-4xl leading-9 lg:text-[80px] lg:leading-[80px] tracking-tight text-center max-w-6xl">
              <span class="sm:text-nowrap">The Most Advanced</span> <span class="sm:text-nowrap">Memecoin Miner</span>{" "}
              <span class="sm:text-nowrap">on the Internet Computer</span>
            </h2>

            <div class="flex flex-col-reverse sm:flex-row gap-14 sm:gap-5 items-center">
              <div class="hidden sm:flex gap-2">
                <Btn
                  icon={EIconKind.Twitter}
                  linkTo="https://x.com/msqwallet"
                  linkTarget="_blank"
                  color={COLORS.white}
                  iconSize={24}
                  innerClass="px-[8px] py-[8px]"
                  shadow="2px 2px 15px rgba(0, 0, 0, .25)"
                  iconColor={COLORS.black}
                />
                <Btn
                  icon={EIconKind.Github}
                  linkTo="https://github.com/fort-major/burn"
                  linkTarget="_blank"
                  color={COLORS.white}
                  iconSize={24}
                  innerClass="px-[8px] py-[8px]"
                  shadow="2px 2px 15px rgba(0, 0, 0, .25)"
                  iconColor={COLORS.black}
                />
              </div>

              <div class="flex flex-grow gap-2 items-center">
                <img src="/LogoWhite.svg" class="w-[50px] h-[50px] rounded-full" />
                <div class="flex flex-col gap-1">
                  <p class="font-bold text-wrap text-md">
                    BURN <span class="font-light">ICRC-1/2</span>
                  </p>
                  <Copyable text={import.meta.env.VITE_BURN_TOKEN_CANISTER_ID} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-10 px-5 sm:my-28 lg:px-20">
        <h3 class="font-primary font-semibold text-2xl">Stats</h3>
        <Show when={totals.data}>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-y-16">
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
            <Show when={totalSupply()}>
              <Stat
                data={totalSupply()!.toDynamic().toShortString({ belowOne: 4, belowThousand: 1, afterThousand: 1 })}
                title="Total BURN Supply"
              />
            </Show>
            <Show when={totals.data!.totalVerifiedAccounts > 0}>
              <Stat data={totals.data!.totalVerifiedAccounts.toString()} title="Verified Accounts" />
            </Show>
          </div>
        </Show>
      </div>

      <div class="flex flex-col gap-10 px-5 lg:px-20">
        <h3 class="font-primary font-semibold text-2xl">How It Works</h3>
        <AboutCols>
          <AboutCard
            class="bg-gray-120"
            title="One Big Superpool"
            desc="BURN is a fair miner - all pool members get a piece of 
            reward from each minted block, proportional to their share. The more 
            ICP you burn, the bigger your share!"
          />
          <AboutCard
            class="bg-gray-120"
            title="Everybody has a Chance"
            desc="Half of each block reward is distributed to a single lucky pool member, with no respect to their pool share. To take part in this 'lottery', verify your account via Decide AI."
          />
          <AboutCard
            class="bg-gray-110"
            title="Green & Efficient"
            desc="Unlike other similar projects, BURN doesn't waste IC's compute power, 
            loading nodes with useless tasks. Instead, it uses special API, 
            which allows it to burn ICP (cycles) much faster, without 
            any negative impact on the network and the environment!"
          />
          <AboutCard
            class="bg-gray-105"
            title="Fuel Burns, You Know"
            desc="Each block each pool member loses a little piece of their share. 
            This enables a dynamic environment, where new people can join the fun 
            even if they're really late."
          />
          <AboutCard
            class="bg-gray-120"
            title="Simple Tokenomics"
            desc="The block reward is halved once per each 5040 blocks (~1 week), 
            until it reaches 0.0014 BURN per block (~1 BURN a day). This 
            keeps the inflation reasonable, stimulating the value over time."
          />
        </AboutCols>
      </div>

      <div class="flex mt-10 w-full h-auto items-center justify-center relative">
        <PoweredByIc />
      </div>
    </div>
  );
}

const PoweredByIc = (props: IClass & { color?: string }) => (
  <svg class={props.class} width="332" height="24" viewBox="0 0 332 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M0.935547 16.7999V3.35986H5.52435C6.59955 3.35986 7.48275 3.53906 8.17395 3.89746C8.86515 4.25587 9.37714 4.73587 9.70995 5.33746C10.0427 5.93906 10.2092 6.62386 10.2092 7.39186C10.2092 8.12146 10.0427 8.79346 9.70995 9.40786C9.38995 10.0095 8.88435 10.4959 8.19315 10.8671C7.50195 11.2255 6.61234 11.4047 5.52435 11.4047H2.85555V16.7999H0.935547ZM2.85555 9.81106H5.44755C6.45874 9.81106 7.17555 9.59347 7.59795 9.15826C8.03314 8.71027 8.25075 8.12146 8.25075 7.39186C8.25075 6.61106 8.03314 6.00946 7.59795 5.58706C7.17555 5.16466 6.45874 4.95346 5.44755 4.95346H2.85555V9.81106Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M15.6714 17.0302C14.7627 17.0302 13.9434 16.819 13.2138 16.3966C12.4971 15.9742 11.9274 15.3854 11.505 14.6302C11.0954 13.8622 10.8906 12.979 10.8906 11.9806C10.8906 10.9566 11.1018 10.067 11.5242 9.31178C11.9466 8.54378 12.5226 7.94858 13.2522 7.52618C13.9818 7.10378 14.8011 6.89258 15.7098 6.89258C16.6314 6.89258 17.4507 7.10378 18.1674 7.52618C18.8842 7.94858 19.4475 8.53738 19.857 9.29258C20.2794 10.0478 20.4906 10.9374 20.4906 11.9614C20.4906 12.9854 20.2794 13.8749 19.857 14.6302C19.4475 15.3854 18.8778 15.9742 18.1482 16.3966C17.4186 16.819 16.593 17.0302 15.6714 17.0302ZM15.6714 15.379C16.1962 15.379 16.6698 15.251 17.0922 14.995C17.5275 14.7389 17.8731 14.3614 18.129 13.8622C18.3978 13.3502 18.5322 12.7166 18.5322 11.9614C18.5322 11.2062 18.4042 10.579 18.1482 10.0798C17.8923 9.56777 17.5467 9.18377 17.1114 8.92778C16.689 8.67178 16.2219 8.54378 15.7098 8.54378C15.1978 8.54378 14.7243 8.67178 14.289 8.92778C13.8538 9.18377 13.5018 9.56777 13.233 10.0798C12.9771 10.579 12.849 11.2062 12.849 11.9614C12.849 12.7166 12.9771 13.3502 13.233 13.8622C13.5018 14.3614 13.8474 14.7389 14.2698 14.995C14.7051 15.251 15.1722 15.379 15.6714 15.379Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M23.9861 16.7999L21.1445 7.12305H23.0453L25.1573 15.1871L24.7925 15.1679L27.1349 7.12305H29.2853L31.6277 15.1679L31.2629 15.1871L33.3557 7.12305H35.2949L32.4533 16.7999H30.4757L28.0181 8.40945H28.4021L25.9445 16.7999H23.9861Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M40.6838 17.0302C39.7622 17.0302 38.9431 16.819 38.2262 16.3966C37.5094 15.9742 36.9463 15.3854 36.5366 14.6302C36.1399 13.8749 35.9414 12.9982 35.9414 11.9998C35.9414 10.9758 36.1399 10.0862 36.5366 9.33098C36.9463 8.56298 37.5094 7.96778 38.2262 7.54538C38.9431 7.11017 39.775 6.89258 40.7222 6.89258C41.6695 6.89258 42.4822 7.10378 43.1606 7.52618C43.8391 7.94858 44.3638 8.51177 44.735 9.21578C45.1063 9.90698 45.2918 10.675 45.2918 11.5198C45.2918 11.6478 45.2854 11.7886 45.2726 11.9422C45.2726 12.083 45.2662 12.2429 45.2534 12.4222H37.343V11.059H43.3718C43.3334 10.2526 43.0646 9.62537 42.5654 9.17738C42.0662 8.71658 41.4454 8.48618 40.703 8.48618C40.1782 8.48618 39.6982 8.60777 39.263 8.85098C38.8279 9.08138 38.4758 9.42698 38.207 9.88778C37.951 10.3358 37.823 10.9054 37.823 11.5966V12.1342C37.823 12.851 37.951 13.459 38.207 13.9582C38.4758 14.4446 38.8279 14.8157 39.263 15.0718C39.6982 15.3149 40.1719 15.4366 40.6838 15.4366C41.2982 15.4366 41.8039 15.3022 42.2006 15.0334C42.5974 14.7646 42.8918 14.3998 43.0838 13.939H45.0038C44.8375 14.5277 44.5558 15.059 44.159 15.5326C43.7623 15.9934 43.2694 16.3582 42.6806 16.627C42.1046 16.8958 41.4391 17.0302 40.6838 17.0302Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M47.041 16.7998V7.12298H48.769L48.9418 8.94698C49.1595 8.51177 49.441 8.14697 49.7866 7.85258C50.1322 7.54538 50.5354 7.30858 50.9962 7.14218C51.4699 6.97577 52.0075 6.89258 52.609 6.89258V8.92778H51.9178C51.5211 8.92778 51.1435 8.97898 50.785 9.08138C50.4267 9.17098 50.1067 9.33098 49.825 9.56138C49.5562 9.79178 49.345 10.1054 49.1914 10.5022C49.0378 10.899 48.961 11.3918 48.961 11.9806V16.7998H47.041Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M58.0842 17.0302C57.1626 17.0302 56.3435 16.819 55.6266 16.3966C54.9098 15.9742 54.3467 15.3854 53.937 14.6302C53.5403 13.8749 53.3418 12.9982 53.3418 11.9998C53.3418 10.9758 53.5403 10.0862 53.937 9.33098C54.3467 8.56298 54.9098 7.96778 55.6266 7.54538C56.3435 7.11017 57.1754 6.89258 58.1226 6.89258C59.0699 6.89258 59.8826 7.10378 60.561 7.52618C61.2395 7.94858 61.7642 8.51177 62.1354 9.21578C62.5067 9.90698 62.6922 10.675 62.6922 11.5198C62.6922 11.6478 62.6858 11.7886 62.6731 11.9422C62.6731 12.083 62.6666 12.2429 62.6538 12.4222H54.7434V11.059H60.7722C60.7338 10.2526 60.4651 9.62537 59.9658 9.17738C59.4666 8.71658 58.8458 8.48618 58.1034 8.48618C57.5786 8.48618 57.0986 8.60777 56.6634 8.85098C56.2283 9.08138 55.8762 9.42698 55.6075 9.88778C55.3514 10.3358 55.2234 10.9054 55.2234 11.5966V12.1342C55.2234 12.851 55.3514 13.459 55.6075 13.9582C55.8762 14.4446 56.2283 14.8157 56.6634 15.0718C57.0986 15.3149 57.5723 15.4366 58.0842 15.4366C58.6986 15.4366 59.2043 15.3022 59.601 15.0334C59.9978 14.7646 60.2922 14.3998 60.4842 13.939H62.4042C62.2379 14.5277 61.9562 15.059 61.5594 15.5326C61.1627 15.9934 60.6698 16.3582 60.081 16.627C59.505 16.8958 58.8395 17.0302 58.0842 17.0302Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M68.7418 17.0305C67.8202 17.0305 67.0073 16.8128 66.3034 16.3777C65.5993 15.9296 65.0489 15.3281 64.6522 14.5729C64.2682 13.8049 64.0762 12.9344 64.0762 11.9617C64.0762 10.9761 64.2682 10.1057 64.6522 9.35047C65.0489 8.59528 65.5993 8.00008 66.3034 7.56487C67.0201 7.11688 67.8394 6.89287 68.761 6.89287C69.5161 6.89287 70.1818 7.04647 70.7578 7.35367C71.3338 7.64807 71.7817 8.07047 72.1018 8.62087V2.97607H74.0218V16.8001H72.2938L72.1018 15.3025C71.9098 15.5969 71.6602 15.8785 71.353 16.1473C71.0458 16.4033 70.6745 16.6145 70.2394 16.7809C69.8041 16.9472 69.3049 17.0305 68.7418 17.0305ZM69.049 15.3601C69.6505 15.3601 70.1818 15.2192 70.6426 14.9377C71.1034 14.6561 71.4553 14.2592 71.6986 13.7473C71.9545 13.2353 72.0826 12.6401 72.0826 11.9617C72.0826 11.2833 71.9545 10.6945 71.6986 10.1953C71.4553 9.68327 71.1034 9.28648 70.6426 9.00487C70.1818 8.71048 69.6505 8.56327 69.049 8.56327C68.473 8.56327 67.9546 8.71048 67.4938 9.00487C67.033 9.28648 66.6745 9.68327 66.4186 10.1953C66.1625 10.6945 66.0346 11.2833 66.0346 11.9617C66.0346 12.6401 66.1625 13.2353 66.4186 13.7473C66.6745 14.2592 67.033 14.6561 67.4938 14.9377C67.9546 15.2192 68.473 15.3601 69.049 15.3601Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M86.072 17.0305C85.5472 17.0305 85.0672 16.9537 84.632 16.8001C84.2096 16.6592 83.8384 16.4609 83.5184 16.2049C83.1984 15.9488 82.9296 15.6545 82.712 15.3217L82.52 16.8001H80.792V2.97607H82.712V8.64007C83.0192 8.15368 83.448 7.74407 83.9984 7.41127C84.5616 7.06567 85.2528 6.89287 86.072 6.89287C86.9936 6.89287 87.8064 7.11688 88.5104 7.56487C89.2144 8.00008 89.7584 8.60167 90.1424 9.36967C90.5392 10.1249 90.7376 10.9953 90.7376 11.9809C90.7376 12.9409 90.5392 13.8049 90.1424 14.5729C89.7584 15.3409 89.2144 15.9425 88.5104 16.3777C87.8064 16.8128 86.9936 17.0305 86.072 17.0305ZM85.7648 15.3601C86.3536 15.3601 86.872 15.2192 87.32 14.9377C87.7808 14.6561 88.1392 14.2592 88.3952 13.7473C88.664 13.2353 88.7984 12.6401 88.7984 11.9617C88.7984 11.2833 88.664 10.6945 88.3952 10.1953C88.1392 9.68327 87.7808 9.28648 87.32 9.00487C86.872 8.71048 86.3536 8.56327 85.7648 8.56327C85.1632 8.56327 84.632 8.71048 84.1712 9.00487C83.7232 9.28648 83.3712 9.68327 83.1152 10.1953C82.8592 10.6945 82.7312 11.2833 82.7312 11.9617C82.7312 12.6401 82.8592 13.2353 83.1152 13.7473C83.3712 14.2592 83.7232 14.6561 84.1712 14.9377C84.632 15.2192 85.1632 15.3601 85.7648 15.3601Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M92.9027 21.0239L95.2643 15.7247H94.7075L90.8867 7.12305H92.9603L95.9939 14.1503L99.0467 7.12305H101.063L94.9187 21.0239H92.9027Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M165.706 12C165.706 5.38235 159.958 0 152.911 0C149.968 0 146.768 1.45589 143.378 4.32353C141.779 5.68235 140.389 7.12942 139.338 8.29412C135.683 4.35882 130.765 0 125.857 0C119.926 0 114.762 3.96176 113.41 9.21176C113.41 9.20294 113.41 9.20294 113.419 9.19411C113.419 9.20294 113.419 9.20294 113.41 9.21176C113.181 10.1118 113.062 11.0382 113.062 12C113.062 18.6176 118.72 24 125.766 24C128.71 24 132 22.5442 135.39 19.6765C136.99 18.3176 138.379 16.8706 139.43 15.7058C143.095 19.65 148.012 24 152.92 24C158.851 24 164.015 20.0382 165.368 14.7882C165.587 13.8882 165.706 12.9618 165.706 12ZM140.326 8.28529C141.523 6.97942 142.711 5.82353 143.862 4.85294C147.116 2.1 150.16 0.705882 152.911 0.705882C159.564 0.705882 164.975 5.77058 164.975 12C164.975 12.8735 164.866 13.7471 164.646 14.5942C164.609 14.6911 164.171 15.8647 162.91 17.0029C161.264 18.4853 159.043 19.2353 156.301 19.2353C159.253 18 161.32 15.2118 161.32 12C161.32 7.63235 157.544 4.07647 152.911 4.07647C151.102 4.07647 148.889 5.17058 146.33 7.34118C145.178 8.31176 144.018 9.45882 142.784 10.8265L142.3 11.3647L139.823 8.81471L140.326 8.28529ZM135.956 12.1147C134.978 13.2353 133.572 14.7618 131.954 16.1294C128.938 18.6794 126.982 19.2176 125.857 19.2176C121.626 19.2176 118.18 15.9794 118.18 12C118.18 8.04706 121.626 4.80882 125.857 4.78235C126.013 4.78235 126.196 4.8 126.425 4.83529C128.609 5.64706 130.555 6.92647 131.725 7.96765C132.676 8.80589 134.384 10.5177 135.956 12.1147ZM138.443 15.7147C137.245 17.0206 136.057 18.1765 134.906 19.1471C131.698 21.8647 128.536 23.2942 125.766 23.2942C122.558 23.2942 119.542 22.1206 117.285 19.9765C115.037 17.85 113.794 15.0176 113.794 12C113.794 11.1265 113.903 10.2529 114.123 9.40589C114.159 9.30882 114.598 8.13529 115.859 6.99706C117.504 5.51471 119.725 4.76471 122.467 4.76471C119.515 6 117.449 8.78824 117.449 12C117.449 16.3676 121.224 19.9235 125.857 19.9235C127.668 19.9235 129.88 18.8294 132.438 16.6589C133.59 15.6882 134.75 14.5411 135.984 13.1735L136.469 12.6353C136.469 12.6353 138.908 15.15 138.928 15.1765L138.443 15.7147ZM142.812 11.8853C143.79 10.7647 145.196 9.23824 146.815 7.87058C149.831 5.32058 151.787 4.78235 152.911 4.78235C157.142 4.78235 160.588 8.02058 160.588 12C160.588 15.9529 157.142 19.1911 152.911 19.2176C152.755 19.2176 152.573 19.2 152.344 19.1647C152.344 19.1647 152.344 19.1647 152.353 19.1647C150.169 18.3529 148.222 17.0647 147.043 16.0235C146.093 15.1942 144.384 13.4824 142.812 11.8853ZM165.349 14.7971C165.349 14.7882 165.349 14.7882 165.349 14.7882V14.7971Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path d="M171.272 16.9765V7.00586H174.05V16.9765H171.272Z" fill={props.color ?? "#A9AAAD"} />
    <path
      d="M182.633 16.9765L179.05 11.0559V16.9765H176.354V7.00586H179.498L182.715 12.4235V7.00586H185.421V16.9765H182.633Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M192.594 9.49409V16.9765H189.852V9.49409H186.882V7.00586H195.573V9.49409H192.594Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M197.036 7.00586H203.653V9.28232H199.751V10.8617H203.306V13.0589H199.751V14.6647H203.681V16.9853H197.036V7.00586Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M205.617 16.9765V7.00586H209.977C212.079 7.00586 213.441 8.35586 213.441 10.2088C213.441 11.5588 212.673 12.5558 211.531 12.9971L213.487 16.9765H210.525L208.89 13.3589H208.323V16.9765H205.617ZM209.466 11.3382C210.279 11.3382 210.699 10.8882 210.699 10.2529C210.699 9.61762 210.279 9.18526 209.466 9.18526H208.332V11.3382H209.466Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M221.493 16.9765L217.91 11.0559V16.9765H215.214V7.00586H218.358L221.575 12.4235V7.00586H224.281V16.9765H221.493Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M226.594 7.00586H233.211V9.28232H229.308V10.8617H232.863V13.0589H229.308V14.6647H233.238V16.9853H226.594V7.00586Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M240.494 9.49409V16.9765H237.752V9.49409H234.782V7.00586H243.474V9.49409H240.494Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M250.155 11.9999C250.155 13.6587 251.38 14.6117 252.631 14.6117C254.058 14.6117 254.67 13.7557 254.89 13.0499L257.458 13.7646C257.046 15.2381 255.684 17.1793 252.623 17.1793C249.753 17.1793 247.331 15.1675 247.331 11.9999C247.331 8.82339 249.79 6.78516 252.586 6.78516C255.557 6.78516 256.909 8.53221 257.339 10.0234L254.817 10.8528C254.625 10.191 254.076 9.31752 252.613 9.31752C251.443 9.32634 250.155 10.1822 250.155 11.9999Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M263.627 6.79395C266.468 6.79395 268.927 8.76159 268.927 11.9998C268.927 15.238 266.468 17.2057 263.627 17.2057C260.784 17.2057 258.325 15.238 258.325 11.9998C258.325 8.76159 260.784 6.79395 263.627 6.79395ZM263.627 14.6557C264.833 14.6557 266.122 13.8263 266.122 11.9822C266.122 10.1645 264.842 9.33511 263.627 9.33511C262.411 9.33511 261.131 10.1645 261.131 11.9822C261.131 13.8263 262.42 14.6557 263.627 14.6557Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M279.731 16.9765V10.8L277.473 16.9765H275.316L273.077 10.8706V16.9765H270.481V7.00586H274.11L276.421 13.0853L278.634 7.00586H282.363V16.9765H279.731Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M287.371 13.5794V16.9852H284.665V7.01465H288.787C290.945 7.01465 292.416 8.38229 292.416 10.3058C292.416 12.2734 290.945 13.5794 288.787 13.5794H287.371ZM288.44 11.3911C289.153 11.3911 289.674 10.9852 289.674 10.3058C289.674 9.59994 289.153 9.2117 288.44 9.2117H287.389V11.3911H288.44Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M293.823 13.3235V7.00586H296.546V13.2353C296.546 14.2235 297.068 14.7441 297.973 14.7441C298.878 14.7441 299.389 14.2235 299.389 13.2353V7.00586H302.113V13.3235C302.113 15.8294 300.376 17.2058 297.973 17.2058C295.578 17.2058 293.823 15.8294 293.823 13.3235Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M309.278 9.49409V16.9765H306.536V9.49409H303.566V7.00586H312.258V9.49409H309.278Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M313.729 7.00586H320.346V9.28232H316.444V10.8617H319.999V13.0589H316.444V14.6647H320.374V16.9853H313.729V7.00586Z"
      fill={props.color ?? "#A9AAAD"}
    />
    <path
      d="M322.394 16.9765V7.00586H326.753C328.856 7.00586 330.218 8.35586 330.218 10.2088C330.218 11.5588 329.45 12.5558 328.307 12.9971L330.263 16.9765H327.302L325.666 13.3589H325.1V16.9765H322.394ZM326.242 11.3382C327.054 11.3382 327.476 10.8882 327.476 10.2529C327.476 9.61762 327.054 9.18526 326.242 9.18526H325.108V11.3382H326.242Z"
      fill={props.color ?? "#A9AAAD"}
    />
  </svg>
);
