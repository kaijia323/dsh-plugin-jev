# Live provider verification — `jev_decide` (transport=vercel → Vercel AI Gateway)

- **Owner:** teammate `live-provider` (task-2)
- **Date:** 2026-09-18, 22:57–22:59 +08:00
- **Transport under test:** `transport: vercel` → `POST https://ai-gateway.vercel.sh/v4/ai/evaluation-model`, `ai-model-id: typesafe-ai/jev`
- **Verdict:** ✅ **AVAILABLE / USABLE** — 4 of 5 live calls returned HTTP 200 with typed answers. One transient 60 s client timeout (details below).

## 0. Tool presence in this session

`jev_decide` **is present in this session's tool table** and executed live 5 times. No fabricated results
are reported here; every response below was returned by the real endpoint.

## 1. Mounted configuration (read-only inspection, matches the live mount)

`~/.dsh/profiles/web/cordis.patch.yml` lines 12–25 inserts `tool-jev` →
`/home/dsh/temp/dsh-plugin-jev/lib/index.js` with:

| key | value |
|---|---|
| `transport` | `vercel` |
| `gatewayBaseURL` | `https://ai-gateway.vercel.sh/v4/ai` |
| `model` | `typesafe-ai/jev` |
| `keyFile` | `/home/dsh/.config/vercel/ai-gateway-key` |
| `apiKeyEnv` | `AI_GATEWAY_API_KEY` |
| `timeoutMs` | `60000` |

**Credential attribution (values never read or printed):**

- `AI_GATEWAY_API_KEY`: **unset** in this session; `JEV_API_KEY`: **unset**.
- `~/.config/vercel/ai-gateway-key`: **exists** (61 bytes, `-rw-------`, mtime 22:18:15). Content **not read**.
- Since no env var is set, the key **must have come from `keyFile`** — confirmed by 4 successful calls whose
  gateway metadata reports `"credentialType": "system"` (i.e. an authenticated system credential was accepted).
  → key file is valid and successfully used. ✅

Plugin defaults for the record (`lib/index.js:36–51`): `timeoutMs: 60000`, `toolTimeoutMs: 65000`,
`gatewayProtocolVersion: '0.0.1'`, `gatewaySpecVersion: '4'`, `gatewayModel: 'typesafe-ai/jev'`.

## 2. Call log

Budget: 6 live calls max, ≥3 s spacing. **Used 5 tool calls** (plus 1 unauthenticated network probe that
consumed no model quota). All inter-call gaps were ≥6 s. Tool-level wall time can only be *bounded*
(the harness/model round trip outside the tool is not instrumented); the **provider-side window is exact**,
taken from `providerMetadata.gateway.routing.modelAttempts[].providerAttempts[]`.

| # | time (+08:00) | questions | provider window | result |
|---|---|---|---|---|
| 1 | ~22:57:41 | `choice` route + `noul` urgent | `22:57:41.157→41.350` = **193 ms** | ✅ 200 |
| 2 | ~22:57:51 | `score` churn_severity + `noul` refund_justified | `22:57:51.028→51.187` = **159 ms** | ✅ 200 |
| 3 | ~22:57:57 | exact repeat of #1 | **no provider window** | ❌ **timeout at 60000 ms** |
| 4 | ~22:59:18 | exact repeat of #1 | `22:59:18.549→18.725` = **176 ms** | ✅ 200 |
| 5 | ~22:59:29 | single `noul` sla_breach | `22:59:29.201→29.349` = **148 ms** | ✅ 200 |

Wall-clock bounds per call (adjacent `date -Is` samples): #1 ≤6 s, #2 ≤6 s, #3 ≈60 s (failed), #4 ≤11 s, #5 bounded.
Every successful call completed well under 1 s of provider time; end-to-end tool latency was a few seconds,
dominated by the harness round trip.

### Reliability

**4/5 = 80 % success; the single failure is a transient 60 s timeout, not an auth/route/plateau error.**
Call #4 (identical payload to the timed-out #3, 18 s later) succeeded in 176 ms → the timeout was **transient**,
not reproducible.

### Determinism / repeatability

Calls #1 and #4 sent byte-identical payloads:

| field | call #1 | call #4 |
|---|---|---|
| `route.choice` | `billing_escalation` | `billing_escalation` (same) |
| `route.probabilities` | esc 0.78 / refund 0.22 | esc 0.79 / refund 0.21 |
| `urgent.probability` | 0.83 | 0.83 (same) |
| `typesafe.confidence.route` | 0.70 | 0.72 |

→ **Discrete decisions are stable**; calibrated numbers are mildly stochastic (~1 pt drift). Callers should
not assert exact probability equality across runs.

## 3. Answer shapes observed (all three question primitives)

