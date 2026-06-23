import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Which Groww account the whole app is acting as. "primary" = Harsh (the F&O
// trading account), "aditya" = the holdings/secondary account. The choice is
// cached on the device (localStorage) so it persists across reloads, and is
// passed to the account-aware Convex actions (holdings, livePositions).
export type Account = "primary" | "aditya";

export const ACCOUNT_LABELS: Record<Account, string> = { primary: "Harsh", aditya: "Aditya" };
const STORAGE_KEY = "vance.account";

const AccountContext = createContext<{ account: Account; setAccount: (a: Account) => void }>({
  account: "primary",
  setAccount: () => {},
});

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccountState] = useState<Account>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return saved === "aditya" || saved === "primary" ? saved : "primary";
  });

  const setAccount = (a: Account) => {
    setAccountState(a);
    try { localStorage.setItem(STORAGE_KEY, a); } catch { /* ignore quota/private-mode */ }
  };

  // Keep multiple tabs in sync if the account is switched in another tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === "aditya" || e.newValue === "primary")) {
        setAccountState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return <AccountContext.Provider value={{ account, setAccount }}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  return useContext(AccountContext);
}
