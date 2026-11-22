const messages = {
  zh: {
    invalid_login: "邮箱或密码不正确。",
    email_taken: "这个邮箱已经注册。",
    weak_password: "密码至少 10 位。",
    bad_email: "请填写有效邮箱。",
    below_minimum: "低于最低充值金额。",
    already_credited: "这笔交易已经入账。",
    pending: "交易还没有打包，请稍后再提交。",
    confirmations: "确认数还不够。",
    no_transfer: "这笔交易里没有转到收款地址的 USDT 或 USDC。",
    failed: "交易执行失败，不能入账。",
    bad_tx: "交易哈希格式不正确。",
    wrong_network: "RPC 网络不匹配，请联系运营方。",
    rpc_error: "暂时连不上区块链节点。",
    amount_untrusted: "金额超出可入账范围。",
    rate_limited: "尝试次数太多，请稍后再试。",
    generic: "请求没有完成。",
    copied: "已复制",
    empty: "还没有记录。",
    revoke: "撤销",
  },
  en: {
    invalid_login: "Invalid email or password.",
    email_taken: "That email is already registered.",
    weak_password: "Use at least 10 characters.",
    bad_email: "Enter a valid email.",
    below_minimum: "Below the minimum deposit.",
    already_credited: "This transaction was already credited.",
    pending: "The transaction is not mined yet.",
    confirmations: "Not enough confirmations yet.",
    no_transfer: "No USDT or USDC transfer to the deposit address was found.",
    failed: "The transaction reverted.",
    bad_tx: "That transaction hash is not valid.",
    wrong_network: "The RPC is on the wrong network.",
    rpc_error: "The chain RPC could not be reached.",
    amount_untrusted: "Amount is outside the supported range.",
    rate_limited: "Too many attempts. Try again later.",
    generic: "The request did not complete.",
    copied: "Copied",
    empty: "Nothing here yet.",
    revoke: "Revoke",
  },
};

let depositAddress = "";

function lang() {
  return window.KeymintI18n.get();
}
function t(code) {
  return messages[lang()][code] || messages[lang()].generic;
}
function say(id, code, ok = false, detail = "") {
  const el = document.getElementById(id);
  el.className = ok ? "msg ok" : "msg error";
  el.textContent = detail ? `${t(code)} ${detail}` : t(code);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { response, body };
}
function groupAddress(address) {
  return `0x ${(address.slice(2).match(/.{1,4}/g) || []).join(" ")}`;
}
function when(value) {
  return new Date(value).toLocaleString(lang() === "en" ? "en" : "zh-CN");
}
function explorer(chain, hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  return (chain === "bsc" ? "https://bscscan.com/tx/" : "https://etherscan.io/tx/") + hash;
}
function emptyRow(cols) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = cols;
  td.textContent = t("empty");
  tr.append(td);
  return tr;
}

async function refresh() {
  const me = await api("/api/me", { headers: {} });
  const signedIn = me.response.ok;
  document.getElementById("auth-view").classList.toggle("hidden", signedIn);
  document.getElementById("app-view").classList.toggle("hidden", !signedIn);
  document.getElementById("logout").classList.toggle("hidden", !signedIn);
  if (!signedIn) return;
  document.getElementById("me-email").textContent = me.body.email;
  document.getElementById("balance").textContent = me.body.balanceUsd;
  document.getElementById("reserved").textContent = me.body.reservedUsd;
  await Promise.all([loadConfig(), loadDeposits(), loadKeys(), loadUsage(), loadPrices()]);
}

async function loadConfig() {
  const { body } = await api("/api/public-config", { headers: {} });
  depositAddress = body.depositAddress;
  document.getElementById("deposit-address").textContent = body.depositAddress;
  document.getElementById("deposit-grouped").textContent = groupAddress(body.depositAddress);
  document.getElementById("min-deposit").textContent = body.minDepositUsd;
  document.getElementById("deposit-qr").src = "/api/deposit-qr.svg";
  const list = document.getElementById("token-list");
  list.replaceChildren();
  for (const chain of body.chains) {
    for (const token of chain.tokens) {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = `${chain.label} · ${token.symbol}`;
      const code = document.createElement("code");
      code.textContent = token.address;
      item.append(name, code);
      list.append(item);
    }
  }
}

