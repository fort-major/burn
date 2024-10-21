import { COLORS } from "@utils/colors";
import { IChildren, IClass } from "@utils/types";

export interface IBentoProps extends IClass, IChildren {
  id: number;
}

const grays = Object.values(COLORS.gray);

export function Bento(props: IBentoProps) {
  const bg = () => grays[props.id % grays.length];

  return (
    <div
      class="flex flex-col p-6 rounded-3xl gap-4"
      classList={{ [props.class!]: !!props.class }}
      style={{ "background-color": bg() }}
    >
      {props.children}
    </div>
  );
}

export interface IBentoBoxProps extends IClass, IChildren {
  scheme: "1-2" | "1-4";
}

export function BentoBox(props: IBentoBoxProps) {
  return (
    <div
      class="grid gap-6"
      classList={{
        "grid-cols-1 md:grid-cols-2": props.scheme === "1-2",
        "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4": props.scheme === "1-4",
        [props.class!]: !!props.class,
      }}
    >
      {props.children}
    </div>
  );
}
