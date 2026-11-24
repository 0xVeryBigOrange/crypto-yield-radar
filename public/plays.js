const SIGNS = ["白羊", "金牛", "双子", "巨蟹", "狮子", "处女", "天秤", "天蝎", "射手", "摩羯", "水瓶", "双鱼"];
const ANIMALS = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];
const SPREAD_COUNT = { daily: 1, yesno: 1, three: 3, love: 5, career: 4, choice: 5, celtic: 10 };

function freshNonce() {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function resultNode() {
  return document.getElementById("result");
}

function showReading(payload, again) {
  const node = resultNode();
  if (!node || typeof mountReading !== "function") return;
  mountReading(node, payload && payload.reading ? payload : payload, again || null);
}

async function draw(path, body) {
  const node = resultNode();
  if (!node) return;
  node.textContent = "正在写…";
  try {
    const data = await api(path, { ...body, tier: "free" });
    showReading(data, async () => {
      const paid = await api(path, { ...body, tier: "full", ack: true });
      showReading(paid, null);
    });
  } catch (error) {
    node.innerHTML = `<p class="msg bad">${esc(friendlyError(error))}</p>`;
  }
  node.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bootTarot() {
  const form = document.getElementById("tarot-form");
  const deck = document.getElementById("deck");
  if (!form || !deck) return;
  let state = { nonce: freshNonce(), cut: 0, picks: [] };
  const need = () => SPREAD_COUNT[form.spread.value] || 1;
  const render = () => {
    state.picks = [];
    deck.innerHTML = "";
    const hint = document.getElementById("pick-hint");
    if (hint) hint.textContent = `点选 ${need()} 张。也可以直接翻。`;
    for (let index = 0; index < 78; index += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "back flip";
      button.textContent = "橙";
      button.addEventListener("click", () => {
        const at = state.picks.indexOf(index);
        if (at >= 0) state.picks.splice(at, 1);
        else if (state.picks.length < need()) state.picks.push(index);
        button.classList.toggle("picked", state.picks.includes(index));
        button.textContent = state.picks.includes(index) ? "选" : "橙";
        if (hint) hint.textContent = `已选 ${state.picks.length} / ${need()}`;
        if (state.picks.length === need()) {
          draw("/api/tarot", {
            spread: form.spread.value,
            question: form.question.value,
            nonce: state.nonce,
            cut: state.cut,
            picks: state.picks.slice(),
          });
        }
      });
      deck.appendChild(button);
    }
  };
  document.getElementById("shuffle")?.addEventListener("click", () => {
    state = { nonce: freshNonce(), cut: 0, picks: [] };
    render();
    deck.classList.remove("shuffling");
    void deck.offsetWidth;
    deck.classList.add("shuffling");
    const hint = document.getElementById("pick-hint");
    if (hint) hint.textContent = "牌已重新洗过。再点选，或直接翻。";
  });
  document.getElementById("cut")?.addEventListener("click", () => {
    state.cut = (state.cut + 7) % 78;
    render();
    const hint = document.getElementById("pick-hint");
    if (hint) hint.textContent = `已切牌，起点移到第 ${state.cut + 1} 张。点选 ${need()} 张。`;
  });
  document.getElementById("auto")?.addEventListener("click", () => {
    draw("/api/tarot", { spread: form.spread.value, question: form.question.value, nonce: state.nonce, cut: state.cut });
  });
  form.spread?.addEventListener("change", render);
  render();
}

function bootStick() {
  document.getElementById("shake")?.addEventListener("click", () => {
    const tube = document.getElementById("tube");
    tube?.classList.add("shaking");
    const body = { nonce: freshNonce() };
    window.setTimeout(() => {
      tube?.classList.remove("shaking");
      draw("/api/stick", body);
    }, 820);
  });
}

function bootIching() {
  const lines = [];
  const list = document.getElementById("yao-list");
  const paint = () => {
    if (!list) return;
    const names = ["初爻", "二爻", "三爻", "四爻", "五爻", "上爻"];
    list.innerHTML = lines
      .map((value, index) => `<p class="yao">${names[index]} · ${value}${value === 6 || value === 9 ? " 动" : ""} · 自下而上</p>`)
      .join("");
  };
  document.getElementById("toss")?.addEventListener("click", () => {
    if (lines.length >= 6) return;
    const faces = [0, 1, 2].map(() => (Math.random() < 0.5 ? "字" : "背"));
    const sum = faces.reduce((total, face) => total + (face === "字" ? 3 : 2), 0);
    lines.push(sum);
    const coins = document.getElementById("coins");
    if (coins) {
      coins.innerHTML = faces.map((face) => `<span class="coin spin">${face}</span>`).join("");
    }
    paint();
    if (lines.length === 6) draw("/api/iching", { lines: lines.slice(), nonce: freshNonce() });
  });
  document.getElementById("auto-iching")?.addEventListener("click", () => {
    draw("/api/iching", { nonce: freshNonce() });
  });
}

function choices(target, names, current) {
  const node = document.getElementById(target);
  if (!node) return;
  node.innerHTML = names
    .map((name) => `<option value="${name}"${name === current ? " selected" : ""}>${name}</option>`)
    .join("");
}

function bootAstro() {
  const preset = new URLSearchParams(location.search).get("sign") || "白羊";
  choices("sign", SIGNS, preset);
  choices("left", SIGNS, "白羊");
  choices("right", SIGNS, "天秤");
  const load = () => {
    const sign = document.getElementById("sign").value;
    const node = resultNode();
    node.textContent = "在看星图…";
    api(`/api/astro?sign=${encodeURIComponent(sign)}`)
      .then((data) => {
        showReading(data, async () => {
          const paid = await api("/api/astro", { sign, tier: "full", ack: true });
          showReading(paid, null);
        });
      })
      .catch((error) => {
        node.innerHTML = `<p class="msg bad">${esc(friendlyError(error))}</p>`;
      });
  };
  document.getElementById("sign")?.addEventListener("change", load);
  document.getElementById("match-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const left = document.getElementById("left").value;
    const right = document.getElementById("right").value;
    draw("/api/astro/match", { left, right });
  });
  load();
}

function bootZodiac() {
  const preset = new URLSearchParams(location.search).get("animal") || "鼠";
  choices("animal", ANIMALS, preset);
  const load = () => {
    const animal = document.getElementById("animal").value;
    const node = resultNode();
    node.textContent = "在翻生肖…";
    api(`/api/zodiac?animal=${encodeURIComponent(animal)}`)
      .then((data) => {
        showReading(data, async () => {
          const paid = await api("/api/zodiac", { animal, tier: "full", ack: true });
          showReading(paid, null);
        });
      })
      .catch((error) => {
        node.innerHTML = `<p class="msg bad">${esc(friendlyError(error))}</p>`;
      });
  };
  document.getElementById("animal")?.addEventListener("change", load);
  load();
}

function bootAlmanac() {
  const node = resultNode();
  if (!node) return;
  node.textContent = "在排今日…";
  api("/api/almanac")
    .then((data) => {
      showReading(data, async () => {
        const paid = await api("/api/almanac", { tier: "full", ack: true });
        showReading(paid, null);
      });
    })
    .catch((error) => {
      node.innerHTML = `<p class="msg bad">${esc(friendlyError(error))}</p>`;
    });
}

function bootNumber() {
  document.getElementById("number-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    draw("/api/number", { birthday: new FormData(event.target).get("birthday") });
  });
}