async function loadDeposits() {
  const { body } = await api("/api/deposits", { headers: {} });
  const tbody = document.getElementById("deposit-body");
  tbody.replaceChildren();
  if (!body.deposits.length) {
    tbody.append(emptyRow(5));
    return;
  }
  for (const row of body.deposits) {
    const tr = document.createElement("tr");
    const link = document.createElement("a");
    const href = explorer(row.chain, row.txHash);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `${row.txHash.slice(0, 10)}…`;
    const cells = [when(row.createdAt), row.chain, row.token, `$${row.amountUsd}`];
    for (const value of cells) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    const td = document.createElement("td");
    td.append(link);
    tr.append(td);
    tbody.append(tr);
  }
}

async function loadKeys() {
  const { body } = await api("/api/keys", { headers: {} });
  const tbody = document.getElementById("key-body");
  tbody.replaceChildren();
  const active = body.keys.filter((key) => !key.revokedAt);
  if (!active.length) {
    tbody.append(emptyRow(3));
    return;
  }
  for (const key of active) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = key.name;
    const mask = document.createElement("td");
    mask.textContent = `${key.prefix}…${key.last4}`;
    const action = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-danger";
    button.textContent = t("revoke");
    button.addEventListener("click", async () => {
      await api(`/api/keys/${key.id}/revoke`, { method: "POST", body: "{}" });
      await loadKeys();
    });
    action.append(button);
    tr.append(name, mask, action);
    tbody.append(tr);
  }
}

async function loadUsage() {
  const { body } = await api("/api/usage", { headers: {} });
  const tbody = document.getElementById("usage-body");
  tbody.replaceChildren();
  if (!body.usage.length) {
    tbody.append(emptyRow(4));
    return;
  }
  for (const row of body.usage) {
    const tr = document.createElement("tr");
    for (const value of [
      when(row.createdAt),
      row.model,
      `${row.promptTokens} / ${row.completionTokens}`,
      `$${row.chargedUsd} (${row.status})`,
    ]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

async function loadPrices() {
  const { body } = await api("/api/pricing", { headers: {} });
  const tbody = document.getElementById("price-body");
  tbody.replaceChildren();
  const models = (body.models || []).slice(0, 20);
  if (!models.length) {
    tbody.append(emptyRow(3));
    return;
  }
  for (const model of models) {
    const tr = document.createElement("tr");
    for (const value of [model.id, `$${model.promptPerMillion}`, `$${model.completionPerMillion}`]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const { response, body } = await api("/api/auth/login", { method: "POST", body: JSON.stringify(data) });
  if (!response.ok) {
    say("login-msg", body.error?.code || "generic");
    return;
  }
  document.getElementById("login-msg").textContent = "";
  await refresh();
});

document.getElementById("signup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const { response, body } = await api("/api/auth/signup", { method: "POST", body: JSON.stringify(data) });
  if (!response.ok) {
    say("signup-msg", body.error?.code || "generic");
    return;
  }
  await refresh();
});

document.getElementById("logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  await refresh();
});

document.getElementById("copy-address").addEventListener("click", async () => {
  const label = document.querySelector("#copy-address span");
  label.textContent = t("copied");
  const copied = await copyText(depositAddress);
  if (!copied) label.textContent = lang() === "en" ? "Select the address" : "请手动选择地址";
  const shown = label.textContent;
  setTimeout(() => {
    if (label.textContent === shown) label.textContent = lang() === "en" ? label.dataset.en : label.dataset.zh;
  }, 2500);
});

async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await Promise.race([
        navigator.clipboard.writeText(value),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 400)),
      ]);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

document.getElementById("deposit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const { response, body } = await api("/api/deposits", { method: "POST", body: JSON.stringify(data) });
  if (!response.ok) {
    const extra = body.error?.confirmations != null ? `(${body.error.confirmations}/${body.error.required})` : "";
    say("deposit-msg", body.error?.code || "generic", false, extra);
    return;
  }
  document.getElementById("deposit-msg").className = "msg ok";
  document.getElementById("deposit-msg").textContent = `$${body.amountUsd}`;
  await refresh();
});

document.getElementById("key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const { response, body } = await api("/api/keys", { method: "POST", body: JSON.stringify(data) });
  if (!response.ok) {
    say("key-msg", body.error?.code || "generic");
    return;
  }
  document.getElementById("key-secret").classList.remove("hidden");
  document.getElementById("key-secret-value").textContent = body.token;
  event.target.reset();
  await loadKeys();
});

document.addEventListener("keymint:lang", () => {
  if (!document.getElementById("app-view").classList.contains("hidden")) refresh();
});

refresh();
