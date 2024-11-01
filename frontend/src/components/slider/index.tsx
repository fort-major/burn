import { eventHandler } from "@utils/security";
import { createSignal } from "solid-js";

export interface ISliderProps {
  minLabel: string;
  maxLabel: string;
  min: number;
  max: number;
  onChange: (val: number) => void;
}

export const Slider = (props: ISliderProps) => {
  const [value, setValue] = createSignal(0);

  const handleChange = eventHandler((e: Event & { target: HTMLInputElement }) => {
    const val = parseInt(e.target.value);

    props.onChange(val);
    setValue(val);
  });

  return (
    <div class="flex gap-1 items-center">
      <p class="text-sm font-semibold text-gray-140 w-20">{props.minLabel}</p>
      <input type="range" min={props.min} max={props.max} value={value()} onChange={handleChange} />
      <p class="text-sm font-semibold text-gray-140 w-20">{props.maxLabel}</p>
    </div>
  );
};
