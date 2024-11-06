import { EIconKind, Icon } from "@components/icon";
import { COLORS } from "@utils/colors";
import { IChildren, IClass } from "@utils/types";
import { createSignal, Show } from "solid-js";

export interface IHelpBtnProps extends IChildren, IClass {}

export function HelpBtn(props: IHelpBtnProps) {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class="relative">
      <Show when={expanded()}>
        <div
          class="absolute z-10 w-72 top-full right-0 p-6 rounded-3xl bg-gray-105 shadow-lg"
          classList={{ [props.class!]: !!props.class }}
        >
          {props.children}
        </div>
      </Show>
      <Icon
        kind={EIconKind.QuestionCircle}
        color={expanded() ? COLORS.white : COLORS.gray[140]}
        hoverColor={COLORS.white}
        class="relative cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      />
    </div>
  );
}
