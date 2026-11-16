/**
 * Command Code (GOAT plan) adapter.
 *
 * The rest of this package speaks one shape: OpenCode's
 * `{usage: {rolling, weekly, monthly}}` block, where each window carries a
 * percentage and a reset timestamp. Command Code meters the same three windows
 * from two authenticated endpoints instead:
 *
 *   GET /alpha/billing/credits        → five-hour + weekly spent/cap, and the
 *                                       remaining monthly allowance in dollars
 *   GET /alpha/billing/subscriptions  → the billing period end (the monthly reset)
 *
 * so this module turns those two answers into the exact block the dashboard and
 * the quota router already understand. Prices come from Command Code's own
 * catalogue (`commandcode` CLI, catalogVersion 709028a9…), in $ per million
 * tokens, so the per-model cost the dashboard shows is the same number the
 * invoice uses.
 *
 * Endpoints that do NOT exist upstream: Command Code has no image-generation
 * route (`/provider/v1/images*` answers 404) and no image-output model, so this
 * package serves text and credits only.
 */

export const BASE_URL = 'https://api.commandcode.ai'
export const CREDITS_PATH = '/alpha/billing/credits'
export const SUBSCRIPTIONS_PATH = '/alpha/billing/subscriptions'

/** Which plan tiers exist, so `usage.plan` can validate a config value. */
export const PLANS = { goat: 'individual-goat' }

/** Window shape: the five-hour and weekly caps are published fractions of the
 *  monthly allowance, so the allowance is derived from whichever cap answered. */
const FIVE_HOUR_SHARE = 0.2
const WEEKLY_SHARE = 0.5

/** Monthly allowance in USD when the account has not reported one yet. GOAT is
 *  advertised as $70 of metered usage on the base plan (boosts add more). */
export const DEFAULT_ALLOWANCE_USD = 70

