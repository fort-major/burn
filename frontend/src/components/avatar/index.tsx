import { Match, Switch } from "solid-js";
import { IClass } from "../../utils/types";
import { eventHandler } from "@utils/security";

export interface IAvatarProps extends IClass {
  url?: string;
  borderColor?: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
}

export function Avatar(props: IAvatarProps) {
  const sizeClass = () =>
    props.size === "lg" ? "size-24 text-4xl" : props.size === "sm" ? "size-6 text-xl" : "size-12 text-2xl";

  const cl = () => (props.class ? props.class : "");

  const handleClick = eventHandler(() => props.onClick?.());

  return (
    <Switch>
      <Match when={props.url}>
        <img
          class={`rounded-full border-2 ${sizeClass()} ${cl()}`}
          style={{ "border-color": props.borderColor ?? "unset" }}
          src={props.url}
          onClick={handleClick}
        />
      </Match>
      <Match when={!props.url}>
        <div
          onClick={handleClick}
          class={`${sizeClass()} ${cl()} rounded-full border bg-gray-150 text-white font-sans font-extrabold animate-pulse flex items-center justify-center`}
        >
          ?
        </div>
      </Match>
    </Switch>
  );
}
