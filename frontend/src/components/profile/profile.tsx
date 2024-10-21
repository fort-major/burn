import { COLORS } from "@utils/colors";
import { IClass } from "../../utils/types";
import { Avatar } from "../avatar";
import { avatarSrcFromPrincipal } from "@utils/common";
import { eventHandler } from "@utils/security";
import { useAuth } from "@store/auth";
import { createEffect, createResource, createSignal, Show } from "solid-js";
import { Copyable } from "@components/copyable";
import { BalanceOf } from "@components/balance-of";
import { useBurner } from "@store/burner";
import { Principal } from "@dfinity/principal";
import { DEFAULT_TOKENS } from "@store/tokens";
import { Identity } from "@fort-major/agent-js-fork";
import { makeAvatarSvg } from "@fort-major/msq-shared";
import { MsqIdentity } from "@fort-major/msq-client";
import { generateRandomPseudonym } from "@utils/pseudonym";
import { Btn } from "@components/btn";
import { Modal } from "@components/modal";
import { EIconKind, Icon } from "@components/icon";

export interface IProfileProps extends IClass {
  avatarSize?: "sm" | "md" | "lg";
  onClick?: () => void;
}

export function ProfileFull(props: IProfileProps) {
  const { identity, isAuthorized, authProvider } = useAuth();
  const { totals, canMigrateMsqAccount, migrateMsqAccount, canVerifyDecideId, verifyDecideId } = useBurner();

  const [migratePopupVisible, setMigratePopupVisible] = createSignal(false);

  const [pseudonym] = createResource(identity, getPseudonym);
  const [avatarSrc] = createResource(identity, getAvatarSrc);

  const pid = () => {
    if (!isAuthorized()) return undefined;

    return identity()!.getPrincipal();
  };

  const isDecideAIVerified = () => {
    const t = totals.data;
    if (!t) return false;

    return t.yourDecideIdVerificationStatus;
  };

  const isMSQ = () => {
    return authProvider() === "MSQ";
  };

  const handleVerifyDecideIdClick = eventHandler(() => {
    verifyDecideId();
  });

  const handleMigratePopupOpenClick = eventHandler(() => {
    setMigratePopupVisible(true);
  });

  return (
    <>
      <div class="flex gap-10 items-center justify-between">
        <div class="flex gap-5 items-start sm:items-center">
          <Avatar url={avatarSrc()} size="lg" borderColor={isDecideAIVerified() ? COLORS.orange : COLORS.gray[140]} />
          <div class="flex flex-col gap-3">
            <div class="flex flex-row gap-4 items-center">
              <p class="font-semibold text-white text-4xl">{pseudonym() ? pseudonym() : "Anonymous"}</p>
            </div>

            {/* <div class="flex flex-col items-start sm:flex-row sm:items-center gap-4">
              <Show when={isMSQ()}>
                <p class="text-xs text-gray-140">Only Internet Identity users can verify their personhood</p>
              </Show>
              <Show when={canVerifyDecideId()}>
                <div
                  onClick={handleVerifyDecideIdClick}
                  class="flex items-center flex-nowrap justify-center gap-2 text-white font-normal text- rounded-full px-6 py-2 cursor-pointer bg-gray-110"
                >
                  <span class="text-nowrap">Verify via</span>
                  <img class="h-6" src="/decide-id-logo.svg" />
                </div>
              </Show>
              <Show when={isDecideAIVerified()}>
                <p class="flex items-center gap-2 font-semibold text-xs bg-gray-120 h-7 px-2 rounded-lg">
                  Verified For Lottery <Icon kind={EIconKind.CheckCircle} size={15} color={COLORS.chartreuse} />
                </p>
              </Show>
              <Show when={canMigrateMsqAccount()}>
                <p
                  class="underline text-xs text-gray-140 cursor-pointer text-center"
                  onClick={handleMigratePopupOpenClick}
                >
                  Migrate
                </p>
              </Show>
            </div> */}
          </div>
        </div>
      </div>

      <Show when={migratePopupVisible()}>
        <Modal title="Migrate to II" onClose={() => setMigratePopupVisible(false)}>
          <div class="flex flex-col gap-6">
            <div class="flex flex-col gap-2">
              <p class="text-md">
                As an OG pool member, you have a one-time right to migrate your account from MSQ to the Internet
                Identity. Read the following instruction carefully.
              </p>
              <p class="text-md text-gray-140">
                This action is irreversible and it will transfer both: leftover fuel and unclaimed BURN tokens to your
                Internet Identity account. During the migration flow, you will be prompted to authorize via the Internet
                Identity - <span class="font-bold">select the same anchor that you use for Decide ID</span>. After that
                you will be prompted to log out from your MSQ account - click "Approve". After that, the page will
                refresh and you should manually login to your Internet Identity once again.
              </p>
              <p class="font-semibold text-xs text-errorRed">
                Be cautious! After clicking the button below, you won't be able to change your decision! It is advised
                to claim all unclaimed BURN before continuing.
              </p>
            </div>

            <Btn
              text="Continue with"
              icon={EIconKind.InternetComputer}
              bgColor={COLORS.black}
              onClick={migrateMsqAccount}
            />
          </div>
        </Modal>
      </Show>
    </>
  );
}

export function ProfileMini(props: IProfileProps) {
  const { identity } = useAuth();
  const { totals, fetchTotals } = useBurner();

  const [pseudonym] = createResource(identity, getPseudonym);
  const [avatarSrc] = createResource(identity, getAvatarSrc);

  const isDecideAIVerified = () => {
    const t = totals.data;
    if (!t) return false;

    return t.yourDecideIdVerificationStatus;
  };

  return (
    <div class="flex flex-row items-center gap-2">
      <Avatar
        class={props.onClick ? "cursor-pointer" : undefined}
        onClick={props.onClick}
        borderColor={isDecideAIVerified() ? COLORS.orange : COLORS.gray[140]}
        url={avatarSrc()}
        size={props.avatarSize ?? "md"}
      />
      <div class="flex flex-col text-white gap-1">
        <p class="font-primary text-xs font-bold">{pseudonym()}</p>
        <Copyable text={identity()!.getPrincipal().toText()} ellipsis ellipsisSymbols={20} />
      </div>
    </div>
  );
}

export function ProfileMicro(props: IProfileProps) {
  const { identity } = useAuth();

  const [avatarSrc] = createResource(identity, getAvatarSrc);

  return (
    <div
      class="flex flex-row items-center gap-2"
      classList={{ "cursor-pointer": !!props.onClick }}
      onClick={props.onClick ? eventHandler(props.onClick) : undefined}
    >
      <Avatar borderColor={COLORS.chartreuse} url={avatarSrc()} size={props.avatarSize ?? "sm"} />
    </div>
  );
}

export function getAvatarSrc(identity: Identity) {
  const pid = identity.getPrincipal();
  const svg = btoa(makeAvatarSvg(pid));

  return `data:image/svg+xml;base64,${svg}`;
}

export function getPseudonym(identity: Identity & Partial<MsqIdentity>) {
  if (identity.getPseudonym) {
    return identity.getPseudonym();
  }

  return generateRandomPseudonym(identity.getPrincipal());
}
