import { ROOT } from "@/routes";
import { Btn } from "@components/btn";
import { EIconKind, Icon } from "@components/icon";
import { Logo } from "@components/logo";
import { ProfileMicro, ProfileMini } from "@components/profile/profile";
import { areWeOnMobile } from "@pages/home";
import { A } from "@solidjs/router";
import { useAuth } from "@store/auth";
import { COLORS } from "@utils/colors";
import { ErrorCode, logErr } from "@utils/error";
import { eventHandler } from "@utils/security";
import { createSignal, Match, Show, Switch } from "solid-js";

export interface IHeaderProps {
  class?: string;
}

export function Header(props: IHeaderProps) {
  const { isAuthorized, authorize, deauthorize } = useAuth();
  const [expanded, setExpanded] = createSignal(false);

  const clickLogin = () => {
    if (areWeOnMobile()) {
      logErr(ErrorCode.AUTH, "Mobile Not Supported!");
      return;
    }

    authorize();
  };

  return (
    <header
      class="fixed gap-20 z-50 top-0 left-0 right-0 w-full lg:h-[80px] bg-black flex flex-col px-5 py-3 lg:px-10 lg:py-5 lg:flex-row lg:justify-between lg:items-center lg:border-b lg:border-b-gray-120"
      classList={{ [props.class!]: !!props.class }}
    >
      <div class="flex justify-between items-center lg:justify-start">
        <A href={ROOT.path}>
          <Logo class="h-[24px] lg:h-[36px] w-[120px] lg:w-[160px] relative" />
        </A>

        <Icon
          class="lg:hidden cursor-pointer"
          kind={EIconKind.Bars}
          color={COLORS.white}
          hoverColor={COLORS.white}
          onClick={() => setExpanded((v) => !v)}
        />
      </div>

      <div
        class="lg:flex flex-grow items-center"
        classList={{
          "flex flex-col": expanded(),
          hidden: !expanded(),
          "justify-end": !isAuthorized(),
          "justify-between": isAuthorized(),
        }}
      >
        <Show when={isAuthorized()}>
          <nav class="flex items-center gap-10 font-semibold text-white">
            <A
              activeClass="underline"
              class="hover:underline"
              onClick={eventHandler(() => {
                setExpanded(false);
              })}
              href={ROOT.$.pool.path}
            >
              Pool
            </A>
          </nav>
        </Show>

        <Switch>
          <Match when={!isAuthorized()}>
            <Btn
              text="Sign In"
              icon={EIconKind.MetaMask}
              class="rounded-full h-[50px] self-stretch sm:self-start"
              onClick={clickLogin}
              bgColor={COLORS.chartreuse}
            />
          </Match>
          <Match when={isAuthorized()}>
            <div class="gap-4 items-center hidden lg:flex pl-4 border-l border-l-gray-120">
              <ProfileMini onClick={deauthorize} avatarSize="md" />
              <Icon
                kind={EIconKind.Logout}
                class="cursor-pointer"
                color={COLORS.gray[140]}
                hoverColor={COLORS.white}
                onClick={deauthorize}
              />
            </div>
          </Match>
        </Switch>
      </div>
    </header>
  );
}
