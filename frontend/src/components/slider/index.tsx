import { EDs } from "@utils/math";
import { eventHandler } from "@utils/security";
import { createEffect, createSignal, Show } from "solid-js";

export interface ISliderProps {
  min: string;
  max: string;
  onChange: (val: EDs) => void;
}

export const Slider = (props: ISliderProps) => {
  const [value, setValue] = createSignal(0);

  const handleChange = eventHandler((e: Event & { target: HTMLInputElement }) => {
    const val = parseInt(e.target.value);
    const e8sVal = EDs.fromBigIntBase(BigInt(val)).div(EDs.fromBigIntBase(100n));

    props.onChange(e8sVal);
    setValue(val);
  });

  return (
    <div class="flex gap-1 items-center">
      <p class="text-sm font-semibold text-gray-140 w-20">{props.min}</p>
      <input type="range" min={0} max={100} value={value()} onChange={handleChange} />
      <p class="text-sm font-semibold text-gray-140 w-20">{props.max}</p>
    </div>
  );
};
