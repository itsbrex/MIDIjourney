const { openExternalUrl } = require("./pollinationsAuth.js");

const DASHBOARD_URL = "https://enter.pollinations.ai/";
const connectedStates = new Set(["connected", "offline"]);

function formatBalance(balance) {
  if (typeof balance !== "number" || !Number.isFinite(balance) || balance < 0) return "—";
  if (balance === 0) return "0";
  if (balance < 0.01) return "<0.01";
  return balance.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

class AccountPanel {
  constructor({ auth, send, open = openExternalUrl }) {
    this.auth = auth;
    this.send = send;
    this.open = open;
    this.status = "checking";
    this.balance = null;
    this.epoch = 0;
    this.client = null;
    this.refreshing = null;
  }

  render() {
    const connected = connectedStates.has(this.status);
    const label = connected ? formatBalance(this.balance) : "—";
    this.send("balance", "text", label);
    this.send("balance", "texton", label);
    this.send("balance", "active", 0);
    this.send("balance", "fontsize", Math.max(9, Math.min(26, 130 / label.length)));
    this.send("balance", "hint", connected && this.balance !== null
      ? "Available balance"
      : "Balance unavailable. Reopen the editor to refresh.");
  }

  state(state) {
    this.status = state.status;
    if (!connectedStates.has(this.status)) {
      this.epoch += 1;
      this.client = null;
      this.refreshing = null;
      this.balance = null;
    }
    this.render();
    if (connectedStates.has(this.status)) void this.refresh();
  }

  refresh() {
    if (!connectedStates.has(this.status)) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    let client;
    try { client = this.auth.requireClient(); } catch { return Promise.resolve(); }
    const epoch = this.epoch;
    this.client = client;
    const current = () => this.epoch === epoch && this.client === client;
    const task = (async () => {
      let value;
      try { value = (await client.accountBalance())?.balance; } catch { value = null; }
      if (!current()) return;
      this.balance = typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
      this.render();
    })();
    this.refreshing = task;
    void task.finally(() => { if (this.refreshing === task) this.refreshing = null; });
    return task;
  }

  async openDashboard() {
    // The browser's existing Pollinations session owns dashboard sign-in. Opening
    // it neither changes MIDIjourney's authorization nor purchases anything.
    await this.open(DASHBOARD_URL);
  }
}

module.exports = { AccountPanel, DASHBOARD_URL, formatBalance };
