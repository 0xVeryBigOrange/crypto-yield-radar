const DISCLAIMER = "仅供娱乐，不构成投资、法律、医疗或心理建议";

const params = new URLSearchParams(location.search);
const invite = params.get("with");
if (invite) sessionStorage.setItem("oo_ref", invite.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

async function api(path, body) {
  const response = await fetch(path, {
    credentials: "same-origin",
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || "请求失败");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function $(id) {
  return document.getElementById(id);
}

function moodClass(mood) {
  if (mood === "防守") return "guard";
  if (mood === "进取") return "push";
  return "watch";
}

function asReading(payload) {
  if (payload && typeof payload === "object" && payload.reading) {
    if (payload.balanceUsd) setBalance(payload.balanceUsd);
    return payload.reading;
  }
  return payload;
}

function setBalance(value) {
  document.querySelectorAll("[data-balance]").forEach((node) => {
    node.textContent = value ? `${value} USDT` : "";
  });
}

async function refreshMe() {
  try {
    const me = await api("/api/me");
    setBalance(me.balanceUsd);
    document.querySelectorAll("[data-nick]").forEach((node) => {
      node.textContent = me.nickname;
    });
    window.__me = me;
    return me;
  } catch {
    window.__me = null;
    setBalance("");
    return null;
  }
}

function candleSvg(candles) {
  if (!candles?.length) return "";
  const width = 640;
  const height = 120;
  const slot = width / candles.length;
  const body = Math.min(28, slot * 0.42);
  const lows = candles.map((candle) => Math.min(candle.l, candle.o, candle.c));
  const highs = candles.map((candle) => Math.max(candle.h, candle.o, candle.c));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(12, max - min);
  const yOf = (value) => height - ((value - min) / span) * (height - 8) - 4;
  const marks = candles
    .map((candle, index) => {
      const cx = slot * index + slot / 2;
      const up = candle.c >= candle.o;
      const color = up ? "#1f9d62" : "#d4534c";
      const y = yOf(Math.max(candle.o, candle.c));
      const h = Math.max(8, Math.abs(yOf(candle.o) - yOf(candle.c)));
      const top = Math.min(yOf(candle.h), y - 4);
      const bottom = Math.max(yOf(candle.l), y + h + 4);
      return `<line x1="${cx}" y1="${top}" x2="${cx}" y2="${bottom}" stroke="${color}" stroke-width="3" stroke-linecap="round"/><rect x="${cx - body / 2}" y="${y}" width="${body}" height="${h}" rx="2" fill="${color}"/>`;
    })
    .join("");
  return `<div class="candle-box"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="心情K线">${marks}</svg><p class="fine">心情刻度，不是价格。</p></div>`;
}

function splitTitle(title) {
  const parts = String(title ?? "").split(" · ");
  return { headline: parts[0] || "", sub: parts.slice(1).join(" · ") };
}

function zhDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return value;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function extraLines(view) {
  const bits = [];
  if (view.extras?.soul != null) bits.push(`灵魂数字 ${view.extras.soul}`);
  if (view.extras?.birthday) bits.push(`链上生日 ${zhDay(view.extras.birthday)}`);
  if (view.extras?.chaseNote) bits.push(view.extras.chaseNote);
  if (view.extras?.question) bits.push(`问题：${view.extras.question}`);
  return bits.map((line) => `<p class="fine">${esc(line)}</p>`).join("");
}

function cardHtml(view) {
  const card = view.cards?.[0] ?? {};
  const sections = (view.sections ?? [])
    .map((section) => `<section class="block"><h3>${esc(section.heading)}</h3><p>${esc(section.text)}</p></section>`)
    .join("");
  const score =
    view.score != null
      ? `<p class="score"><span>${esc(view.scoreLabel || "分数")}</span><strong>${esc(view.score)}</strong></p>`
      : "";
  const candles = (view.weekCandles?.length ? view.weekCandles : view.candles) ?? [];
  const share = view.sharePath
    ? `<button type="button" class="btn-ghost" data-share>复制分享链接</button>`
    : "";
  const title = splitTitle(view.title);
  return `<article class="sheet">
    <p class="stamp">仅供娱乐</p>
    <h2>${esc(title.headline)}</h2>
    ${title.sub ? `<p class="fine">${esc(title.sub)}</p>` : ""}
    <p class="card-name">${esc(card.name || "")}</p>
    <p class="epithet">${esc(card.epithet || "")}</p>
    <p class="mood mood-${moodClass(view.mood)}">${esc(view.mood)}</p>
    <p class="fine">${esc(view.moodNote || "")}</p>
    ${view.subject ? `<p class="fine">${esc(view.subject)}</p>` : ""}
    <p class="summary">${esc(view.summary)}</p>
    ${extraLines(view)}
    ${score}
    ${view.note ? `<p class="fine">${esc(view.note)}</p>` : ""}
    ${sections}
    ${view.locked ? "" : `<p class="quote">「${esc(view.quote)}」</p>`}
    ${view.imagePath ? `<img class="poster" src="${esc(view.imagePath)}" alt="运势K线分享卡">` : ""}
    ${candleSvg(candles)}
    <p class="disclaimer">${esc(view.disclaimer || DISCLAIMER)}</p>
    <div class="btn-row">${share}</div>
  </article>`;
}

function mountReading(host, payload, onPay) {
  const view = payload?.reading ? payload.reading : payload;
  if (payload?.balanceUsd) setBalance(payload.balanceUsd);
  host.innerHTML = cardHtml(view);
  const share = host.querySelector("[data-share]");
  if (share) {
    share.addEventListener("click", () => {
      const url = new URL(view.sharePath, location.origin).toString();
      const text = `${view.title} ${view.summary} ${view.disclaimer}`;
      if (navigator.share) {
        navigator.share({ title: view.title, text, url }).catch(() => copy(url, share));
      } else {
        copy(url, share);
      }
    });
  }
  if (view.locked && onPay) host.appendChild(payBox(view.priceUsd, onPay));
}

function payBox(price, onPay) {
  const box = document.createElement("form");
  box.className = "stack";
  box.innerHTML = `<label class="ack"><input type="checkbox" required> 我已知晓：虚拟服务一经交付不予退款。${esc(DISCLAIMER)}。</label>
    <button class="btn" type="submit">打开完整牌面 · ${esc(price)} USDT</button>
    <p class="msg"></p>`;
  box.addEventListener("submit", async (event) => {
    event.preventDefault();
    const msg = box.querySelector(".msg");
    msg.textContent = "在写了…";
    msg.className = "msg";
    try {
      await onPay();
    } catch (error) {
      msg.textContent = error.message;
      msg.classList.add("bad");
      if (error.status === 402) msg.textContent = `${error.message} 去「我的」充值。`;
    }
  });
  return box;
}

function copy(url, button) {
  navigator.clipboard?.writeText(url).then(
    () => {
      button.textContent = "链接已复制";
    },
    () => {
      button.textContent = url;
    },
  );
}

function showError(node, error) {
  if (!node) return;
  node.textContent = error?.message || "没有写成";
  node.classList.add("bad");
}

async function renderHome() {
  const sg = $("omen-sg");
  const us = $("omen-us");
  const home = await api("/api/home");
  const draw = (host, view, edition) => {
    mountReading(host, view, async () => {
      const paid = await api("/api/omen/unlock", { edition, tier: "full", ack: true });
      mountReading(host, asReading(paid), null);
    });
  };
  draw(sg, home.sg, "sg");
  draw(us, home.us, "us");
  const list = $("board");
  list.innerHTML = home.leaderboard.length
    ? home.leaderboard
        .map(
          (row, index) =>
            `<li><span class="rank">${index + 1}</span><span>${esc(row.nickname)}</span><span>${esc(row.streak)} 天</span><strong>${esc(row.score)}</strong></li>`,
        )
        .join("")
    : `<li><span></span><span>今天还没有人打卡。</span><span></span><span></span></li>`;
}

async function bootHome() {
  const sg = $("omen-sg");
  try {
    await renderHome();
  } catch (error) {
    sg.textContent = error.message;
  }
  const button = $("checkin");
  if (button && !button.dataset.bound) {
    button.dataset.bound = "1";
    button.addEventListener("click", async () => {
      const msg = $("checkin-msg");
      try {
        const result = await api("/api/checkin", { ack: true });
        msg.className = "msg";
        msg.textContent = `${result.line} 欧气 ${result.score}，连续 ${result.streak} 天。`;
        await renderHome();
      } catch (error) {
        showError(msg, error);
      }
    });
  }
}

function bootWallet() {
  $("wallet-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const address = new FormData(event.target).get("address");
    const host = $("wallet-result");
    host.textContent = "在翻地址…";
    try {
      const free = await api("/api/wallet", { address, tier: "free" });
      mountReading(host, free, async () => {
        const paid = await api("/api/wallet", { address, tier: "full", ack: true });
        mountReading(host, asReading(paid), null);
      });
    } catch (error) {
      host.innerHTML = `<p class="msg bad">${esc(error.message)}</p>`;
    }
  });
}

function bootAsk() {
  $("ask-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = new FormData(event.target).get("question");
    const tier = event.submitter?.dataset.tier || "free";
    const host = $("ask-result");
    if (tier === "full" && !event.target.ack.checked) {
      $("ask-msg").textContent = "先勾选那句不退款的确认。";
      return;
    }
    host.textContent = "在抽牌…";
    try {
      const data = await api("/api/ask", { question, tier, ack: tier === "full" });
      mountReading(host, asReading(data), async () => {
        const paid = await api("/api/ask", { question, tier: "full", ack: true });
        mountReading(host, asReading(paid), null);
      });
    } catch (error) {
      host.innerHTML = `<p class="msg bad">${esc(error.message)}</p>`;
    }
  });
}

function bootYuan() {
  $("yuan-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const symbol = new FormData(event.target).get("symbol");
    const host = $("yuan-result");
    host.textContent = "在配对…";
    try {
      const free = await api("/api/yuan", { symbol, tier: "free" });
      mountReading(host, free, async () => {
        const paid = await api("/api/yuan", { symbol, tier: "full", ack: true });
        mountReading(host, asReading(paid), null);
      });
    } catch (error) {
      host.innerHTML = `<p class="msg bad">${esc(error.message)}</p>`;
    }
  });
}

