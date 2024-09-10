import { COLORS } from "@utils/colors";
import { IClass } from "../../utils/types";
import { Avatar } from "../avatar";
import { avatarSrcFromPrincipal } from "@utils/common";
import { eventHandler } from "@utils/security";
import { useAuth } from "@store/auth";
import { createResource } from "solid-js";
import { Copyable } from "@components/copyable";

export interface IProfileProps extends IClass {
  avatarSize?: "sm" | "md" | "lg";
  onClick?: () => void;
}

export function ProfileMini(props: IProfileProps) {
  const { identity } = useAuth();

  const [pseudonym] = createResource(identity, (it) => it.getPseudonym());
  const [avatarSrc] = createResource(identity, (it) => it.getAvatarSrc());

  return (
    <div class="flex flex-row items-center gap-2">
      <Avatar
        class={props.onClick ? "cursor-pointer" : undefined}
        onClick={props.onClick}
        borderColor={COLORS.chartreuse}
        url={avatarSrc()}
        size={props.avatarSize ?? "md"}
      />
      <div class="flex flex-col text-white gap-1">
        <p class="font-primary text-xs font-bold">{pseudonym()}</p>
        <Copyable text={identity()!.getPrincipal().toText()} />
      </div>
    </div>
  );
}

export function ProfileMicro(props: IProfileProps) {
  const { identity } = useAuth();

  const [avatarSrc] = createResource(identity, (it) => it.getAvatarSrc());

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
