# Keymint

Prepaid OpenAI-compatible API relay. Users deposit USDT or USDC, receive an `sk-` key, and call many models through one endpoint. Keymint charges upstream cost times `MARKUP` (default 1.3).

中文：这是一个预付费的大模型 API 转发服务。用户用 USDT / USDC 充值，获得自己的 `sk-` 密钥，按 OpenAI Chat Completions 协议调用多家模型。售价是上游成本乘以倍率，默认 1.3。默认上游是 [OpenRouter](https://openrouter.ai/)。

收款地址（以太坊和 BNB Smart Chain 相同，请逐字核对）：

`0xa18d1810C8457f7d09E3311DF8D2Faf1d9c2E19C`

## 架构

```text
浏览器控制台 / OpenAI SDK
        │  sk- 密钥，/v1/chat/completions，/v1/models
        ▼
Keymint（Node.js + TypeScript，Express）
        │  冻结余额 → 转发 → 按 usage 结算
        ▼
OpenAI 兼容上游（默认 OpenRouter）
        ▲
Postgres：用户、余额、充值、用量、模型价格、每日汇总
```

上游通过 `src/upstream.ts` 里的 `createOpenAICompatibleProvider()` 抽象。换一家同样兼容 OpenAI 的服务时，把 `UPSTREAM_PROVIDER` 设为 `openai-compatible`，并填写它的 `UPSTREAM_BASE_URL` 和 `UPSTREAM_API_KEY`。OpenRouter 专用的 `HTTP-Referer` / `X-Title` 只加在 `openrouter` 这一支上。

计费：

1. 用缓存的上游单价估算本次请求（提示词长度 / 4，加上 `max_tokens` 或 `DEFAULT_MAX_COMPLETION`），乘以 `MARKUP` 和 `RESERVE_BUFFER`，从可用余额冻到冻结余额。
2. 余额不够则返回 HTTP 402，请求不会转发出去。
3. 成功后优先用上游返回的 `usage.cost`，否则用 token 数乘缓存单价，再乘倍率，退回多冻的部分。
4. 流式响应会强制向上游发送 `stream_options.include_usage=true`。如果已经输出内容但没有 usage，按冻结金额结算。
5. 转发失败且没有输出时，冻结金额原路退回。

充值：所有用户共用上面的地址。用户在控制台提交交易哈希。服务端用 `ETH_RPC_URL` / `BSC_RPC_URL` 核对收据：

- RPC 的 `eth_chainId` 必须是 1（以太坊）或 56（BNB Smart Chain）
- 交易成功
- 日志来自下面的合约，且是转到收款地址的 `Transfer`
- 确认数达到阈值
- 金额不低于 `MIN_DEPOSIT_USD`（USDT / USDC 按 1:1 记成美元）
- `(chain, tx_hash)` 唯一，不能重复入账

| 链 | 代币 | 合约 | 小数 |
| --- | --- | --- | --- |
| Ethereum | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 |
| Ethereum | USDC | `0xA0b86991c6218b36c1d19D4a2e9EB0cE3606eB48` | 6 |
| BNB Smart Chain | USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 |
| BNB Smart Chain | USDC | `0x8AC76a51cc950d9822D68b83fE1Ad70ADf3a8B0d` | 18 |

原生 ETH、BNB 和其他代币不会入账。第一笔提交有效哈希的账户获得额度。

密码用 scrypt。API 密钥只存 SHA-256，完整密钥只在创建时返回一次。管理令牌用 `X-Admin-Token`。查询全部参数化。日志不记录提示词、补全、密钥或 RPC 地址。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | Postgres 连接串。Render 上由 Blueprint 从数据库注入。 |
| `UPSTREAM_API_KEY` | 调用模型时必填 | OpenRouter（或你选的上游）的 API key。没有它时网站和充值仍可用，`/v1/chat/completions` 返回 503。 |
| `SESSION_SECRET` | 生产必填 | 至少 16 位。用于会话令牌的 HMAC。Blueprint 会自动生成。 |
| `ADMIN_TOKEN` | 使用管理页时必填 | 打开 `/admin` 的令牌。Blueprint 会自动生成，之后到 Render 环境变量里复制。 |
| `UPSTREAM_PROVIDER` | 否 | `openrouter`（默认）或 `openai-compatible`。 |
| `UPSTREAM_BASE_URL` | 否 | 默认 `https://openrouter.ai/api/v1`。 |
| `APP_PUBLIC_URL` | 否 | 公网地址，用作 OpenRouter 的 `HTTP-Referer`。部署后改成真实域名。 |
| `APP_NAME` | 否 | 默认 `Keymint`。 |
| `MARKUP` | 否 | 默认 `1.3`。售价 = 上游成本 × 倍率。 |
| `RESERVE_BUFFER` | 否 | 默认 `1.25`。冻结金额相对估价的缓冲。 |
| `DEFAULT_MAX_COMPLETION` | 否 | 默认 `1024`。请求没带 `max_tokens` 时用来估算冻结额。 |
| `DEFAULT_RPM` | 否 | 默认 `60`。每把新密钥每分钟请求数。 |
| `MIN_DEPOSIT_USD` | 否 | 默认 `5`。 |
| `MIN_CONFIRMATIONS_ETH` | 否 | 默认 `12`。 |
| `MIN_CONFIRMATIONS_BSC` | 否 | 默认 `15`。 |
| `ETH_RPC_URL` | 否 | 默认 `https://ethereum.publicnode.com`。 |
| `BSC_RPC_URL` | 否 | 默认 `https://bsc.publicnode.com`。 |
| `HOST` | 否 | 默认 `0.0.0.0`。 |
| `PORT` | 否 | 默认 `3000`。Render 会注入。 |
| `NODE_ENV` | 否 | 生产环境设为 `production`，会话 cookie 才会带 `Secure`。 |
| `CORS_ORIGINS` | 否 | 只作用于 `/v1`。默认 `*`。多个来源用逗号分隔。 |
| `UPSTREAM_TIMEOUT_MS` | 否 | 默认 `120000`。 |

收款地址写在代码里，不通过环境变量修改，避免配错。

## 本地运行

需要 Node.js 22+。

用 Docker Compose（会启动 Postgres 和本服务）：

```bash
cp .env.example .env
# 编辑 .env，至少填上 UPSTREAM_API_KEY
export UPSTREAM_API_KEY=sk-or-...
docker compose up --build
```

打开 <http://localhost:3000>。管理页 <http://localhost:3000/admin>，令牌是 Compose 里的 `dev-admin-token`。

不用 Docker 时，本机先有 Postgres 16，然后：

```bash
createdb keymint
cp .env.example .env
# 修改 DATABASE_URL，并填上 UPSTREAM_API_KEY
npm ci
npm test
npm run dev
```

`npm run dev` 会读取 `.env`，但不会覆盖已经存在的环境变量。生产进程是 `npm run build && npm start`。

每日任务在本地可以手动跑：

```bash
npm run build && npm run daily
# 或者不编译：npm run daily:dev
```

它会刷新模型价格，并写入昨天（UTC）的用量和加价收入汇总。

只跑单元测试不需要数据库。带数据库的端到端测试：

```bash
TEST_DATABASE_URL=postgres://keymint:keymint@127.0.0.1:5432/keymint_test npm test
```

数据库名必须包含 `test`，测试会清空这张库里的业务表。

## 部署到 Render

1. 把这个仓库推到 GitHub。
2. 在 Render Dashboard 选择 **New → Blueprint**，指向本仓库。`render.yaml` 会创建：
   - Web 服务 `keymint`（starter，不休眠）
   - Postgres `keymint-db`（`basic-256mb`，PostgreSQL 16）
   - Cron `keymint-daily`，每天 00:15 UTC 刷新价格并写汇总
3. 创建时 Render 会要求填写 `UPSTREAM_API_KEY`（环境组 `keymint-config`，`sync: false`）。到 <https://openrouter.ai/keys> 创建密钥并粘贴。Web 和 Cron 共用这一项。
4. `SESSION_SECRET` 和 `ADMIN_TOKEN` 由 Blueprint 生成。部署完成后在 Web 服务的 Environment 里复制 `ADMIN_TOKEN`，打开 `https://<service>.onrender.com/admin` 粘贴。
5. 可选：把 `APP_PUBLIC_URL` 加到 Web 服务环境变量，值为公网 `https://<service>.onrender.com`，这样 OpenRouter 的来源统计才正确。
6. 健康检查是 `/healthz`。服务监听 `0.0.0.0:$PORT`。
7. 确认服务起来之后，用一笔不低于 5 USD 的 USDT 或 USDC（只限上面四个合约）打到收款地址，在控制台提交交易哈希。

费用提示：starter Web、starter Cron 和 `basic-256mb` Postgres 都是付费规格。API 不适合用会休眠的 free Web。数据库如果改成 `free`，Render 的免费 Postgres 会在 30 天后过期。

Blueprint 已按 Render 的 [render.yaml schema](https://render.com/schema/render.yaml.json) 校验。

## 增加另一个上游

在 `src/upstream.ts` 的 `createProvider()` 增加一个分支。如果对方的 `GET /models` 和 `POST /chat/completions` 与 OpenAI 兼容，直接调用 `createOpenAICompatibleProvider()`。模型价格读取 `pricing.prompt`、`pricing.completion`、`pricing.request`（每 token 的美元价格，和 OpenRouter 一致）。不同的价格格式需要在 `listModels()` 里换算后再写入 `model_prices`。

## 测试

```bash
npm test
npm run typecheck
npm run build
```

`tests/payments.test.ts` 用假的 RPC 覆盖入账规则。`tests/billing.test.ts` 覆盖倍率、冻结、结算和余额调整。设置了 `TEST_DATABASE_URL` 时，`tests/e2e.test.ts` 会走注册、充值、流式与非流式转发、402、限流和管理调账。

## 安全与合规

- 不要把 `.env`、`UPSTREAM_API_KEY`、`ADMIN_TOKEN`、`SESSION_SECRET` 提交进仓库。
- 这是记账额度，不是链上托管。错链、错误代币和原生币转账无法自动找回。
- 服务不隶属 OpenAI、Anthropic、Google、xAI、DeepSeek 或 Meta。
- 上线前请自行确认你所在地的支付、外汇和资金传输要求。本仓库的说明不是法律意见。
