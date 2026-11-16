# Command-Code-Routing

[English](README.md) · **简体中文**

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件，把
[Command Code](https://commandcode.ai) 的订阅真正用起来：**账户池 + 额度窗口路由**、
**按模型的用量看板**、以及**生图桥接的接线** —— 一个包，设置里只有一个页面。

- **客户端**：一个 `settings.section` 页面，60 秒自动刷新；账户池可增删改、模型表带能力标签，
  输入框上的徽章写的就是你此刻真正走的哪条路由；界面 10 种语言，跟随浏览器。
- **Host**：两个接口 —— `GET /command-code-usage.json`（用量，`?refresh=1` 强制刷新）与
  `GET|POST /command-code-quota-router.json`（账户池与路由，动作见下）。

## 安装

```bash
npm i dsh-command-code-routing
```

包自带 `cordis.patch.yml`：两个 provider（`commandcode` 走 `/provider/v1/chat/completions`，
`commandcode-anthropic` 走 `/provider/v1/messages`）和**一条** insert（`id: command-code-router`）。
`usage:` 与 `router:` 两个子对象分别装看板与路由的配置（两边都有 `path`，不能共用扁平命名空间）。

```yaml
- insert:
    - id: command-code-router
      name: 'dsh-command-code-routing'
      config:
        vendor: commandcode
        apiKeyRef: COMMANDCODE_API_KEY
        usage:
          path: /command-code-usage
          plan: goat
        router:
          path: /command-code-quota-router
          statusUrl: null            # Command Code 没有状态 feed
          routes:
            - primary: { provider: commandcode, model: deepseek/deepseek-v4.1-flash }
              fallback: { provider: deepseek-account, model: deepseek-flash }
            - primary: { provider: commandcode, model: deepseek/deepseek-v4-pro }
              fallback: { provider: deepseek-account, model: deepseek-v4-pro }
```

顶层键对两半都生效，写在 `usage:` / `router:` 里的只覆盖自己那一半。`usage.plan` 只决定月度额度那个
数字从哪来（`goat`），实时用量永远以接口返回为准。

### 凭据

`apiKeyRef`（默认 `COMMANDCODE_API_KEY`）经宿主凭据 seam 解析，不落库、不进本仓库。账户池里的其它账户
按 `COMMANDCODE_API_KEY_<ID>` 寻址（例如 `COMMANDCODE_API_KEY_A1`）；当前生效账户的密钥会镜像到
`COMMANDCODE_API_KEY`，那是 provider 读取的引用，因此切账户不必改任何 provider 配置。

## 它算的是额度，不是百分比

Command Code 是「订阅额度里扣美元」，所以适配器把两个接口折成看板一直认识的三个窗口：

| 看板窗口 | 数据来源 | 占额度比例 |
| --- | --- | --- |
| 5 小时（rolling） | `windowLimits.fiveHour` | 20% |
| 本周 | `windowLimits.weekly` | 50% |
| 本周期 | `credits.monthlyCredits` + `subscriptions.currentPeriodEnd` | 100% |

`GET /alpha/billing/credits` 给每个滚动窗口的已用/上限和剩余额度，`GET /alpha/billing/subscriptions`
给套餐 id 与周期结束时间。月度额度由周上限反推（`weekly.cap / 0.5`），所以换套餐是改配置，不是改代码。
模型单价内联（输入 / 输出 / 缓存读 / 缓存写，$/Mtok），按模型那一列就是拿它累加的。

因为接口给的是美元而不是四舍五入的百分比，OpenCode 时代的两件事在这个厂商上**故意关掉**：
按百分比反推套餐档位、以及 DeepSeek 的峰谷加倍（`peakAware: false`）。只有当你把这个插件指向真的
按时段加价的 provider 时才需要 `peakAware: true`。

## 账户池与轮替

账户顺序就是使用顺序，任何时候只有一个「当前账户」。

- **A 用完自动用 B**：`QUOTA` / `ACCOUNT_QUOTA` / HTTP 429 且窗口确认耗尽，或鉴权类错误
  （`AUTH`、`INVALID_CREDENTIAL`、`MISSING_CREDENTIAL` …）时，该账户标记为不可用（额度类到窗口重置，
  鉴权类 30 分钟），路由切到下一个启用账户并在**同一步重试**，整轮对话不降级。
- **只隔离一个模型**：单个模型报耗尽、池里还有额度时，只隔离这个模型（默认 30 分钟），其它模型继续走额度。
- **整池耗尽**：才把这条路整体回退（默认 `deepseek-account`），每 30 分钟或 rolling 重置时刻用零 token 的
  credits 接口探一次，恢复后自动交回。
- **上游容量/过载**：`router.fallbackOnCapacity: true` 时，额度没耗尽但上游返回容量类 429 也会回退，
  回退后第一次探测在 `capacityFallbackDelayMs`（60 秒）后开始，因为容量拒绝通常几分钟就恢复。
  设置页有「切到官方订阅 / 切回订阅」，也可直接
  `POST /command-code-quota-router.json {"action":"fallback"}` / `{"action":"primary"}`。
- **半路失败不丢步**：重试发生在同一次 `llm/stream` 内部，只有「一个 chunk 都还没吐」的主侧尝试会被原地改道；
  一旦已输出第一个字，流归调用方，失败原样抛出 —— 但**路由照样切换**，所以这一步的重试落在回退侧，
  而不是再撞同一堵墙。
- **恢复要连续干净 10 分钟**：回退期间每 60 秒探一次，只有连续 `recoverStableMs`（10 分钟）都成功才交回流量；
  中间任何一次失败窗口清零重来 —— 这是「上游一抖就来回横跳」的解法。
- **重置**：清空所有「额度用尽 / 鉴权失败」标记并立刻回到账户池，不动账户与密钥。

## 接口

`GET /command-code-usage.json` → `{plan, configuredPlan, detectedPlan, clock, peak, usage, usageError,
accounts[], activeAccount, models[], totals, pricing}`。`?refresh=1` 强刷一次额度读数；
`POST {"action":"refresh"}` 等价；`POST {"action":"syncPricing"}` 重读公开价目（这个厂商默认关着）。

`GET /command-code-quota-router.json` → `{mode, reason, cause, active, accounts[], quarantine, routes[],
upstream, net, lastFailure}`，密钥一律遮罩（只回 `hint`）。同一路径 `POST {action}` 支持
`netcheck`、`add`、`update`、`remove`、`activate`、`move`、`probe`、`status`、`fallback`、`primary`、
`reset`。`GET …?key=<账户 id>` 取单个账户的密钥，只用于本机「编辑密钥」输入框。

## 模型

provider 块声明的是 GOAT 订阅真正能调到的模型 —— OpenAI 兼容线上 62 个，Anthropic 线上 2 个 Claude。
模型 id 保留厂商标识前缀（`deepseek/deepseek-v4.1-flash`、`moonshotai/Kimi-K3.1-Pro`）：那是协议里的 id，
而 DSH 是把 provider 与 model 分开传的，斜杠安全。所有路由 `max_tokens` 统一 32000，`reasoning_effort`
最高到 `max`。

## 生图

文本全部走 Command Code，但**生图在 Command Code 没有对应端点** —— 它没有 `/images` 路由，模型目录里也没有
图像输出模型 —— 所以本包仍然把本机生图桥接接好（`dsh-image-gen` → `127.0.0.1:8791` → 持有一个可生图密钥的
代理）。`dsh-image-gen` 与 `dsh-image-bridge-supervisor` 指向你自己的图像后端即可；本包只提供接线，不携带密钥。

## 兼容性

- `dsh >= 0.2.0-rc.1`：流式调用走公开的 `llm/stream` waterfall。
- `dsh >= 0.2.2-rc.1`：额外在每一步之前用 `agent.model.select()` 对齐，让持久请求头与 assistant 来源跟随
  实际选中的一侧。

## 开发

```bash
node test.mjs            # 22 块：纯逻辑、路由、看板、客户端渲染、patch 完整性
node _smoke-usage.mjs    # 真实接口联调；需要环境变量 CC_KEY
```

MIT。
