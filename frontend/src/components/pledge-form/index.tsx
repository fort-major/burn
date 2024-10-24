import { Btn } from "@components/btn";
import { QtyInput } from "@components/qty-input";
import { Principal } from "@dfinity/principal";
import { useTokens } from "@store/tokens";
import { useWallet } from "@store/wallet";
import { COLORS } from "@utils/colors";
import { logInfo } from "@utils/error";
import { EDs } from "@utils/math";
import { Result } from "@utils/types";
import { createSignal } from "solid-js";

export interface IPledgeFormProps {
  tokenCanId: Principal;
  min?: EDs;
  onPledge: (tokenCanId: Principal, qty: bigint) => Promise<void>;
}

export function PledgeForm(props: IPledgeFormProps) {
  const { pidBalance } = useWallet();
  const { metadata } = useTokens();

  const meta = () => metadata[props.tokenCanId.toText()];

  const [pledgeQty, setPledgeQty] = createSignal<Result<EDs, string>>(Result.Err(""));

  const canPledge = () => {
    return meta() && pidBalance(props.tokenCanId) && pledgeQty().isOk();
  };

  const handlePledge = async () => {
    const qty = pledgeQty().unwrapOk();

    await props.onPledge(props.tokenCanId, qty.val);

    logInfo(`Successfully pledged ${qty.toString()} ${meta()!.ticker}`);
  };

  return (
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <p class="font-semibold text-sm text-gray-140">
            Amount <span class="text-errorRed">*</span>
          </p>
          <QtyInput
            value={pledgeQty()}
            onChange={setPledgeQty}
            decimals={meta()!.fee.decimals}
            fee={meta()!.fee}
            validations={[
              { required: null },
              {
                min: props.min ?? meta()!.fee,
                max: EDs.new(pidBalance(props.tokenCanId) || meta()!.fee.val, meta()!.fee.decimals),
              },
            ]}
            symbol={meta()!.ticker}
          />
        </div>
      </div>
      <Btn text="Confirm" bgColor={COLORS.orange} disabled={!canPledge()} onClick={handlePledge} />
    </div>
  );
}