function bootDream() {
  document.getElementById("dream-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    draw("/api/dream", { text: new FormData(event.target).get("text"), nonce: freshNonce() });
  });
}

function bootRune() {
  document.getElementById("rune-one")?.addEventListener("click", () => draw("/api/rune", { count: 1, nonce: freshNonce() }));
  document.getElementById("rune-three")?.addEventListener("click", () => draw("/api/rune", { count: 3, nonce: freshNonce() }));
  document.getElementById("lenormand")?.addEventListener("click", () => draw("/api/lenormand", { count: 3, nonce: freshNonce() }));
}

function bootCollection() {
  const node = document.getElementById("collection");
  if (!node) return;
  api("/api/collection")
    .then((data) => {
      const bars = (data.progress || [])
        .map((item) => `<li><strong>${esc(item.kind)}</strong> ${esc(item.have)} / ${esc(item.need)} · 集齐送 ${esc(item.credits)} 次深度解读</li>`)
        .join("");
      const lit = (data.items || []).slice(-24).map((item) => `<span class="chip">${esc(item.kind)} ${esc(item.id)}</span>`).join("");
      node.innerHTML = `<ul>${bars}</ul><div class="chip-row">${lit || "<p class='fine'>还没点亮。去抽一张。</p>"}</div>`;
    })
    .catch(() => {
      node.innerHTML = `<p class="fine">登录后，抽到的塔罗、签、卦和符文会留在这里。<a href="/account">去登录</a></p>`;
    });
}

const boots = {
  tarot: bootTarot,
  stick: bootStick,
  iching: bootIching,
  astro: bootAstro,
  zodiac: bootZodiac,
  almanac: bootAlmanac,
  number: bootNumber,
  dream: bootDream,
  rune: bootRune,
  collection: bootCollection,
};

const playPage = document.body.dataset.page;
if (boots[playPage]) boots[playPage]();
