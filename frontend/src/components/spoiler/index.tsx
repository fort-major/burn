import { EIconKind, Icon } from "@components/icon";
import { COLORS } from "@utils/colors";
import { eventHandler } from "@utils/security";
import { IChildren } from "@utils/types";
import { createSignal, Show } from "solid-js";

export interface ISpoilerProps extends IChildren {
  header: string;
  defaultExpanded?: boolean;
  class?: string;
}

export function Spoiler(props: ISpoilerProps) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded);

  const handleHeaderClick = eventHandler(() => {
    setExpanded((v) => !v);
  });

  return (
    <div class="flex flex-col self-stretch gap-5">
      <div onClick={handleHeaderClick} class="flex justify-between self-stretch items-baseline cursor-pointer gap-5">
        <h4 class="flex-grow font-primary font-semibold text-white text-md">{props.header}</h4>
        <Icon class="min-w-6" color={COLORS.white} kind={expanded() ? EIconKind.ChevronUp : EIconKind.ChevronDown} />
      </div>
      <Show when={expanded()}>{props.children}</Show>
    </div>
  );
}
