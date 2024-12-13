import { Candle, GetPriceHistoryRequest, Order, PriceInfo, TraderStats } from "@/declarations/trading/trading.did";
import { Principal } from "@dfinity/principal";
import { err, ErrorCode, logInfo } from "@utils/error";
import { E8s } from "@utils/math";
import { Fetcher, IChildren } from "@utils/types";
import {
  Accessor,
  batch,
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import { createStore, Store } from "solid-js/store";
import { useAuth } from "./auth";
import { newTradingActor } from "@utils/backend";
import { useWallet } from "./wallet";
import { DEFAULT_TOKENS } from "./tokens";
import { IcrcLedgerCanister } from "@dfinity/ledger-icrc";
import { stat } from "fs";
import { createLocalStorageSignal } from "@utils/common";

export interface ITradingBalances {
  real: E8s;
  long: E8s;
  short: E8s;
}

export interface ITraderStats {
  total_long_sold: E8s;
  total_long_bought: E8s;
  total_short_bought: E8s;
  total_short_sold: E8s;

  cur_real_balance: E8s;
  cur_long_balance: E8s;
  cur_short_balance: E8s;

  buy_long_timestamps: bigint[];
  buy_short_timestamps: bigint[];
  sell_short_timestamps: bigint[];
  sell_long_timestamps: bigint[];
}

export interface ITradingStoreContext {
  isInvited: Accessor<boolean | undefined>;
  myTraderStats: Accessor<ITraderStats | undefined>;
  fetchMyInfo: Fetcher;

  priceInfo: Accessor<PriceInfo | undefined>;
  priceInfoCounter4h: Accessor<number>;
  priceInfoCounter1d: Accessor<number>;
  fetchPriceInfo: Fetcher;

  longPriceHistory4h: Store<Candle[]>;
  longPriceHistory1d: Store<Candle[]>;
  shortPriceHistory4h: Store<Candle[]>;
  shortPriceHistory1d: Store<Candle[]>;
  fetchPriceHistory: (short: boolean, kind: "4h" | "1d") => Promise<void>;

  orderHistory: Store<Record<string, Order>>;
  fetchOrderHistory: () => Promise<void>;

  traders: Store<Record<string, ITraderStats>>;
  fetchTraders: () => Promise<void>;

  canDeposit: (qty: E8s) => boolean;
  deposit: (qty: E8s) => Promise<void>;

  canWithdraw: () => boolean;
  withdraw: () => Promise<void>;

  canOrder: (short: boolean, sell: boolean, qty: E8s) => boolean;
  order: (short: boolean, sell: boolean, qty: E8s) => Promise<void>;

  myOrders: Accessor<Order[] | undefined>;
  storeMyOrder: (order: Order) => void;

  myFeesEarned: Accessor<E8s>;
  referrers: Store<Record<string, E8s>>;
  fetchReferrers: () => Promise<void>;
}

const TradingContext = createContext<ITradingStoreContext>();

export function useTrading(): ITradingStoreContext {
  const ctx = useContext(TradingContext);

  if (!ctx) {
    err(ErrorCode.UNREACHEABLE, "Trading context is not initialized");
  }

  return ctx;
}

export function TradingStore(props: IChildren) {
  const { isAuthorized, assertAuthorized, assertReadyToFetch, isReadyToFetch, agent, anonymousAgent, enable, disable } =
    useAuth();
  const { pid, pidBalance, subaccount, transferNoDisable, fetchPidBalance } = useWallet();

  const [int, setInt] = createSignal<NodeJS.Timeout>();
  const [myTraderStats, setMyTraderStats] = createSignal<ITraderStats>();
  const [isInvited, setInvited] = createSignal<boolean>();
  const [priceInfo, setPriceInfo] = createSignal<PriceInfo>();
  const [priceInfoCounter4h, setPriceInfoCounter4h] = createSignal(0);
  const [priceInfoCounter1d, setPriceInfoCounter1d] = createSignal(0);
  const [longPriceHistory4h, setLongPriceHistory4h] = createStore<ITradingStoreContext["longPriceHistory4h"]>([]);
  const [longPriceHistory1d, setLongPriceHistory1d] = createStore<ITradingStoreContext["longPriceHistory1d"]>([]);
  const [shortPriceHistory4h, setShortPriceHistory4h] = createStore<ITradingStoreContext["shortPriceHistory4h"]>([]);
  const [shortPriceHistory1d, setShortPriceHistory1d] = createStore<ITradingStoreContext["shortPriceHistory1d"]>([]);
  const [orderHistory, setOrderHistory] = createStore<ITradingStoreContext["orderHistory"]>();
  const [traders, setTraders] = createStore<ITradingStoreContext["traders"]>();

  const [myOrders, setMyOrders] = createLocalStorageSignal<Order[]>("msq-burn-ash-market-my-orders");

  const [myFeesEarned, setMyFeesEarned] = createSignal<E8s>(E8s.zero());
  const [referrers, setReferrers] = createStore<ITradingStoreContext["referrers"]>();

  onMount(() => {
    if (isAuthorized()) {
      fetchMyInfo();
      fetchMyFeesEarned();
    }
  });

  onCleanup(() => {
    if (int()) {
      clearInterval(int());
    }
  });

  createEffect(
    on(isAuthorized, (ready) => {
      if (ready) {
        fetchMyInfo();
        fetchMyFeesEarned();
      }
    })
  );

  onMount(() => {
    if (isReadyToFetch()) {
      fetchPriceInfo();
    }

    setInt(
      setInterval(() => {
        if (isReadyToFetch()) fetchPriceInfo();
      }, 10000)
    );
  });

  createEffect(
    on(isReadyToFetch, (ready) => {
      if (ready) {
        fetchPriceInfo();
      }
    })
  );

  const fetchMyFeesEarned = async () => {
    assertAuthorized();

    const trading = newTradingActor(anonymousAgent()!);

    const v = await trading.user_referral_profit();

    setMyFeesEarned(E8s.new(v));
  };

  const storeMyOrder: ITradingStoreContext["storeMyOrder"] = (order) => {
    setMyOrders((orders) => (orders ? [order, ...orders] : [order]));
  };

  const fetchReferrers: ITradingStoreContext["fetchReferrers"] = async () => {
    assertReadyToFetch();

    const trading = newTradingActor(anonymousAgent()!);

    const resp = await trading.all_users_referral_profits();
    for (let [pid, profit] of resp) {
      setReferrers(pid.toText(), E8s.new(profit));
    }
  };

  const fetchTraders: ITradingStoreContext["fetchTraders"] = async () => {
    assertReadyToFetch();

    const trading = newTradingActor(anonymousAgent()!);

    let skip = 0n,
      take = 1000n;

    while (true) {
      const res = await trading.get_all_trader_stats(skip, take);

      for (let [pid, stats, balance] of res) {
        const iStats: ITraderStats = {
          buy_long_timestamps: stats.buy_long_timestamps as bigint[],
          buy_short_timestamps: stats.buy_short_timestamps as bigint[],
          sell_long_timestamps: stats.sell_long_timestamps as bigint[],
          sell_short_timestamps: stats.sell_short_timestamps as bigint[],

          cur_real_balance: E8s.new(balance.real),
          cur_long_balance: E8s.new(balance.long),
          cur_short_balance: E8s.new(balance.short),

          total_long_bought: E8s.new(stats.total_long_bought),
          total_long_sold: E8s.new(stats.total_long_sold),
          total_short_bought: E8s.new(stats.total_short_bought),
          total_short_sold: E8s.new(stats.total_short_sold),
        };

        setTraders(pid.toText(), iStats);
      }

      if (res.length < Number(take)) {
        break;
      }

      skip += take;
    }
  };

  const canDeposit: ITradingStoreContext["canDeposit"] = (qty) => {
    if (!isAuthorized() || !subaccount()) return false;
    if ((pidBalance(DEFAULT_TOKENS.burn) || 0n) < qty.inner().val) return false;

    return true;
  };

  const deposit: ITradingStoreContext["deposit"] = async (qty) => {
    assertAuthorized();

    try {
      disable();

      await transferNoDisable(
        DEFAULT_TOKENS.burn,
        { owner: Principal.fromText(import.meta.env.VITE_TRADING_CANISTER_ID), subaccount: [subaccount()!] },
        qty.inner().val
      );

      const trading = newTradingActor(agent()!);

      try {
        const newQty = qty.inner().val - 10_000n;

        await trading.deposit(qty.inner().val - 10_000n);
        fetchMyInfo();

        logInfo(`Deposited ${E8s.new(newQty).toString()} $BURN`);
      } catch (e) {
        logInfo(`Deposit failed, withdrawing back...`);
        console.error(e);

        await trading.withdraw_from_user_subaccount(DEFAULT_TOKENS.burn, qty.inner().val - 10_000n);
        fetchPidBalance(DEFAULT_TOKENS.burn);
      }
    } finally {
      enable();
    }
  };

  const canWithdraw: ITradingStoreContext["canWithdraw"] = () => {
    if (!isAuthorized()) return false;

    const b = myTraderStats();
    if (!b || b.cur_real_balance.le(E8s.new(10_000n))) return false;

    return true;
  };

  const withdraw: ITradingStoreContext["withdraw"] = async () => {
    assertAuthorized();

    const trading = newTradingActor(agent()!);

    try {
      disable();
      const resp = await trading.withdraw();

      if ("Err" in resp) {
        err(ErrorCode.UNKNOWN, resp.Err);
      }

      fetchMyInfo();
      fetchPidBalance(DEFAULT_TOKENS.burn);
    } finally {
      enable();
    }
  };

  const canOrder: ITradingStoreContext["canOrder"] = (short, sell, qty) => {
    if (!isAuthorized()) return false;

    if (!priceInfo()) return false;

    const b = myTraderStats();
    if (!b) return false;

    if (short && sell && b.cur_short_balance.lt(qty)) {
      return false;
    }

    if (!short && sell && b.cur_long_balance.lt(qty)) {
      return false;
    }

    if (!sell && b.cur_real_balance.lt(qty)) {
      return false;
    }

    return true;
  };

  const order: ITradingStoreContext["order"] = async (short, sell, qty) => {
    assertAuthorized();

    const p = priceInfo()!;
    const expectedPrice = short ? p.cur_short_price : p.cur_long_price;

    const trading = newTradingActor(agent()!);

    try {
      disable();

      const o = await trading.order({ short, sell, qty: qty.inner().val, expected_price: expectedPrice });
      storeMyOrder(o);

      fetchMyInfo();
    } finally {
      enable();
    }
  };

  const fetchOrderHistory: ITradingStoreContext["fetchOrderHistory"] = async () => {
    assertReadyToFetch();

    const trading = newTradingActor(anonymousAgent()!);
    const resp = await trading.get_order_history();

    for (let order of resp) {
      setOrderHistory(order.timestmap.toString(), order);
    }
  };

  const fetchPriceHistory: ITradingStoreContext["fetchPriceHistory"] = async (short, kind) => {
    assertReadyToFetch();

    const trading = newTradingActor(anonymousAgent()!);
    const req: GetPriceHistoryRequest = {
      short,
      kind: kind === "1d" ? { OneDay: null } : { FourHours: null },
      skip: 0n,
      take: 1000n,
    };

    const resp = await trading.get_price_history(req);

    if (!short && kind === "4h") {
      setLongPriceHistory4h(resp);
    } else if (!short && kind === "1d") {
      setLongPriceHistory1d(resp);
    } else if (short && kind === "4h") {
      setShortPriceHistory4h(resp);
    } else {
      setShortPriceHistory1d(resp);
    }
  };

  const fetchPriceInfo = async () => {
    assertReadyToFetch();

    const trading = newTradingActor(anonymousAgent()!);
    const info = await trading.get_info();

    const oldInfo = priceInfo();

    if (oldInfo) {
      if (oldInfo.cur_1d_long_candle.open_ts != info.cur_1d_long_candle.open_ts) {
        setPriceInfoCounter1d((i) => i + 1);
      }
      if (oldInfo.cur_4h_long_candle.open_ts != info.cur_4h_long_candle.open_ts) {
        setPriceInfoCounter4h((i) => i + 1);
      }
    }

    setPriceInfo(info);
  };

  const fetchMyInfo = async () => {
    assertAuthorized();

    const trading = newTradingActor(agent()!);
    const resp = await trading.get_user_balances();

    if (resp.length === 0) {
      setInvited(false);
      return;
    }

    const [[b, s]] = resp;

    const stats: ITraderStats = {
      total_long_bought: E8s.new(s.total_long_bought),
      total_long_sold: E8s.new(s.total_long_sold),
      total_short_bought: E8s.new(s.total_short_bought),
      total_short_sold: E8s.new(s.total_short_sold),

      cur_long_balance: E8s.new(b.long),
      cur_short_balance: E8s.new(b.short),
      cur_real_balance: E8s.new(b.real),

      buy_long_timestamps: s.buy_long_timestamps as bigint[],
      buy_short_timestamps: s.buy_short_timestamps as bigint[],
      sell_long_timestamps: s.sell_long_timestamps as bigint[],
      sell_short_timestamps: s.sell_short_timestamps as bigint[],
    };

    localStorage.setItem(ASH_MARKET_IS_INVITED_KEY, "true");

    batch(() => {
      setInvited(true);
      setMyTraderStats(stats);
    });
  };

  const cachedIsInvited = () => {
    if (!isAuthorized()) {
      const cached = localStorage.getItem(ASH_MARKET_IS_INVITED_KEY);
      if (cached === "true") return true;
    }

    return isInvited();
  };

  return (
    <TradingContext.Provider
      value={{
        myTraderStats,
        isInvited: cachedIsInvited,
        fetchMyInfo,

        priceInfo,
        priceInfoCounter4h,
        priceInfoCounter1d,
        fetchPriceInfo,

        longPriceHistory1d,
        longPriceHistory4h,
        shortPriceHistory1d,
        shortPriceHistory4h,
        fetchPriceHistory,

        orderHistory,
        fetchOrderHistory,

        traders,
        fetchTraders,

        canDeposit,
        deposit,

        canWithdraw,
        withdraw,

        canOrder,
        order,

        myOrders,
        storeMyOrder,

        myFeesEarned,
        referrers,
        fetchReferrers,
      }}
    >
      {props.children}
    </TradingContext.Provider>
  );
}

export const ASH_MARKET_IS_INVITED_KEY = "msq-burn-ash-market-is-invited";
