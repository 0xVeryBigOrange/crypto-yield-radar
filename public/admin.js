const tokenBox = document.querySelector("#admin-token");
const gate = document.querySelector("#gate");
const panel = document.querySelector("#panel");

function authHeaders() {
  return { "content-type": "application/json", "x-admin-token": sessionStorage.getItem("oo_admin") || "" };
}

async function admin(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "请求失败");
  return data;
}

function cell(value) {
  const td = document.createElement("td");
  td.textContent = value ?? "";
  return td;
}

async function load() {
  const overview = await admin("/api/admin/overview");
  document.querySelector("#stats").innerHTML = [
    ["用户", overview.users],
    ["充值", overview.depositsUsd],
    ["消费", overview.chargedUsd],
    ["月卡", overview.passes],
  ]
    .map(([label, value]) => `<article class="feature"><strong>${label}</strong><span>${value}</span></article>`)
    .join("");
  const users = await admin("/api/admin/users");
  const userBody = document.querySelector("#user-body");
  userBody.replaceChildren();
  for (const user of users.users) {
    const tr = document.createElement("tr");
    tr.append(cell(user.nickname), cell(user.email), cell(user.balanceUsd), cell(user.passUntil ? "开" : ""));
    userBody.append(tr);
  }
  const deposits = await admin("/api/admin/deposits");
  const depositBody = document.querySelector("#deposit-body");
  depositBody.replaceChildren();
  for (const row of deposits.deposits) {
    const tr = document.createElement("tr");
    tr.append(cell(row.email), cell(row.chain), cell(row.amountUsd), cell(row.txHash));
    depositBody.append(tr);
  }
  const summaries = await admin("/api/admin/summaries");
  const summaryBody = document.querySelector("#summary-body");
  summaryBody.replaceChildren();
  for (const row of summaries.summaries) {
    const tr = document.createElement("tr");
    tr.append(cell(row.day), cell(String(row.readingCount)), cell(row.chargedUsd), cell(row.depositUsd));
    summaryBody.append(tr);
  }
}

document.querySelector("#gate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  sessionStorage.setItem("oo_admin", tokenBox.value.trim());
  try {
    await load();
    gate.classList.add("hidden");
    panel.classList.remove("hidden");
  } catch (error) {
    document.querySelector("#gate-msg").textContent = error.message;
  }
});

document.querySelector("#adjust-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const msg = document.querySelector("#adjust-msg");
  try {
    const result = await admin("/api/admin/adjustments", {
      email: form.get("email"),
      deltaUsd: form.get("deltaUsd"),
      reason: form.get("reason"),
    });
    msg.textContent = `余额 ${result.balanceUsd}`;
    await load();
  } catch (error) {
    msg.textContent = error.message;
  }
});

document.querySelector("#refresh").addEventListener("click", async () => {
  const msg = document.querySelector("#refresh-msg");
  try {
    const result = await admin("/api/admin/refresh", {});
    msg.textContent = `橙签 ${result.omen} · ${result.day}`;
    await load();
  } catch (error) {
    msg.textContent = error.message;
  }
});

if (sessionStorage.getItem("oo_admin")) {
  tokenBox.value = sessionStorage.getItem("oo_admin");
  load()
    .then(() => {
      gate.classList.add("hidden");
      panel.classList.remove("hidden");
    })
    .catch(() => {});
}
