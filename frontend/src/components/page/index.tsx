import { IChildren, IClass, IRef } from "@utils/types";
import { Match, Switch } from "solid-js";

type T = IChildren & IClass & IRef<HTMLDivElement>;
export interface IPageProps extends T {
  slim?: boolean;
  outerClass?: string;
}

export function Page(props: IPageProps) {
  return (
    <div
      ref={props.ref}
      class="flex flex-col items-center flex-grow text-white font-primary bg-black px-5 py-16 lg:px-10 lg:py-20"
      classList={{ [props.outerClass!]: !!props.outerClass }}
    >
      <div
        class="flex flex-col w-full relative gap-20"
        classList={{
          ["max-w-4xl"]: !!props.slim,
          [props.class!]: !!props.class,
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
