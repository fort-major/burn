import { ROOT } from "@/routes";
import { Btn } from "@components/btn";
import { EIconKind, Icon } from "@components/icon";
import { Logo } from "@components/logo";
import { ProfileMicro, ProfileMini } from "@components/profile/profile";
import { A } from "@solidjs/router";
import { useAuth } from "@store/auth";
import { COLORS } from "@utils/colors";
import { createSignal, Match, Show, Switch } from "solid-js";

export interface IHeaderProps {
  class?: string;
}

export function Header(props: IHeaderProps) {
  const { isAuthorized, authorize, deauthorize } = useAuth();
  const [expanded, setExpanded] = createSignal(false);

  return (
    <header
      class="fixed gap-20 z-50 top-0 left-0 right-0 w-full lg:h-[80px] bg-black flex px-5 py-3 lg:px-10 lg:py-5 lg:flex-row lg:justify-between lg:items-center lg:border-b lg:border-b-gray-120"
      classList={{ [props.class!]: !!props.class }}
    >
      <div class="flex justify-between items-center lg:justify-start">
        <Logo class="lg:h-[36px] lg:w-[160px] relative" />

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
          flex: expanded(),
          hidden: !expanded(),
          "justify-end": !isAuthorized(),
          "justify-between": isAuthorized(),
        }}
      >
        <Switch>
          <Match when={!isAuthorized()}>
            <Btn
              text="Sign In"
              icon={EIconKind.MetaMask}
              class="rounded-full h-[50px]"
              onClick={authorize}
              bgColor={COLORS.chartreuse}
            />
          </Match>
          <Match when={isAuthorized()}>
            <div class="gap-4 items-center hidden lg:flex pl-4 border-l border-l-gray-120">
              <ProfileMini onClick={deauthorize} avatarSize="md" />
            </div>
          </Match>
        </Switch>
      </div>
    </header>
  );
}