/** Dollars per million tokens, straight from the Command Code catalogue. */
export const PRICES = {
  'meta/muse-ember': { input: 0.1, output: 0.5, cacheRead: 0.004 },
  'meta/muse-spark-1.2': { input: 1.25, output: 4.25, cacheRead: 0.15 },
  'meta/muse-spark-1.2-contributor': { input: 0.1, output: 0.2, cacheRead: 0.002 },
  'meta/muse-spark-1.3': { input: 1.25, output: 4.25, cacheRead: 0.15 },
  'meta/muse-spark-1.3-contributor': { input: 0.1, output: 0.2, cacheRead: 0.002 },
  'meta/muse-spark-open': { input: 1.25, output: 4.25, cacheRead: 0.15 },
  'google/gemini-3.7-flash': { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0.08334 },
  'google/gemini-3.8-flash': { input: 1.5, output: 7.5, cacheRead: 0.15 },
  'deepseek/deepseek-v4-flash': { input: 0.15, output: 0.6, cacheRead: 0.003 },
  'deepseek/deepseek-v4-flash-fast': { input: 0.28, output: 0.56, cacheRead: 0.07 },
  'deepseek/deepseek-v4-flash-vision-exp': { input: 0.15, output: 0.6, cacheRead: 0.003 },
  'deepseek/deepseek-v4-pro': { input: 0.66, output: 1.98, cacheRead: 0.022 },
  'deepseek/deepseek-v4.1-flash': { input: 0.15, output: 0.6, cacheRead: 0.003 },
  'deepseek/deepseek-v4.1-flash-fast': { input: 0.16, output: 0.58, cacheRead: 0.016 },
  'deepseek/deepseek-v4.1-flash-ultrafast': { input: 2.4, output: 9.6, cacheRead: 0.048 },
  'inclusionai/ling-3.1-flash': { input: 0.3, output: 0.9, cacheRead: 0.06 },
  'inclusionai/ling-3.1-flash-1019': { input: 0.3, output: 0.9, cacheRead: 0.06 },
  'meituan/LongCat-2.0': { input: 0.3, output: 1.2, cacheRead: 0.006 },
  'minimax/minimax-m3.1-flash': { input: 0.15, output: 0.6, cacheRead: 0.015 },
  'MiniMaxAI/MiniMax-M2.5': { input: 0.3, output: 1.2, cacheRead: 0.03 },
  'MiniMaxAI/MiniMax-M3': { input: 0.3, output: 1.2, cacheRead: 0.06 },
  'mistral/mistral-large-4': { input: 1.36, output: 4.18, cacheRead: 0.14 },
  'moonshotai/Kimi-K2.5': { input: 0.6, output: 3, cacheRead: 0.1 },
  'moonshotai/Kimi-K2.6': { input: 0.95, output: 4, cacheRead: 0.16 },
  'moonshotai/Kimi-K2.7-Code': { input: 0.95, output: 4, cacheRead: 0.19 },
  'moonshotai/Kimi-K2.7-Code-Highspeed': { input: 1.9, output: 8, cacheRead: 0.38 },
  'moonshotai/Kimi-K3': { input: 3, output: 15, cacheRead: 0.3 },
  'moonshotai/Kimi-K3.1-Pro': { input: 2, output: 10, cacheRead: 0.2 },
  'nvidia/nemotron-3-ultra-550b-a55b': { input: 0.6, output: 2.4, cacheRead: 0.12 },
  'nvidia/nemotron-3.5-super-vl': { input: 0.2, output: 0.5, cacheRead: 0.04 },
  'ornith/ornith-1.5-122b': { input: 0.16, output: 0.64, cacheRead: 0.02 },
  'Qwen/Qwen3.6-Plus': { input: 0.5, output: 3, cacheRead: 0.1 },
  'Qwen/Qwen3.7-Flash': { input: 0.03, output: 0.13, cacheRead: 0.006, cacheWrite: 0.038 },
  'Qwen/Qwen3.7-Max': { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.13 },
  'Qwen/Qwen3.7-Plus': { input: 0.4, output: 1.6, cacheRead: 0.08, cacheWrite: 0.5 },
  'Qwen/Qwen3.8-27B': { input: 0.4, output: 3, cacheRead: 0.04 },
  'Qwen/Qwen3.8-Flash': { input: 0.16, output: 0.47, cacheRead: 0.016 },
  'Qwen/Qwen3.8-Max': { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
  'Qwen/Qwen3.8-Max-0902': { input: 2, output: 6, cacheRead: 0.25 },
  'Qwen/Qwen3.8-Max-Prime': { input: 4, output: 12, cacheRead: 0.5, cacheWrite: 5 },
  'Qwen/Qwen3.8-Omni-Flash': { input: 0.15, output: 0.47, cacheRead: 0.016 },
  'stepfun/Step-3.7-Flash': { input: 0.2, output: 1.15, cacheRead: 0.04 },
  'stepfun/Step-5-Preview': { input: 1, output: 2.7, cacheRead: 0.05 },
  'tencent/hy3-paid': { input: 0.14, output: 0.58, cacheRead: 0.035 },
  'tencent/hy4-preview': { input: 0.834, output: 2.501, cacheRead: 0.042 },
  'thinkingmachines/inkling-2-small:free': { input: 0, output: 0, cacheRead: 0 },
  'xiaomi/mimo-v2.6-flash': { input: 0.14, output: 0.28, cacheRead: 0.0028 },
  'xiaomi/mimo-v2.6-pro': { input: 0.435, output: 0.87, cacheRead: 0.0036 },
  'xiaomi/mimo-v2.6-pro-ultraspeed': { input: 4.35, output: 8.7, cacheRead: 0.036 },
  'z-ai/glm-5.3-flash': { input: 0.15, output: 0.5, cacheRead: 0.03 },
  'z-ai/glm-5.3-flashx': { input: 0.37, output: 1.25, cacheRead: 0.075 },
  'zai-org/GLM-5': { input: 1, output: 3.2, cacheRead: 0.2 },
  'zai-org/GLM-5.2': { input: 1.4, output: 4.4, cacheRead: 0.26 },
  'zai-org/GLM-5.2-Fast': { input: 3, output: 10.25, cacheRead: 0.5 },
  'zai-org/GLM-5.3': { input: 1.4, output: 4.4, cacheRead: 0.26 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  'gpt-5.6-sol': { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
  'gpt-6-luna': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'stealth/glyph-cluster:free': { input: 0, output: 0, cacheRead: 0 },
  'xai/grok-4.5': { input: 2, output: 6, cacheRead: 0.5 },
  'xai/grok-4.6': { input: 2, output: 6, cacheRead: 0.5 },
  'xai/grok-4.7': { input: 2, output: 6, cacheRead: 0.5 },
}

/** Per-model allowances that differ from the plan pool. Command Code publishes
 *  these on the pricing page as DEALs ("boosted credits"): the boost replaces the
 *  model's allowance, it is not added to the pool, and it applies automatically
 *  when the model is picked. Values below are the GOAT column. */
export const BOOSTED_ALLOWANCE_USD = {
  'deepseek/deepseek-v4.1-flash': 100,
  'inclusionai/ling-3.1-flash': 100,
  'inclusionai/ling-3.1-flash-1019': 100,
  'z-ai/glm-5.3-flash': 100,
}

/** Free previews are capped by request count per day, not by credits, so they
 *  never touch the allowance and their dollar limit is effectively unbounded. */
export const FREE_DAILY_REQUESTS = {
  'stealth/glyph-cluster:free': 1000,
  'thinkingmachines/inkling-2-small:free': 200,
}

/** Every other served model is metered against the plan's own allowance, because
 *  the plan-wide credit bucket is what actually runs out. */
export function limitsFor(allowanceUsd = DEFAULT_ALLOWANCE_USD) {
  const limits = {}
  for (const id of Object.keys(PRICES)) {
    if (FREE_DAILY_REQUESTS[id] !== undefined) limits[id] = Infinity
    else limits[id] = BOOSTED_ALLOWANCE_USD[id] ?? allowanceUsd
  }
  return limits
}

export const LIMITS = { goat: limitsFor() }

/** Command Code bills a peak rate on weekday hours for part of the DeepSeek
 *  family only: the catalogue price is the off-peak rate (17 h/day) and peak
 *  doubles it. Windows are 01–04 and 06–10 UTC, Monday through Friday — 09:00–
 *  12:00 and 14:00–18:00 in Beijing. `deepseek-v4-flash-fast` and the
 *  `ultrafast` tier carry no peak note on the pricing page, so they stay flat. */
export const PEAK = {
  factor: 2,
  utcWeekdayHours: [[1, 4], [6, 10]],
  modelIds: [
    'deepseek/deepseek-v4-flash',
    'deepseek/deepseek-v4-flash-vision-exp',
    'deepseek/deepseek-v4-pro',
    'deepseek/deepseek-v4.1-flash',
    'deepseek/deepseek-v4.1-flash-fast',
  ],
}

/** 1 at the off-peak rate, `PEAK.factor` inside a weekday peak window. */
export function peakFactor(modelId, at = Date.now()) {
  if (!PEAK.modelIds.includes(modelId)) return 1
  const when = new Date(at)
  const day = when.getUTCDay()
  if (day === 0 || day === 6) return 1
  const hour = when.getUTCHours()
  return PEAK.utcWeekdayHours.some(([from, to]) => hour >= from && hour < to) ? PEAK.factor : 1
}

const clampPercent = (used, cap) => {
  if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) return 0
  return Math.max(0, Math.min(1000, (used / cap) * 100))
}

const isoOf = (epochMs) => (Number.isFinite(epochMs) && epochMs > 0 ? new Date(epochMs).toISOString() : undefined)

/** One billing window in the OpenCode shape the dashboard and router read. */
function windowOf(raw, usedOverride, resetOverride) {
  const used = Number.isFinite(usedOverride) ? usedOverride : Number(raw?.used ?? 0)
  const cap = Number(raw?.cap ?? 0)
  const exceeded = raw?.exceeded === true || (cap > 0 && used >= cap)
  return {
    status: exceeded ? 'exhausted' : 'ok',
    percent: Math.round(clampPercent(used, cap) * 10) / 10,
    used: Math.round(used * 100) / 100,
    cap,
    resetsAt: isoOf(resetOverride ?? Number(raw?.resetAt)),
    ...(raw?.limited === false ? { limited: false } : {}),
  }
}

/**
 * Turn the two Command Code answers into OpenCode's usage block.
 *
 * The monthly window is the plan-wide credit bucket: `monthlyCredits` is what is
 * left, so spending is `allowance - monthlyCredits`. The allowance itself is read
 * off the published cap ratios (five-hour = 20%, weekly = 50%) rather than
 * assumed, so a plan change needs no release.
 */
export function toUsageBlock(credits, subscription) {
  const windows = credits?.windowLimits ?? {}
  const fiveHourCap = Number(windows.fiveHour?.cap ?? 0)
  const weeklyCap = Number(windows.weekly?.cap ?? 0)
  const allowance = weeklyCap > 0
    ? weeklyCap / WEEKLY_SHARE
    : fiveHourCap > 0
      ? fiveHourCap / FIVE_HOUR_SHARE
      : DEFAULT_ALLOWANCE_USD
  const remaining = Number(credits?.credits?.monthlyCredits ?? NaN)
  const monthlyUsed = Number.isFinite(remaining) ? Math.max(0, allowance - remaining) : Number(windows.weekly?.used ?? 0)
  const periodEnd = Date.parse(subscription?.currentPeriodEnd ?? '')
  return {
    rolling: windowOf(windows.fiveHour),
    weekly: windowOf(windows.weekly),
    monthly: windowOf({ cap: allowance, exceeded: monthlyUsed >= allowance }, monthlyUsed, periodEnd),
    plan: subscription?.planId,
    remainingUsd: Number.isFinite(remaining) ? Math.round(remaining * 100) / 100 : undefined,
    allowanceUsd: Math.round(allowance * 100) / 100,
    purchasedUsd: Number(credits?.credits?.purchasedCredits ?? 0),
    freeUsd: Number(credits?.credits?.freeCredits ?? 0),
    belowThreshold: credits?.credits?.belowThreshold === true,
    periodEnd: isoOf(periodEnd),
  }
}

/** GET one Command Code JSON endpoint with the account's bearer key. */
async function getJson(url, key, timeoutMs) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  return { ok: response.ok, status: response.status, body, text }
}

/**
 * The probe both the dashboard and the router run.
 *
 * Returns `{usage, error, status}`: `usage` is the OpenCode-shaped block, `error`
 * is a one-line reason (also carrying the HTTP status so the router can apply its
 * auth cooldown), and an unreachable endpoint yields error text rather than a
 * throw so a probe never takes the caller down.
 */
export async function fetchUsage(key, options = {}) {
  const baseUrl = typeof options.baseUrl === 'string' && options.baseUrl.length > 0 ? options.baseUrl : BASE_URL
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000
  let credits
  try {
    credits = await getJson(`${baseUrl}${CREDITS_PATH}`, key, timeoutMs)
  } catch (error) {
    return { usage: null, error: `credits endpoint unreachable: ${String(error?.message ?? error)}`, status: 0 }
  }
  if (!credits.ok) {
    return { usage: null, error: `credits endpoint answered ${credits.status}`, status: credits.status }
  }
  let subscription
  try {
    subscription = await getJson(`${baseUrl}${SUBSCRIPTIONS_PATH}`, key, timeoutMs)
  } catch {
    subscription = { ok: false, status: 0 }
  }
  const plan = subscription?.ok === true
    ? (Array.isArray(subscription.body?.data) ? subscription.body.data[0] : subscription.body?.data)
    : undefined
  return { usage: toUsageBlock(credits.body, plan), error: null, status: 200 }
}

/** The catalogue endpoint publishes id/context/endpoints only — no modalities and
 *  no effort ladder — so the provider declaration stays the source of truth for
 *  those. This set only keeps the dashboard's "thinking" tag honest: it is the
 *  list probed to return `reasoning_content` on a live request. */
const REASONING_MODELS = new Set([
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4.1-flash',
  'deepseek/deepseek-v4.1-flash-fast',
  'deepseek/deepseek-v4.1-flash-ultrafast',
  'inclusionai/ling-3.1-flash',
  'meituan/LongCat-2.0',
  'minimax/minimax-m3.1-flash',
  'moonshotai/Kimi-K2.7-Code',
  'moonshotai/Kimi-K3',
  'moonshotai/Kimi-K3.1-Pro',
  'ornith/ornith-1.5-122b',
  'Qwen/Qwen3.7-Max',
  'Qwen/Qwen3.7-Plus',
  'Qwen/Qwen3.8-Max',
  'tencent/hy4-preview',
  'zai-org/GLM-5.2',
  'zai-org/GLM-5.3',
])

/** The model catalogue endpoint, mapped to the row shape the dashboard renders. */
export async function fetchCatalog(key, options = {}) {
  const baseUrl = typeof options.baseUrl === 'string' && options.baseUrl.length > 0 ? options.baseUrl : BASE_URL
  try {
    const response = await fetch(`${baseUrl}/provider/v1/models`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return { models: [], error: `model endpoint answered ${response.status}` }
    const body = await response.json()
    const models = (Array.isArray(body?.data) ? body.data : [])
      .filter((entry) => typeof entry?.id === 'string')
      .map((entry) => {
        const price = PRICES[entry.id]
        const modalities = Array.isArray(entry.inputModalities) ? entry.inputModalities : []
        const endpoints = Array.isArray(entry.supported_endpoints) ? entry.supported_endpoints : []
        const efforts = Array.isArray(entry.reasoningEfforts) ? entry.reasoningEfforts : []
        const inputs = modalities.filter((kind) => ['text', 'image', 'video', 'audio', 'file'].includes(kind))
        return {
          id: entry.id,
          name: typeof entry.name === 'string' ? entry.name : entry.id,
          // Every catalogue model takes text; the endpoint never says otherwise.
          inputs: inputs.length > 0 ? inputs : ['text'],
          // Any served endpoint means the model is callable; which protocol it
          // speaks is the provider config's business, not the table's.
          tools: endpoints.length > 0,
          reasoning: efforts.length > 0 || REASONING_MODELS.has(entry.id),
          efforts,
          context: typeof entry.context_length === 'number' ? entry.context_length : undefined,
          output: typeof entry.max_output_tokens === 'number' ? entry.max_output_tokens : undefined,
          free: price !== undefined && price.input === 0 && price.output === 0,
        }
      })
    return { models, error: null }
  } catch (error) {
    return { models: [], error: String(error?.message ?? error) }
  }
}