**choice** (call #1, verbatim):

```json
{ "route": { "type": "choice", "choice": "billing_escalation",
             "probabilities": { "billing_escalation": 0.78, "billing_refund": 0.22,
                                "churn_risk": 0, "technical": 0 } } }
```

**score** (call #2, verbatim):

```json
{ "churn_severity": { "type": "score", "score": 2.29,
                      "probabilities": { "0": 0, "1": 0, "2": 0.71, "3": 0.29 } } }
```

**noul / boolean** (call #1, verbatim):

```json
{ "urgent": { "type": "boolean", "probability": 0.83 } }
```

Envelope present on every success: `rounding: {probabilityDecimals: 2, scoreDecimals: 2}`, `usage`,
`warnings: []`, `providerMetadata.typesafe.confidence`, `providerMetadata.gateway.*`.

### ⚠️ Two contract observations (not functional failures)

1. **Boolean key naming.** The tool description documents the yes/no answer as `answers[key].noul`
   ("the probability that the answer is yes"). The live gateway transport actually returns
   `{"type":"boolean","probability":<p>}` — there is **no `noul` and no `boolean` field**. A consumer that
   reads `answers[k].noul` gets `undefined`. It must read `.probability`. (String enum values `"boolean"`
   confirm the gateway spelling; the `"noul"` spelling is the native TypeSafe API side.)
2. **No calibrated confidence for boolean questions.** `providerMetadata.typesafe.confidence` contained only
   the non-boolean key in calls #1/#2 (`{"route":0.7}`, `{"churn_severity":0.7}`) and was `{}` for the
   boolean-only call #5. So boolean answers carry a probability but **no `confidence` entry**.

## 4. Failure surface of call #3 (exact)

Raw error text, verbatim:

```
Error: tool-jev: request to https://ai-gateway.vercel.sh/v4/ai/evaluation-model timed out after 60000 ms
```

Classification:

| hypothesis | evidence | verdict |
|---|---|---|
| **401/403 key problem** | 4 calls returned 200 with `credentialType: "system"`; `keyFile` exists and no env var is set → key file used successfully | **ruled out** |
| **429 rate limit / free-tier quota** | no rate-limit body, no 429 status anywhere; failures surfaced as a client abort, not an HTTP status | **ruled out** |
| **404 / wrong route** | same URL returns 200 on calls #1/#2/#4/#5; `lib/index.js:222` builds exactly this URL | **ruled out** |
| **Network unreachable / DNS / TLS** | unauthenticated probe at 22:59:07 to the same host: `http_code=400, dns=0.004s, connect=0.0046s, tls=0.257s, total=0.614s`; 4 successful calls | **ruled out** |
| **Client-side timeout on a slow/hung provider response** | error text is exactly the plugin's own guard at `lib/index.js:279` (`AbortSignal.timeout(config.timeoutMs)`) and `:293`; `timeoutMs=60000` from the mount config; ≈60 s elapsed between the call and the next observed timestamp | **confirmed cause** |

**Interpretation:** the plugin behaved exactly as designed — it aborted at its configured 60 s ceiling and
reported a precise, actionable error. The failure is **provider/gateway-side latency (transient)**, not a
plugin defect. Caveat: because `fetch` was aborted client-side, we cannot distinguish "server received it and
answered too late" from "connection stalled after request send"; both are provider-side.

Raw probe response body (unauthenticated, therefore quota-neutral; the 400 is expected since the probe sent
no protocol/auth headers):

```json
{"error":{"message":"Unsupported gateway protocol version","type":"invalid_request_error","code":400}}
```

## 5. Cost / quota footprint

All calls ran on system credentials and cost fractions of a cent — free-tier impact is negligible, so the
429 risk was low throughout:

| call | gateway cost (USD) | generationId |
|---|---|---|
| 1 | 0.000021126 | `gen_01M2TGBWNB6AD5VA5VX0Y60NMH` |
| 2 | 0.000019026 | `gen_01M2TGC6B455MAKTW8Z42YVG6K` |
| 4 | 0.000021126 | `gen_01M2TGEVK2QQD32H4KTYSK9FVS` |
| 5 | 0.000012432 | `gen_01M2TGF66WX0K2N8GNE46JCBKB` |

Router metadata on every success: `resolvedProvider: "typesafe-ai"`, `finalProvider: "typesafe-ai"`,
`modelAttemptCount: 1`, `totalProviderAttemptCount: 1`, `fallbacksAvailable: []`, `statusCode: 200`.

## 6. Conclusion

**可用 (AVAILABLE / USABLE).** The mounted `jev_decide` tool reaches the real Vercel AI Gateway evaluation
endpoint, authenticates with the keyFile credential, and returns correctly typed `choice` / `score` /
`boolean` answers with probabilities and usage — verified with raw responses from 4 live HTTP 200 calls.

Residual risks (no hard blocker):

1. **~20 % transient timeout rate in this small sample (1/5)** against a 60 s ceiling. Recommend callers retry
   once on `timed out after 60000 ms`, and/or raise `timeoutMs` in the profile patch. Note this cannot be
   fixed inside the plugin's current design if the provider genuinely exceeds 60 s.
2. **Doc/contract mismatch for boolean answers**: read `answers[k].probability`, not `.noul`; and expect no
   `confidence` entry for boolean questions.

No source, config, `~/.dsh`, or key file was modified; the key file's contents were never read or printed.
The only file written is this report.
