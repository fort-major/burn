import { ROOT } from "@/routes";
import { Btn } from "@components/btn";
import { EIconKind, Icon } from "@components/icon";
import { Logo } from "@components/logo";
import { Modal } from "@components/modal";
import { ProfileMicro, ProfileMini } from "@components/profile/profile";
import { areWeOnMobile } from "@pages/home";
import { A, useNavigate } from "@solidjs/router";
import { TAuthProvider, useAuth } from "@store/auth";
import { COLORS } from "@utils/colors";
import { ErrorCode, logErr } from "@utils/error";
import { eventHandler } from "@utils/security";
import { createSignal, Match, Show, Switch } from "solid-js";

export interface IHeaderProps {
  class?: string;
}

export function Header(props: IHeaderProps) {
  const navigate = useNavigate();
  const { isAuthorized, authorize, deauthorize } = useAuth();
  const [expanded, setExpanded] = createSignal(false);
  const [authModalVisible, setAuthModalVisible] = createSignal(false);

  const handleAuth = async (provider: TAuthProvider) => {
    if (areWeOnMobile() && provider === "MSQ") {
      logErr(ErrorCode.AUTH, "Mobile Not Supported!");
      return;
    }

    await authorize(provider, false);
    setAuthModalVisible(false);

    navigate(ROOT.$.pool.path);
  };

  const handleSignInClick = () => {
    setExpanded(false);
    setAuthModalVisible(true);
  };

  const selectAuthProviderForm = (
    <div class="flex flex-col gap-4">
      <Btn
        text="MSQ - MetaMask"
        icon={EIconKind.MetaMask}
        class="rounded-full h-[50px] self-stretch text-black font-semibold"
        onClick={() => handleAuth("MSQ")}
        bgColor={COLORS.chartreuse}
      />
      <Btn
        text="Internet Identity"
        icon={EIconKind.InternetComputer}
        class="rounded-full h-[50px] self-stretch text-black font-semibold"
        onClick={() => handleAuth("II")}
        bgColor={COLORS.white}
      />
    </div>
  );

  return (
    <>
      <header
        class="fixed gap-10 md:gap-20 z-40 top-0 left-0 right-0 w-full md:h-[80px] bg-black flex flex-col px-5 py-3 md:pb-3 md:px-10 md:py-4 md:flex-row md:justify-between md:items-center md:border-b md:border-b-gray-120"
        classList={{ [props.class!]: !!props.class }}
      >
        <div class="flex justify-between items-center md:justify-start">
          <A href={ROOT.path}>
            <Logo class="h-[24px] md:h-[36px] w-[120px] md:w-[160px] relative" />
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
          class="md:flex flex-grow items-center justify-between gap-10 md:gap-5"
          classList={{
            "flex flex-col": expanded(),
            hidden: !expanded(),
          }}
        >
          <nav class="flex flex-col md:flex-row items-center gap-10 font-semibold text-white">
            <Show when={isAuthorized()}>
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
            </Show>

            <A
              activeClass="underline"
              class="hover:underline"
              onClick={eventHandler(() => {
                setExpanded(false);
              })}
              href={ROOT.$.info.path}
            >
              Info
            </A>
          </nav>

          <Switch>
            <Match when={!isAuthorized()}>
              <Btn
                text="Sign In"
                class="rounded-full h-[50px] self-stretch sm:self-start font-semibold"
                onClick={handleSignInClick}
                bgColor={COLORS.chartreuse}
              />
            </Match>
            <Match when={isAuthorized()}>
              <div class="gap-4 items-center flex pb-4 md:pb-0 md:pl-4 md:border-l border-l-gray-120">
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
      <Show when={authModalVisible()}>
        <Modal title="Select Login Method" onClose={() => setAuthModalVisible(false)}>
          {selectAuthProviderForm}
        </Modal>
      </Show>
    </>
  );
}
