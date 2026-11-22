const priceState = { models: [] };

function groupAddress(address) {
  const body = address.slice(2).match(/.{1,4}/g) || [];
  return `0x ${body.join(" ")}`;
}

function text(el, value) {
  if (el) el.textContent = value;
}

async function loadPublic() {
  const response = await fetch("/api/public-config");
  if (!response.ok) return;
  const data = await response.json();
  text(document.getElementById("deposit-address"), data.depositAddress);
  text(document.getElementById("deposit-grouped"), groupAddress(data.depositAddress));
  text(document.getElementById("min-deposit"), data.minDepositUsd);
  text(document.getElementById("markup-value"), data.markup);
  const qr = document.getElementById("deposit-qr");
  if (qr) qr.src = "/api/deposit-qr.svg";
  const list = document.getElementById("token-list");
  list.replaceChildren();
  for (const chain of data.chains) {
    for (const token of chain.tokens) {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = `${chain.label} · ${token.symbol}`;
      const code = document.createElement("code");
      code.textContent = token.address;
      const meta = document.createElement("span");
      meta.className = "muted";
      meta.textContent = `${token.decimals} dp`;
      item.append(name, code, meta);
      list.append(item);
    }
  }
  document.getElementById("copy-address").onclick = async () => {
    const value = document.getElementById("deposit-address").textContent || "";
    const label = document.querySelector("#copy-address span");
    const lang = window.KeymintI18n.get();
    label.textContent = lang === "en" ? "Copied" : "已复制";
    const copied = await copyText(value);
    if (!copied) label.textContent = lang === "en" ? "Select the address" : "请手动选择地址";
    setTimeout(() => {
      label.textContent = lang === "en" ? label.dataset.en : label.dataset.zh;
    }, 2500);
  };
}

function renderPrices() {
  const lang = window.KeymintI18n.get();
  const query = document.getElementById("price-filter").value.trim().toLowerCase();
  const body = document.getElementById("price-body");
  body.replaceChildren();
  const matched = priceState.models.filter((model) => {
    if (!query) return true;
    return model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query);
  });
  const rows = query ? matched.slice(0, 50) : matched.slice(0, 12);
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = priceState.models.length
      ? lang === "en" ? "No model matches that filter." : "没有匹配的模型。"
      : lang === "en"
        ? "The catalog appears after the upstream key is set and prices sync."
        : "配置上游密钥并完成同步后，这里会显示价格。";
    tr.append(td);
    body.append(tr);
    return;
  }
  for (const model of rows) {
    const tr = document.createElement("tr");
    for (const value of [model.id, `$${model.promptPerMillion}`, `$${model.completionPerMillion}`, model.contextLength ?? "—"]) {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.append(td);
    }
    body.append(tr);
  }
  const updated = document.getElementById("price-updated");
  if (priceState.updatedAt) {
    updated.textContent = (lang === "en" ? "Updated " : "更新于 ") + priceState.updatedAt;
  }
}

async function loadPrices() {
  const response = await fetch("/api/pricing");
  if (!response.ok) return;
  const data = await response.json();
  priceState.models = data.models || [];
  priceState.updatedAt = data.updatedAt;
  renderPrices();
}

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
    /* fall through to the selection fallback */
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

function rewriteHosts() {
  const origin = location.origin;
  document.querySelectorAll("pre").forEach((node) => {
    node.textContent = node.textContent.replaceAll("https://your-service.example.com", origin);
  });
}

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((item) => {
      item.setAttribute("aria-selected", item === button ? "true" : "false");
    });
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== button.dataset.tab;
    });
  });
});

document.getElementById("price-filter").addEventListener("input", renderPrices);
document.addEventListener("keymint:lang", renderPrices);
rewriteHosts();
loadPublic();
loadPrices();
