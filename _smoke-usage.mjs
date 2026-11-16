/**
 * Live smoke test for the Command Code adapter path: mount the real usage half
 * against the real key, hit its JSON endpoint, and print what the dashboard would
 * render. No DSH host needed — just the plugin's own context surface.
 */
import { apply as applyUsage } from './usage.js'
import { apply as applyRouter } from './router.js'

const key = process.env.CC_KEY
if (!key) throw new Error('CC_KEY is not set')

const isCcRef = (ref) => typeof ref === 'string' && ref.startsWith('COMMANDCODE_API_KEY')
const credentials = {
  async resolve(ref) {
    return isCcRef(ref) ? { value: key } : { value: undefined }
  },
  async get(ref) {
    return isCcRef(ref) ? { ok: true, value: { value: key } } : { ok: false, error: { code: 'MISSING_CREDENTIAL', message: ref } }
  },
  async reveal(ref) {
    return isCcRef(ref) ? { ok: true, value: key } : { ok: false, error: { code: 'MISSING_CREDENTIAL', message: ref } }
  },
}

const listeners = new Map()
const on = (event, listener) => {
  listeners.set(event, listener)
  return () => listeners.delete(event)
}
const effect = (fn) => {
  const dispose = fn()
  return typeof dispose === 'function' ? dispose : () => {}
}

let usageHandler
const routes = new Map()
applyUsage({
  logger: { info: () => {}, warn: () => {} },
  get: (name) => (name === 'credentials' ? credentials : undefined),
  on,
  effect,
  webServer: {
    register: ({ path: route, handler }) => {
      routes.set(route, handler)
      if (route === '/command-code-usage.json') usageHandler = handler
      return () => {}
    },
  },
}, {
  vendor: 'commandcode',
  path: '/command-code-usage',
  refreshSeconds: 0,
  sessionsRoot: '/tmp/cc-sessions-none',
  accountsStatePath: '/tmp/cc-accounts-none.json',
})

const call = async (query = '') => {
  const response = {
    status: 0,
    writeHead(status) {
      this.status = status
    },
    end(text) {
      this.resolve(JSON.parse(text))
    },
  }
  const done = new Promise((resolve) => {
    response.resolve = resolve
  })
  await usageHandler({ url: '/command-code-usage.json' + query, headers: {} }, response)
  return done
}

await new Promise((resolve) => setTimeout(resolve, 400))
console.log('registered usage routes:', [...routes.keys()].join(', '))
const d = await call('?refresh=1')
console.log('top-level keys:', Object.keys(d).join(','))
console.log('plan:', d.plan, '| configured:', d.configuredPlan, '| usage.plan:', d.usage?.plan)
console.log('usageError:', d.usageError ?? null, '| catalogError:', d.catalogError ?? null)
console.log('windows:', JSON.stringify({
  rolling: d.usage?.rolling,
  weekly: d.usage?.weekly,
  monthly: d.usage?.monthly,
}))
console.log('remainingUsd:', d.usage?.remainingUsd, '| allowanceUsd:', d.usage?.allowanceUsd)
console.log('clock:', d.clock, '| peak:', d.peak)
const rows = Array.isArray(d.models) ? d.models : []
console.log('models rows:', rows.length, '| named:', rows.filter((row) => row.name).length)
console.log('sample row:', JSON.stringify(rows[0]))
console.log('totals:', JSON.stringify(d.totals))

// The router half must produce the same window verdict from the same endpoint.
let routerHandler
applyRouter({
  logger: { info: () => {}, warn: () => {} },
  get: (name) => (name === 'credentials' ? credentials : undefined),
  on,
  effect,
  inject: (_deps, callback) => {
    callback({
      webServer: {
        register: ({ path: route, handler }) => {
          routerHandler = handler
          return () => {}
        },
      },
      effect,
    })
  },
  llm: { stream: async function* () {} },
}, {
  vendor: 'commandcode',
  path: '/command-code-quota-router',
  routes: [
    { primary: { provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash' }, fallback: { provider: 'deepseek-account', model: 'deepseek-flash' } },
  ],
  probeIntervalMs: 600000,
  statePath: process.env.ROUTER_STATE ?? '/tmp/cc-router-state.json',
})

await new Promise((resolve) => setTimeout(resolve, 2500))
const s = await new Promise((resolve) => {
  const response = {
    status: 0,
    writeHead(status) {
      this.status = status
    },
    end(text) {
      resolve(JSON.parse(text))
    },
  }
  routerHandler({ url: '/command-code-quota-router.json', headers: {} }, response)
})
console.log('router mode:', s.mode, '| reason:', s.reason)
console.log('router account:', JSON.stringify(s.accounts?.[0]))
console.log('router upstream usage:', JSON.stringify(s.upstream?.usage ?? null), '| net:', s.net?.class)
console.log('router official supported:', s.official?.supported, '| url:', s.official?.url)
