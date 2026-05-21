# Security Considerations

This document covers security and abuse considerations for implementers of the UCP-LTO Extension. The intended audience is engineers building either a discovery endpoint (merchant side) or an agent consumer (client side).

The extension exposes promotional offer data publicly by design. The threats are therefore not centered on confidentiality but on data quality, anti-manipulation, anti-abuse, and consumer protection compliance.

---

## 1. Stock semantics — offer-allocated, not inventory

**Threat:** A naive implementation could expose underlying merchant inventory counts via `stock_remaining`, leaking competitive intelligence to competitors who scrape the public feed.

**Requirement (MUST):** `stock_remaining` MUST refer to units the merchant has allocated to *this specific offer*, not their total inventory. A merchant running a "10-unit flash sale" reports `stock_remaining: 10` regardless of whether their warehouse holds 10 or 10,000 units of the product.

**Implementer guidance:**

- If your data model stores both "offer allocation" and "inventory", expose only the former
- For evergreen offers without a fixed cap, set `stock_capped: false` and either omit `stock_remaining` or set it to `null`
- For merchants who want extra discretion even within the offer-allocated semantics, the spec permits bucketing (e.g., emitting `stock_remaining: 10` when the actual count is between 6 and 10). Bucketing rules SHOULD be consistent across responses to avoid ranking instability

**Cross-reference:** the `stock_remaining` field description in `schema/lto-extension.schema.json` carries this requirement verbatim.

---

## 2. Anti-manipulation — fake urgency and inflated discounts

**Threat:** A bad-faith merchant could publish offers with manufactured urgency (`valid_until: now + 1h` for evergreen items), permanent "scarcity" (`stock_remaining: 1` that resets), or inflated `original_price` to make `sale_price` look like a steeper discount than it is.

**Requirement (MUST for EU-shipping merchants):** Merchants who ship to EU member states MUST populate `pangv_reference_price` with the 30-day-lowest-price reference as defined in PAngV §11 and the Omnibus Directive 2019/2161. This grounds the displayed discount in legally verifiable history.

**Recommendations beyond EU:**

- Agents SHOULD compare `pangv_reference_price.amount` against `sale_price` rather than `original_price` when computing displayed savings
- Implementations SHOULD reject responses where `sale_price > original_price` as malformed
- Implementations SHOULD apply consistency checks: an offer with `urgency_flags.ending_within_hours: 0` SHOULD have `valid_until` in the past
- Aggregators that surface offers across merchants SHOULD downrank or quarantine merchants who consistently emit suspicious patterns (e.g., always `stock_remaining: 1`)

**Compliance disclaimer:** This specification defines the *shape* of compliance fields. Adherence to PAngV, Omnibus, CCPA, UK CRA, or any other consumer protection law remains the merchant's legal responsibility. The spec does not certify, endorse, or audit any merchant.

---

## 3. Trust signal — `merchant_verified` must not be self-asserted

**Threat:** A merchant publishing their own feed could set `merchant_verified: true` to inflate their trust ranking with consumer agents.

**Requirement (MUST):** The `merchant_verified` boolean MUST be set by the registry or protocol authority, never self-asserted by the merchant. Discovery endpoints that aggregate offers across merchants (Pattern 2 query APIs, Pattern 3 MCP servers) MUST validate this field against an authoritative source before returning offers.

**Acceptable authoritative sources:**

- The Official MCP Registry merchant verification status
- The UCP integrator registry (when available)
- A DNS-based proof of merchant control (TXT record similar to the MCP Registry's DNS auth pattern)
- A trusted aggregator's manual or automated verification process (e.g., Heartly's OAuth-verified Shopify/WooCommerce merchant set)

**Implementer guidance for the v0.1 phase:** Until a federated trust authority emerges, implementations SHOULD treat `merchant_verified` as a *boolean indicator from a single aggregator*, not a global truth claim. Document your verification process in your discovery endpoint's `/.well-known/ucp-manifest.json` or in publicly accessible docs.

---

## 4. Rate limiting — protect public endpoints from abuse

**Threat:** Public discovery endpoints (Patterns 1, 2, 3) are unauthenticated by design. Without rate limiting, they become free DoS targets and inflate origin bandwidth costs.

**Requirements (MUST):**

- Discovery endpoints MUST implement rate limiting
- Recommended minimum: 60 requests per minute per IP
- Patterns 1 and 2 MUST implement `ETag` and `Last-Modified` response headers and honor `If-None-Match` / `If-Modified-Since` request headers — this turns repeated polls into cheap `304 Not Modified` responses
- Pattern 3 MCP servers MUST implement transport-level rate limiting

**Recommendations:**

