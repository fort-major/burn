import { Show } from "solid-js";
import { eventHandler } from "../../utils/security";
import { EIconKind, Icon } from "../icon";
import { useAuth } from "@store/auth";
import { COLORS } from "@utils/colors";

export interface IBtnProps {
  text?: string;
  icon?: EIconKind;
  iconColor?: string;
  iconClass?: string;
  disabled?: boolean;
  onClick?: () => void;
  class?: string;
  bgColor?: string;
}

export function Btn(props: IBtnProps) {
  const { disabled } = useAuth();

  const handleClick = eventHandler(() => props.onClick?.());

  const d = () => props.disabled || disabled();

  return (
    <button
      class="flex items-center justify-center gap-2 px-5 py-2 rounded-full h-[50px] relative"
      classList={{
        [props.class!]: !!props.class,
        "text-gray-140": d(),
      }}
      style={{ "background-color": d() ? COLORS.gray[105] : props.bgColor ? props.bgColor : COLORS.gray[115] }}
      disabled={d()}
      onClick={handleClick}
    >
      <Show when={props.text}>
        <p class="font-primary font-medium text-md select-none">{props.text}</p>
      </Show>
      <Show when={props.icon}>
        <Icon kind={props.icon!} class={props.iconClass} color={d() ? COLORS.gray[140] : props.iconColor} />
      </Show>
    </button>
  );
}
