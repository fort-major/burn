import { EIconKind, Icon } from "@components/icon";
import { useAuth } from "@store/auth";
import { COLORS } from "@utils/colors";
import { eventHandler } from "@utils/security";
import { Result } from "@utils/types";
import { createSignal, For, Show } from "solid-js";

export interface ISelectProps {
  possibleValues: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  top?: boolean;
}

export function Select(props: ISelectProps) {
  const { disabled } = useAuth();

  const [expanded, setExpanded] = createSignal(false);

  const d = () => props.disabled || disabled();

  const handleValueClick = eventHandler(() => {
    setExpanded((e) => !e);
  });

  const handleOptionClick = eventHandler((e: Event & { currentTarget: HTMLDivElement }) => {
    const v = e.currentTarget.innerText;
    props.onChange(v);

    setExpanded(false);
  });

  return (
    <div class="flex flex-col min-w-36 p-4 bg-gray-108 rounded-3xl text-white relative justify-center">
      <div class="flex items-center justify-between cursor-pointer" onClick={handleValueClick}>
        <p class="select-none">{props.value}</p>
        <Icon kind={expanded() && !d() ? EIconKind.ChevronUp : EIconKind.ChevronDown} color={COLORS.gray[140]} />
      </div>
      <Show when={expanded() && !d()}>
        <div
          class="flex flex-col gap-1 p-4 absolute z-10 bg-gray-105 rounded-3xl w-full left-0"
          classList={{ "top-full": !props.top, "bottom-full": props.top }}
        >
          <For each={props.possibleValues}>
            {(p) => (
              <div class="select-none hover:bg-gray-120 cursor-pointer p-2" onClick={handleOptionClick}>
                {p}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
