const test = require("node:test");
const assert = require("node:assert/strict");
const { AccountPanel, DASHBOARD_URL, formatBalance } = require("../accountPanel");

function harness(client) {
  const messages = [], links = [], connections = [];
  const panel = new AccountPanel({
    auth: { requireClient: () => client, connect: async () => connections.push("connect") },
    send: (...args) => messages.push(args),
    open: async (url) => links.push(url),
  });
  const value = (attribute, control = "balance") => messages.findLast((m) => m[0] === control && m[1] === attribute)?.[2];
  return { panel, messages, links, connections, value };
}

test("balance distinguishes zero from unavailable without an extra Pollen label", () => {
  for (const value of [undefined, null, NaN, -1, Infinity, "0"]) assert.equal(formatBalance(value), "—");
  assert.equal(formatBalance(0), "0");
  assert.equal(formatBalance(0.001), "<0.01");
  assert.equal(formatBalance(12.345), "12.35");
});

test("one account control displays balance without fetching profile information", async () => {
  const { panel, messages, links, value } = harness({ accountBalance: async () => ({ balance: 20.5 }) });
  panel.state({ status: "connected" });
  await panel.refresh();
  assert.equal(value("text"), "20.5");
  assert.equal(value("active"), 0);
  assert.ok(messages.every((m) => m[0] === "balance" && ["text", "texton", "active", "fontsize", "hint"].includes(m[1])));
  await panel.openDashboard();
  assert.equal(DASHBOARD_URL, "https://enter.pollinations.ai/");
  assert.deepEqual(links, [DASHBOARD_URL]);
});

test("zero remains a balance display and the separate arrow opens the dashboard", async () => {
  const { panel, links, connections, value } = harness({ accountBalance: async () => ({ balance: 0 }) });
  panel.state({ status: "connected" });
  await panel.refresh();
  assert.equal(value("text"), "0");
  assert.equal(value("active"), 0);
  await panel.openDashboard();
  assert.deepEqual(links, [DASHBOARD_URL]);
  assert.deepEqual(connections, []);
});

test("dashboard is available without starting or replacing device authorization", async () => {
  const { panel, links, connections, value } = harness({});
  for (const status of ["disconnected", "checking", "connecting", "awaiting_approval"]) {
    panel.state({ status });
    assert.equal(value("text"), "—");
    assert.equal(value("active"), 0);
    await panel.openDashboard();
  }
  assert.deepEqual(connections, []);
  assert.deepEqual(links, Array(4).fill(DASHBOARD_URL));
});

test("disconnect prevents an in-flight balance from reappearing and coalesces refreshes", async () => {
  let complete;
  const { panel, messages, value } = harness({ accountBalance: () => new Promise((resolve) => { complete = resolve; }) });
  panel.state({ status: "connected" });
  const pending = panel.refresh();
  assert.equal(panel.refresh(), pending);
  panel.state({ status: "disconnected" });
  assert.equal(value("text"), "—");
  messages.length = 0;
  complete({ balance: 99 });
  await pending;
  assert.deepEqual(messages, []);
});

test("unknown or invalid balance is never a top-up button", async () => {
  const client = { accountBalance: async () => ({ balance: 0 }) };
  const { panel, links, value } = harness(client);
  panel.state({ status: "connected" });
  await panel.refresh();
  for (const balance of [undefined, "0", -2, Infinity, NaN]) {
    client.accountBalance = async () => ({ balance });
    await panel.refresh();
    assert.equal(value("text"), "—");
    assert.equal(value("active"), 0);
  }
  client.accountBalance = async () => { throw new Error("offline"); };
  await panel.refresh();
  assert.equal(value("text"), "—");
  assert.deepEqual(links, []);
});

test("offline connection preserves authorization and does not offer Connect", async () => {
  const { panel, value, connections } = harness({ accountBalance: async () => { throw new Error("offline"); } });
  panel.state({ status: "offline" });
  await panel.refresh();
  assert.equal(value("text"), "—");
  await panel.openDashboard();
  assert.deepEqual(connections, []);
});

test("balance font fits the header and disconnected refresh does not query the account", async () => {
  let calls = 0;
  const { panel, value } = harness({ accountBalance: async () => { calls++; return { balance: 123456.78 }; } });
  panel.state({ status: "disconnected" });
  await panel.refresh();
  assert.equal(calls, 0);
  panel.state({ status: "connected" });
  await panel.refresh();
  assert.equal(calls, 1);
  assert.ok(value("fontsize") <= 26);
});

test("dashboard opener errors are surfaced without changing the connection", async () => {
  const { panel, connections } = harness({});
  panel.open = async () => { throw new Error("Browser unavailable"); };
  await assert.rejects(panel.openDashboard(), /Browser unavailable/);
  assert.deepEqual(connections, []);
  assert.equal(panel.status, "checking");
});

test("account panel renders only balance across connection states without changing authorization", async () => {
  const { panel, value, connections, messages } = harness({ accountBalance: async () => ({ balance: 4.91 }) });
  for (const status of ["connected", "offline"]) {
    panel.state({ status });
    await panel.refresh();
    assert.equal(value("text"), "4.91");
  }
  for (const status of ["disconnected", "connecting", "awaiting_approval", "checking"]) {
    panel.state({ status });
    assert.equal(value("text"), "—");
    assert.equal(value("active"), 0);
  }
  assert.deepEqual(connections, []);
  assert.ok(messages.every(m => m[0] === "balance"));
});
