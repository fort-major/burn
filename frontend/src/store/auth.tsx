import { Accessor, batch, createContext, createSignal, onMount, useContext } from "solid-js";
import { IChildren } from "../utils/types";
import { ErrorCode, err, logInfo } from "../utils/error";
import { Identity, Agent } from "@dfinity/agent";
import { MsqClient, MsqIdentity } from "@fort-major/msq-client";
import { makeAgent, makeAnonymousAgent } from "../utils/backend";

export interface IAuthStoreContext {
  authorize: () => Promise<boolean>;
  deauthorize: () => Promise<boolean>;
  identity: Accessor<(Identity & MsqIdentity) | undefined>;
  msqClient: Accessor<MsqClient | undefined>;

  agent: Accessor<Agent | undefined>;
  anonymousAgent: Accessor<Agent | undefined>;

  isAuthorized: Accessor<boolean>;
  isReadyToFetch: Accessor<boolean>;
  assertReadyToFetch: () => never | void;
  assertAuthorized: () => never | void;

  disabled: Accessor<boolean>;
  disable: () => void;
  enable: () => void;
}

const AuthContext = createContext<IAuthStoreContext>();

export function useAuth(): IAuthStoreContext {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    err(ErrorCode.UNREACHEABLE, "Auth context is not initialized");
  }

  return ctx;
}

export type TAutoAuthState = "attepting" | "success" | "fail" | "unavailable";

export function AuthStore(props: IChildren) {
  const [identity, setIdentity] = createSignal<(Identity & MsqIdentity) | undefined>();
  const [msqClient, setMsqClient] = createSignal<MsqClient | undefined>();
  const [agent, setAgent] = createSignal<Agent | undefined>();
  const [anonymousAgent, setAnonymousAgent] = createSignal<Agent | undefined>();
  const [disabled, setDisabled] = createSignal(false);

  onMount(async () => {
    makeAnonymousAgent().then((a) => setAnonymousAgent(a));

    if (MsqClient.isSafeToResume()) {
      await authorize();
    }
  });

  const deauthorize: IAuthStoreContext["deauthorize"] = async () => {
    assertAuthorized();

    const msq = msqClient()!;

    const res = await msq.requestLogout();

    if (res) {
      batch(() => {
        setAgent(undefined);
        setIdentity(undefined);
      });
    }

    return res;
  };

  const authorize: IAuthStoreContext["authorize"] = async () => {
    const result = await MsqClient.createAndLogin();

    if ("Err" in result) {
      err(ErrorCode.AUTH, result.Err);
    }

    const { msq, identity } = result.Ok;

    setMsqClient(msq);

    await initIdentity(identity);

    return true;
  };

  const initIdentity = async (identity: Identity & MsqIdentity) => {
    let a = await makeAgent(identity);

    batch(() => {
      setIdentity(identity);
      setAgent(a);
    });

    logInfo("Login successful");
  };

  const isAuthorized = () => {
    return !!agent();
  };

  const isReadyToFetch = () => {
    return !!anonymousAgent();
  };

  const assertReadyToFetch = () => {
    if (!isReadyToFetch()) {
      err(ErrorCode.UNREACHEABLE, "Not ready to fetch");
    }
  };

  const assertAuthorized = () => {
    if (!isAuthorized()) {
      err(ErrorCode.UNREACHEABLE, "Not authorized");
    }
  };

  return (
    <AuthContext.Provider
      value={{
        identity,
        authorize,
        deauthorize,
        msqClient,
        agent,
        anonymousAgent,
        isAuthorized,
        isReadyToFetch,
        assertReadyToFetch,
        assertAuthorized,
        disabled,
        disable: () => setDisabled(true),
        enable: () => setDisabled(false),
      }}
    >
      {props.children}
    </AuthContext.Provider>
  );
}
