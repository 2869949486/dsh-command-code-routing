# Command-Code-Routing

[**简体中文**](README.zh-CN.md) · [English](README.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that puts a
[Command Code](https://commandcode.ai) subscription to work: **an account pool with credit-window
routing**, plus a **per-model usage dashboard** — one package, one Settings page.

- **Client** — one `settings.section` page, 60-second refresh, account pool editing, a per-model
  table with capability tags, and a composer badge that names the route you are actually on.
  Ten UI languages, following the browser.
- **Host** — two endpoints: `GET /command-code-usage.json` (usage; `?refresh=1` forces a refresh)
  and `GET|POST /command-code-quota-router.json` (pool and routing; actions below).

## Install

```bash
npm i dsh-command-code-routing
```

The package ships its own `cordis.patch.yml`: two providers (`commandcode` over
`/provider/v1/chat/completions`, `commandcode-anthropic` over `/provider/v1/messages`) and a
**single** insert (`id: command-code-router`). The `usage:` and `router:` sub-objects hold each
half's settings — both own a `path`, so they cannot share one flat namespace.

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
          statusUrl: null            # Command Code publishes no status feed
          routes:
            - primary: { provider: commandcode, model: deepseek/deepseek-v4.1-flash }
              fallback: { provider: deepseek-account, model: deepseek-flash }
            - primary: { provider: commandcode, model: deepseek/deepseek-v4-pro }
              fallback: { provider: deepseek-account, model: deepseek-v4-pro }
```

Top-level keys apply to both halves; a key inside `usage:` / `router:` overrides it for that half
only. `usage.plan` names the subscription tier (`goat`), which only decides where the allowance
number comes from — the live figures always come from the API.

### Credentials

`apiKeyRef` (default `COMMANDCODE_API_KEY`) is resolved through the host credential seam, never
stored in this repository. The account pool addresses further keys as
`COMMANDCODE_API_KEY_<ID>` (for example `COMMANDCODE_API_KEY_A1`); the key of the account that is
currently active is mirrored onto `COMMANDCODE_API_KEY`, which is the reference the provider
reads — so switching accounts never rewrites provider config.

## Credits, not percentages

Command Code bills dollars against a subscription allowance, so the adapter turns two endpoints
into the three windows the dashboard has always understood:

| Dashboard window | Source | Share of the allowance |
| --- | --- | --- |
| 5 hours (rolling) | `windowLimits.fiveHour` | 20% |
| This week | `windowLimits.weekly` | 50% |
| This period | `credits.monthlyCredits` + `subscriptions.currentPeriodEnd` | 100% |

`GET /alpha/billing/credits` gives used/cap per rolling window plus the remaining credit balance;
`GET /alpha/billing/subscriptions` supplies the plan id and the period end. The monthly allowance
is derived from the weekly cap (`weekly.cap / 0.5`), so a plan change is a config edit, not a code
change. Per-model prices are bundled (input / output / cache-read / cache-write in $/Mtok) and are
what the per-model column adds up.

Because the API reports dollars instead of a rounded percentage, the implied-plan inference stays off
for this vendor. Peak pricing, on the other hand, is real: the catalogue price is the **off-peak**
rate (17 h/day), and the DeepSeek models that carry a peak note bill **2×** during `01–04` and
`06–10` UTC, Monday to Friday (09:00–12:00 and 14:00–18:00 Beijing). `commandcode.js` owns that rule
(`PEAK` / `peakFactor`), so cost estimates and the price document double exactly for those models and
for nobody else — `deepseek-v4-flash-fast` and the `ultrafast` tier stay flat because the pricing page
prints no peak row for them.

Free previews are capped by request count, not by credits: `stealth/glyph-cluster:free` gets 1000
requests/day and `thinkingmachines/inkling-2-small:free` gets 200. Their dashboard limit is therefore
unbounded and their cost is zero — they never consume the plan allowance.

## Account pool and failover

Account order is usage order. Exactly one account is current at a time.

- **A runs out, B takes over.** `QUOTA` / `ACCOUNT_QUOTA` / HTTP 429 with the windows confirmed
  exhausted, or an auth-class failure (`AUTH`, `INVALID_CREDENTIAL`, `MISSING_CREDENTIAL`, …),
  marks the account unusable (until the window resets, or 30 minutes for auth) and retries on the
  next enabled account **inside the same step** — the turn is not degraded.
- **One model quarantined, not the plan.** A single model reporting exhaustion is isolated
  (default 30 minutes) while every other model keeps using the allowance.
- **Whole pool exhausted.** Only then does the route fall back (default `deepseek-account`), probing
  every 30 minutes or at the rolling reset with a zero-token credits call, and returning to the
  subscription once it recovers.
- **Upstream capacity.** With `router.fallbackOnCapacity: true`, a capacity/overload 429 falls back
  even when credits remain, and the first recovery probe starts after `capacityFallbackDelayMs`
  (60 s) because capacity rejections usually clear in minutes. The page has manual
  「fall back / back to subscription」 buttons, or
  `POST /command-code-quota-router.json {"action":"fallback"}` / `{"action":"primary"}`.
- **A mid-stream failure never loses a step.** Retries happen inside one `llm/stream` call, so only
  a primary attempt that has emitted nothing is redirected; once the first token is out the stream
  belongs to the caller and the failure surfaces as-is — but the route still moves, so the retry of
  that step lands on the fallback instead of the same wall.
- **Recovery must be clean for 10 minutes.** During a fallback the probe runs every 60 s; only
  `recoverStableMs` (10 min) of consecutive successes hands traffic back. Any failure resets the
  window — that is what stops an upstream hiccup from oscillating.
- **Reset** clears every exhausted/auth flag and returns to the pool without touching accounts.

## Endpoints

`GET /command-code-usage.json` → `{plan, configuredPlan, detectedPlan, clock, peak, usage,
usageError, accounts[], activeAccount, models[], totals, pricing}`. `?refresh=1` forces a fresh
credits read; `POST {"action":"refresh"}` does the same through the body, and
`POST {"action":"syncPricing"}` re-reads the public price table (off by default for this vendor).

`GET /command-code-quota-router.json` → `{mode, reason, cause, active, accounts[], quarantine,
routes[], upstream, net, lastFailure}`; keys are always masked (`hint` only). The same path accepts
`POST {action}` with `netcheck`, `add`, `update`, `remove`, `activate`, `move`, `probe`, `status`,
`fallback`, `primary`, `reset`. `GET …?key=<account id>` returns one account's key — a local-only
endpoint used by the “edit key” box.

## Models

The provider block declares the models that a GOAT subscription can actually call — 62 on the
OpenAI-compatible route. Model ids keep the vendor prefix (`deepseek/deepseek-v4.1-flash`,
`moonshotai/Kimi-K3.1-Pro`): that is the wire id, and DSH passes provider and model as separate
fields, so the slash is safe. Every route is capped at `max_tokens: 32000`; `reasoning_effort` is
accepted up to `max`.

Command Code also serves the Claude family over the Anthropic messages protocol
(`/provider/v1/messages`), but GOAT only covers `claude-sonnet-5-5` and `claude-haiku-5-5` — the rest
are premium tier (`individual-pro` and up). The package therefore ships **without** that provider;
add the `commandcode-anthropic` block back to `providers` to opt in (`api: anthropic-messages`,
`baseURL: https://api.commandcode.ai/provider`).

## Allowances

The per-model “monthly cap” in the dashboard is the plan allowance — $70 for GOAT base, derived from
`/alpha/billing/credits` as the weekly cap ÷ 50% — with the five-hour and weekly windows at 20% and
50% of it. Command Code's DEAL models carry a published *boosted* allowance, taken from the GOAT
column and hard-coded in `commandcode.js` as `BOOSTED_ALLOWANCE_USD`:
`deepseek/deepseek-v4.1-flash`, `z-ai/glm-5.3-flash`, `inclusionai/ling-3.1-flash` and
`inclusionai/ling-3.1-flash-1019` get $100.

## Images

Command Code produces no images: every `/provider/v1/images/*` route answers 404 and no model in the
catalogue emits image output (the only image-related entries, such as `Qwen/Qwen3.8-Omni-Flash`,
take images as *input*). This package therefore covers text and credits only, and wires no image
tooling — pair it with an image backend of your own if you need one.

## Compatibility

- `dsh >= 0.2.0-rc.1` — streaming goes through the public `llm/stream` waterfall.
- `dsh >= 0.2.2-rc.1` — additionally aligns `agent.model.select()` before each step so persisted
  request headers and assistant provenance follow the side actually chosen.

## Development

```bash
node test.mjs            # 22 blocks: pure logic, routing, dashboard, client render, patch integrity
node _smoke-usage.mjs    # live check against the API; needs CC_KEY in the environment
```

MIT licensed.
