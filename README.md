# 橙签 · OrangeOmens

给中文圈加密货币和美股/期权交易员的娱乐向塔罗。牌面混着 K 线，语气是交易员自己的吐槽。站长是 X 上的 [@0xVeryBigOrange](https://x.com/0xVeryBigOrange)（大橙子）。

**仅供娱乐，不构成投资、法律、医疗或心理建议。** 牌面不报目标价，不给买卖指令，不报胜率，也不声称可以改运。心情标签只有观望、防守、进取，描述的是心情，不是操作。

## 牌桌上有什么

| 功能 | 免费 | 完整版 |
| --- | --- | --- |
| 今日橙签 | 每天一张牌、一句吐槽、一个心情标签。新加坡日和美股盘前各一版，当天所有人看到同一张 | 1 USDT，三段解读 |
| 钱包命盘 | 灵魂数字、链上生日、持仓脾气、追涨杀跌指数 | 2 USDT，长图 |
| AI 塔罗提问 | 每人每天一签短牌 | 1 USDT，三张牌 |
| 币缘 / 股缘 | 兼容分 | 1 USDT，图卡 |
| 合盘 | 和大橙子，或两个昵称 / 钱包之间的兼容分。分享链接 `/i/邀请码` | 1 USDT |
| 运势 K 线 | 付费结果附带。纵轴是心情刻度，不是价格 | 含在付费结果里 |
| 月卡 | — | 9.9 USDT / 30 天，期间完整解读不另扣。续费在到期日之后顺延 30 天 |
| 欧气榜 | 每日签到。只显示昵称和玩笑分，不显示邮箱和完整地址 | 签到不加余额 |

同一天、同一个问题的结果是确定的，并缓存在数据库里。没有上游密钥时走中文模板库；配了 `UPSTREAM_API_KEY` 之后，便宜模型只润色句子，心情、分数、牌名和 K 线仍由模板决定。模型如果写出目标价、买卖指令或胜率，这句会被丢掉，留下模板原文。

钱包命盘只收地址。私钥、助记词和 64 位十六进制会被拒绝。公开页面上的地址显示成 `0x1234…5678`。

## 时间和每日任务

- 今日橙签按 **Asia/Singapore** 的日期换日，00:00 起第一位访客就会拿到新的一天。
- 盘前橙签按 **America/New_York**。16:00 之后以及周末，会提前生成下一个交易日的那一张，盘中保持不变。
- GitHub Actions 每天 **00:15 UTC**（新加坡 08:15，美东收盘之后）`POST /internal/daily`，请求头 `X-Cron-Secret`。它会确保两张日签、写当日汇总，并删掉 180 天以前的个人解读缓存。日签本身永久保留。
- 仓库密钥仍是 `APP_URL` 和 `CRON_SECRET`。`APP_URL` 用 `https://keymint-1106.onrender.com`。

## 充值

余额是预付美元，1 USDT 或 1 USDC 记 1 美元。最低 5 美元。只认转入下面这个地址的一笔交易，用交易哈希核验，同一笔不会入账两次。

收款地址：`0xa18d1810C8457f7d09E3311DF8D2Faf1d9c2E19C`

| 网络 | 代币 | 合约 | 小数 | 确认数 |
| --- | --- | --- | --- | --- |
| Ethereum | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 | 12 |
| Ethereum | USDC | `0xA0b86991c6218b36c1d19D4a2e9EB0cE3606eB48` | 6 | 12 |
| BSC | USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 | 15 |
| BSC | USDC | `0x8AC76a51cc950d9822D68b83fE1Ad70ADf3a8B0d` | 18 | 15 |

充值页、月卡和每一次付费解锁都会先展示：**虚拟服务一经交付不予退款。** 服务端也要求请求带上 `ack: true`。

## 部署

`render.yaml` 里的服务名仍是 `keymint`，数据库仍是 `keymint-db`，环境组仍是 `keymint-config`。这样同步 Blueprint 会更新现有的免费实例，公开地址继续是 [https://keymint-1106.onrender.com](https://keymint-1106.onrender.com)，而不会新建一套资源。免费 Web 服务空闲约 15 分钟会休眠；免费 Postgres 大约 30 天后到期。进程监听 `0.0.0.0:$PORT`，磁盘是临时的，图片在内存里生成。

### 这次改动的环境变量

| 变量 | 变化 |
| --- | --- |
| `APP_NAME` | 改为 `橙签` |
| `APP_PUBLIC_URL` | 新增，`https://keymint-1106.onrender.com`。分享图和 OG 链接用它。没填时改用 Render 自带的 `RENDER_EXTERNAL_URL`，本地则是 `http://localhost:3000` |
| `LLM_MODEL` | 新增，默认 `openai/gpt-4o-mini`。只在有密钥时使用 |
| `LLM_TIMEOUT_MS` | 可选，默认 12000，Blueprint 里不写 |
| `UPSTREAM_API_KEY` | 没变，仍然 `sync: false`。不填时全站走模板 |
| `UPSTREAM_PROVIDER` / `UPSTREAM_BASE_URL` | 没变，只用于润色文案 |
| `SESSION_SECRET` / `ADMIN_TOKEN` / `CRON_SECRET` | 没变，继续由 Render 生成。不要轮换，除非打算让所有人重新登录 |
| 充值、RPC、确认数 | 没变 |
| `MARKUP`、`DEFAULT_RPM`、`RESERVE_BUFFER`、`DEFAULT_MAX_COMPLETION` | 应用不再读取。留在环境组里，避免同步时把已有值删掉 |

GitHub 侧不用新增密钥。

## 本地运行

```bash
docker compose up -d db
cp .env.example .env
npm install
npm run dev
```

打开 <http://localhost:3000>。管理页是 <http://localhost:3000/admin>，令牌放在 `.env` 的 `ADMIN_TOKEN`，浏览器只把它留在 `sessionStorage`。

```bash
npm test
npm run build
node dist/index.js
```

`TEST_DATABASE_URL` 的库名里要带 `test`，集成测试才会连真库。日常的 `npm test` 不需要数据库。

字体是 [得意黑 Smiley Sans](https://github.com/atelier-anchor/smiley-sans) 的 Oblique 字重，OFL 1.1，文件在 `public/fonts/`。没有改字，也没有改保留名称。
