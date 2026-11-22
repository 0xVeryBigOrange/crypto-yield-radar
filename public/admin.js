const TOKEN_KEY = "keymint.admin";

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}
async function admin(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-admin-token": token(),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}
function cell(value) {
  const td = document.createElement("td");
  td.textContent = value;
  return td;
}
function fill(id, rows, map) {
  const body = document.getElementById(id);
  body.replaceChildren();
  for (const row of rows) body.append(map(row));
}

async function load() {
  const overview = await admin("/api/admin/overview");
  if (!overview.response.ok) {
    sessionStorage.removeItem(TOKEN_KEY);
    document.getElementById("gate").classList.remove("hidden");
    document.getElementById("panel").classList.add("hidden");
    document.getElementById("gate-msg").textContent = overview.body?.error?.message || "";
    return;
  }
  document.getElementById("gate").classList.add("hidden");
  document.getElementById("panel").classList.remove("hidden");
  const stats = document.getElementById("stats");
  stats.replaceChildren();
  const lang = window.KeymintI18n.get();
  const labels = lang === "en"
    ? ["Users", "Deposits", "Charged", "Upstream", "Markup revenue"]
    : ["用户", "充值", "扣费", "上游成本", "加价收入"];
  const values = [
    String(overview.body.users),
    `$${overview.body.depositsUsd}`,
    `$${overview.body.chargedUsd}`,
    `$${overview.body.upstreamUsd}`,
    `$${overview.body.markupRevenueUsd}`,
  ];
  labels.forEach((label, index) => {
    const card = document.createElement("article");
    card.className = "card stat";
    const name = document.createElement("span");
    name.className = "muted";
    name.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = values[index];
    card.append(name, strong);
    stats.append(card);
  });

  const users = await admin("/api/admin/users");
  fill("user-body", users.body.users, (row) => {
    const tr = document.createElement("tr");
    tr.append(cell(row.email), cell(`$${row.balanceUsd}`), cell(`$${row.reservedUsd}`));
    return tr;
  });
  const deposits = await admin("/api/admin/deposits");
  fill("deposit-body", deposits.body.deposits, (row) => {
    const tr = document.createElement("tr");
    tr.append(cell(row.email), cell(row.chain), cell(`$${row.amountUsd}`), cell(row.txHash));
    return tr;
  });
  const summaries = await admin("/api/admin/summaries");
  fill("summary-body", summaries.body.summaries, (row) => {
    const tr = document.createElement("tr");
    tr.append(cell(row.day), cell(String(row.requestCount)), cell(`$${row.chargedUsd}`), cell(`$${row.markupRevenueUsd}`), cell(`$${row.depositUsd}`));
    return tr;
  });
}

document.getElementById("gate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  sessionStorage.setItem(TOKEN_KEY, document.getElementById("admin-token").value.trim());
  await load();
});

document.getElementById("adjust-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const { response, body } = await admin("/api/admin/adjustments", { method: "POST", body: JSON.stringify(data) });
  const msg = document.getElementById("adjust-msg");
  msg.className = response.ok ? "msg ok" : "msg error";
  msg.textContent = response.ok ? `$${body.balanceUsd}` : body.error?.message || "";
  if (response.ok) await load();
});

document.getElementById("refresh").addEventListener("click", async () => {
  const { response, body } = await admin("/api/admin/refresh", { method: "POST", body: "{}" });
  const msg = document.getElementById("refresh-msg");
  msg.className = response.ok ? "msg ok" : "msg error";
  msg.textContent = response.ok ? String(body.models) : body.error?.message || "";
  if (response.ok) await load();
});

document.addEventListener("keymint:lang", () => {
  if (token()) load();
});

if (token()) load();