async function bootHepan() {
  const me = window.__me;
  const code = me?.referralCode;
  const inviteBox = $("invite");
  if (inviteBox) {
    if (code) {
      const link = `${location.origin}/i/${code}`;
      inviteBox.innerHTML = `<p>你的邀请链接</p><p class="addr">${esc(link)}</p><p class="fine">朋友打开就能合盘。没有返佣，只有一句可以转发的损话。</p>`;
    } else {
      inviteBox.innerHTML = `<p class="fine"><a href="/account">登录</a>后拿到邀请链接。</p>`;
    }
  }
  const preset = sessionStorage.getItem("oo_ref") || invite || "";
  if ($("with-code") && preset) $("with-code").value = preset;
  const orange = $("orange-result");
  try {
    const data = await api("/api/hepan", { mode: "orange", tier: "free" });
    mountReading(orange, data, async () => {
      const paid = await api("/api/hepan", { mode: "orange", tier: "full", ack: true });
      mountReading(orange, asReading(paid), null);
    });
  } catch (error) {
    orange.textContent = error.message;
  }
  $("code-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const friend = new FormData(event.target).get("code");
    const host = $("code-result");
    try {
      const data = await api("/api/hepan", { mode: "code", code: friend, tier: "free" });
      mountReading(host, data, async () => {
        const paid = await api("/api/hepan", { mode: "code", code: friend, tier: "full", ack: true });
        mountReading(host, asReading(paid), null);
      });
    } catch (error) {
      host.innerHTML = `<p class="msg bad">${esc(error.message)}</p>`;
    }
  });
  $("pair-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const host = $("pair-result");
    try {
      const data = await api("/api/hepan", {
        mode: "wallets",
        left: form.get("left"),
        right: form.get("right"),
        tier: "free",
      });
      mountReading(host, data, async () => {
        const paid = await api("/api/hepan", {
          mode: "wallets",
          left: form.get("left"),
          right: form.get("right"),
          tier: "full",
          ack: true,
        });
        mountReading(host, asReading(paid), null);
      });
    } catch (error) {
      host.innerHTML = `<p class="msg bad">${esc(error.message)}</p>`;
    }
  });
}

