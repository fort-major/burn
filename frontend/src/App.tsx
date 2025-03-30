import { Router } from "@solidjs/router";
import { getSolidRoutes } from "./routes";
import { IChildren } from "./utils/types";
import { Toaster } from "solid-toast";
import { AuthStore } from "./store/auth";
import { ErrorBoundary } from "solid-js";
import { ErrorCode } from "./utils/error";
import { Header } from "@components/header";
import { TokensStore } from "@store/tokens";
import { WalletStore } from "@store/wallet";
import { Wallet } from "@components/wallet";

const AppRoot = (props: IChildren) => (
  <>
    <ErrorBoundary
      fallback={(e) => {
        console.error(ErrorCode.UNKNOWN, "FATAL", e);

        return undefined;
      }}
    >
      <AuthStore>
        <TokensStore>
          <WalletStore>
              <Header />
                <main class="flex flex-col flex-grow self-stretch pt-12 lg:pt-[80px]">{props.children}</main>
              <Wallet />
          </WalletStore>
        </TokensStore>
      </AuthStore>
    </ErrorBoundary>
    <Toaster />
  </>
);

function App() {
  return <Router root={AppRoot}>{getSolidRoutes()}</Router>;
}

export default App;