- Use sliding-window rate limit algorithms (e.g., Upstash, Redis-backed)
- Return `429 Too Many Requests` with a `Retry-After` header when limited
- Surface `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers so well-behaved agents can self-throttle

---

## 5. DNS rebinding protection (HTTP-based discovery)

**Threat:** A malicious page in a developer's browser could trick the browser into POSTing to a localhost LTO endpoint once a developer is running the server in development, then exfiltrate offer data via the agent's session cookie.

**Requirement (MUST for Pattern 3 MCP servers):** MCP servers exposing LTO tools MUST implement Host header validation in production. Only requests whose `Host` header matches an allowlist of expected hostnames SHOULD be served.

**Implementer guidance:**

- The `@modelcontextprotocol/sdk` `WebStandardStreamableHTTPServerTransport` supports `enableDnsRebindingProtection: true` and `allowedHosts: []` options
- In development (`NODE_ENV !== 'production'`), Host validation MAY be disabled for ergonomic local testing
- Patterns 1 and 2 are less exposed because they do not use stateful sessions; they are out of scope for this requirement but SHOULD validate Host headers as defense in depth

---

## 6. Authentication is intentionally absent — but rate-limit by default

The spec does not include authentication. Offer data is public commerce information, and authentication would inhibit AI agent discovery (which is the entire point).

**Implementer guidance:**

- If your business model requires authenticated access, implement a separate authenticated endpoint at a different URL — do not break the public LTO Extension contract
- Public endpoints MUST be rate-limited (see §4)
- Use observable structured logging (per-request: tool name, agent user-agent, filter values, returned count) to detect abuse patterns

---

## 7. CORS — open by default

Patterns 1 and 2 SHOULD set `Access-Control-Allow-Origin: *` because LTO data is intentionally public. Agents may run in browser contexts (custom GPTs, in-page assistants) and need CORS access.

Pattern 3 (MCP) does not depend on browser CORS in the same way; the SDK transport handles cross-origin concerns at the protocol level.

---

## 8. Audit trail — log who queried what

**Recommendation:** Implementers SHOULD log discovery queries with at minimum:

- Timestamp
- Tool / endpoint invoked
- Filters applied
- Returned offer count
- Requester user-agent (capped at 200 chars to prevent log inflation)
- Requester IP or anonymized hash thereof

This serves two purposes:

1. Abuse detection (sudden spikes from a single IP, unusual filter patterns)
2. AI agent attribution metrics (which agents are querying, at what rate) — feeding KPI dashboards similar to the one Heartly maintains for `mcp.heartly.io` query analytics

Per-request structured logging SHOULD NOT capture personally identifiable information about end consumers; the LTO Extension carries no consumer data.

---

## 9. Brand safety and disclaimer

**Risk:** A merchant adopts the LTO Extension, misuses it (fake countdowns, dark patterns, misleading reference prices), and the resulting consumer-protection violation gets attributed to "the spec" rather than the merchant.

**Mitigation:**

- The spec describes data *shape*, not compliance with any specific jurisdiction's consumer protection law
- Adherence to PAngV, Omnibus, CCPA, UK CRA, etc. is the merchant's legal responsibility — see §2
- Aggregators (registries, AI agent platforms) SHOULD reserve the right to delist merchants who repeatedly emit misleading or non-compliant offers
- The reference implementation (Heartly) applies its own quality gates: tenants must be active, unsuspended, non-development-store, non-password-protected, non-feed-frozen, and have valid platform credentials before offers surface

---

## 10. Forward compatibility — version field

The `spec_version` field in `LtoOfferFeed` responses (and the `version` field in the manifest) lets implementations evolve without breaking consumers. Agents MUST check the spec version when consuming offers and SHOULD downgrade gracefully when encountering newer versions (extract what they understand, ignore what they do not).

The spec authors commit to backward-compatible additions in v0.x releases. Breaking changes are reserved for v1.0+ and will be announced via the CHANGELOG with at least 90 days of overlap with the previous version.

---

## Summary

| Area | Severity | Mitigation in spec |
|---|---|---|
| Inventory leak via `stock_remaining` | Medium | Offer-allocated semantics MUST, not inventory |
| Fake urgency / inflated discount | Medium-High (EU regulatory) | `pangv_reference_price` MUST for EU shipping |
| Self-asserted `merchant_verified` | Medium | Field MUST be set by registry, not merchant |
| DoS on public endpoints | Medium | Rate limit MUST + ETag MUST + conditional GET MUST |
| DNS rebinding on MCP | Low-Medium | Host allowlist MUST in production |
| Brand misuse / spec reputation | Low | Compliance disclaimer + delist mechanism |
| Forward compatibility breakage | Low | Version field MUST + graceful downgrade SHOULD |

No threats in this analysis are blockers for adoption. The spec ships with the necessary primitives and documented requirements to make every threat addressable.