async function bootAccount() {
  const config = await api("/api/public-config");
  $("deposit-address").textContent = config.depositAddress;
  $("min-deposit").textContent = config.minDepositUsd;
  const me = window.__me;
  const session = $("session");
  if (me) {
    session.innerHTML = `<p>外号 <strong data-nick>${esc(me.nickname)}</strong></p>
      <p>余额 <strong>${esc(me.balanceUsd)}</strong> USDT</p>
      <p>${me.passActive ? `月卡开到 ${esc(me.passUntil)}` : "还没有月卡"}</p>
      <p>连续打卡 ${esc(me.checkinStreak)} 天</p>
      <button type="button" class="btn-ghost" id="logout">退出</button>`;
    $("logout").addEventListener("click", async () => {
      await api("/api/auth/logout", {});
      location.reload();
    });
    $("auth-forms").classList.add("hidden");
    const history = await api("/api/history");
    $("history").innerHTML = history.readings.length
      ? history.readings.map((item) => `<li><a href="${esc(item.sharePath)}">${esc(item.title)}</a></li>`).join("")
      : "<li>还没有牌。</li>";
  }
  $("login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await api("/api/auth/login", { email: form.get("email"), password: form.get("password") });
      location.reload();
    } catch (error) {
      showError($("login-msg"), error);
    }
  });
  $("signup-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await api("/api/auth/signup", {
        email: form.get("email"),
        password: form.get("password"),
        nickname: form.get("nickname"),
        ref: sessionStorage.getItem("oo_ref") || undefined,
      });
      location.reload();
    } catch (error) {
      showError($("signup-msg"), error);
    }
  });
  $("nick-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nickname = new FormData(event.target).get("nickname");
    try {
      await api("/api/profile", { nickname });
      location.reload();
    } catch (error) {
      showError($("nick-msg"), error);
    }
  });
  $("deposit-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.target.ack.checked) {
      $("deposit-msg").textContent = "先确认虚拟服务不退款。";
      return;
    }
    const form = new FormData(event.target);
    try {
      const result = await api("/api/deposits", {
        chain: form.get("chain"),
        txHash: form.get("txHash"),
        ack: true,
      });
      $("deposit-msg").className = "msg";
      $("deposit-msg").textContent = `已入账 ${result.amountUsd}。余额 ${result.balanceUsd}。`;
      setBalance(result.balanceUsd);
    } catch (error) {
      showError($("deposit-msg"), error);
    }
  });
  $("pass-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.target.ack.checked) {
      $("pass-msg").textContent = "先确认虚拟服务不退款。";
      return;
    }
    const key = sessionStorage.getItem("oo_pass_key") || `pass${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem("oo_pass_key", key);
    try {
      const result = await api("/api/pass", { ack: true, key });
      sessionStorage.removeItem("oo_pass_key");
      $("pass-msg").className = "msg";
      $("pass-msg").textContent = result.via === "replay" ? "这笔月卡已经开过了。" : `月卡已开到 ${result.passUntil}。`;
      setBalance(result.balanceUsd);
    } catch (error) {
      showError($("pass-msg"), error);
    }
  });
}

const page = document.body.dataset.page;
refreshMe().then(() => {
  if (page === "home") bootHome();
  if (page === "wallet") bootWallet();
  if (page === "ask") bootAsk();
  if (page === "yuan") bootYuan();
  if (page === "hepan") bootHepan();
  if (page === "account") bootAccount();
});
