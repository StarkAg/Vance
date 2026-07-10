import { useState } from "react";
import Dashboard from "./components/Dashboard";
import Trades from "./components/Trades";
import Holdings from "./components/Holdings";
import SectorRotation from "./components/SectorRotation";
import AdityaSector from "./components/AdityaSector";
import LivePanel from "./components/LivePanel";
import Scorecard from "./components/Scorecard";
import OrderBook from "./components/OrderBook";
import AgentPanel from "./components/AgentPanel";
import { Icon, type IconName } from "./components/icons";
import { useAccount, ACCOUNT_LABELS, type Account } from "./lib/account";

const TABS: { id: string; label: string; short: string; icon: IconName; accounts?: Account[] }[] = [
  { id: "dashboard", label: "Dashboard", short: "Home", icon: "dashboard" },
  { id: "live", label: "Live Position", short: "Live", icon: "pulse" },
  { id: "agent", label: "Agent", short: "Agent", icon: "bot", accounts: ["primary"] },
  { id: "scorecard", label: "Scorecard", short: "Score", icon: "trending", accounts: ["primary"] },
  { id: "orders", label: "Order Book", short: "Orders", icon: "list", accounts: ["primary"] },
  { id: "swing", label: "Swing Trading", short: "Swing", icon: "trending" },
  { id: "holdings", label: "Holdings", short: "Holds", icon: "holdings" },
  { id: "sectors", label: "Sector Rotation", short: "Sectors", icon: "sectors", accounts: ["primary"] },
  { id: "aditya", label: "Aditya's Sector", short: "Aditya", icon: "sectors" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const { account, setAccount } = useAccount();
  const [acctMenu, setAcctMenu] = useState(false);
  const visibleTabs = TABS.filter((t) => !t.accounts || t.accounts.includes(account));

  const selectAccount = (a: Account) => {
    setAccount(a);
    setAcctMenu(false);
    const currentTab = TABS.find((t) => t.id === tab);
    if (currentTab?.accounts && !currentTab.accounts.includes(a)) {
      setTab("dashboard");
    }
  };

  return (
    <div className="min-h-full overflow-x-hidden pt-[57px]">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-line bg-ink/90 backdrop-blur">
        <div className="relative mx-auto flex w-full max-w-[1800px] items-center px-3 py-3 sm:px-4 2xl:max-w-[2200px]">
          {/* Account switcher — choice is cached on the device (localStorage). */}
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Switch account"
              onClick={() => setAcctMenu((o) => !o)}
              className="flex h-9 items-center gap-2 rounded-full border border-line bg-panel2 pl-1.5 pr-3 transition-colors hover:bg-panel2/70"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/20 text-xs font-bold text-brand">
                {ACCOUNT_LABELS[account][0]}
              </span>
              <span className="text-xs font-semibold text-slate-200">{ACCOUNT_LABELS[account]}</span>
            </button>
            {acctMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAcctMenu(false)} />
                <div className="absolute left-0 top-11 z-50 w-44 overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
                  <div className="border-b border-line/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Account</div>
                  {(["primary", "aditya"] as Account[]).map((a) => (
                    <button
                      key={a}
                      onClick={() => selectAccount(a)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors ${account === a ? "bg-panel2 text-slate-100" : "text-muted hover:bg-panel2/60"}`}
                    >
                      {ACCOUNT_LABELS[a]}
                      {account === a && <Icon name="check" className="h-4 w-4 text-brand" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
            <span className="brand-wordmark text-2xl leading-none text-slate-100">Vance</span>
            <Icon name="trending" className="h-4 w-4 shrink-0 text-brand" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1800px] px-3 pb-28 pt-5 sm:px-4 sm:pt-6 2xl:max-w-[2200px] 2xl:px-6">
        {tab === "dashboard" && <Dashboard />}
        {tab === "live" && <LivePanel />}
        {tab === "agent" && <AgentPanel />}
        {tab === "scorecard" && <Scorecard />}
        {tab === "orders" && <OrderBook />}
        {tab === "swing" && <Trades kind="swing" />}
        {tab === "holdings" && <Holdings />}
        {tab === "sectors" && <SectorRotation />}
        {tab === "aditya" && <AdityaSector />}
      </main>

      {/* Tab bar lives at the bottom on every screen size (the app's footer nav). */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 px-2 shadow-2xl backdrop-blur">
        <div
          className="phone-nav mx-auto w-full max-w-[1800px] 2xl:max-w-[2200px]"
          style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
        >
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`phone-tab min-w-0 rounded text-[10px] font-medium transition-colors lg:text-xs ${
                tab === t.id ? "bg-panel2 text-slate-100" : "text-muted hover:text-slate-200"
              }`}
              title={t.label}
            >
              <Icon name={t.icon} className="h-4 w-4 shrink-0 text-brand" />
              <span className="w-full truncate text-center">
                <span className="lg:hidden">{t.short}</span>
                <span className="hidden lg:inline">{t.label}</span>
              </span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
