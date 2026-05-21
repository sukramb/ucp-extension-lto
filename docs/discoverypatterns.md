# Discovery Patterns

The UCP-LTO Extension specifies three discovery patterns. A merchant MAY implement one, two, or all three. Each pattern serves a different consumer profile:

- **Pattern 1: Static well-known feed** — simplest, cacheable, ideal for batch crawlers and AEO indexing
- **Pattern 2: Live query API** — middle ground, supports filtering, ideal for custom integrations
- **Pattern 3: MCP server** — agent-native, supports tool discovery and capability negotiation, ideal for Claude Desktop / ChatGPT / Cursor / Perplexity

A merchant signals which patterns they support via the [Merchant Manifest](#merchant-manifest) section at the bottom of this document.

---

## Pattern 1 — Static well-known feed

The simplest pattern. A merchant publishes a JSON file at a well-known URL that contains all currently active offers.

### URL convention

```
GET https://merchant.example.com/.well-known/ucp-lto-offers.json
```

The path `/.well-known/ucp-lto-offers.json` is reserved by this specification. Implementations MUST host their feed at this path; merchants who cannot host a file at apex `.well-known` SHOULD use Pattern 2 instead.

### Response shape

The response body is a `LtoOfferFeed` object (defined in `schema/lto-extension.ts`):

```json
{
  "offers": [
    { "offer_id": "...", "merchant_id": "...", "valid_from": "...", "valid_until": "...", ... },
    { "offer_id": "...", "merchant_id": "...", "valid_from": "...", "valid_until": "...", ... }
  ],
  "count": 2,
  "generated_at": "2026-05-21T08:30:00Z",
  "spec_version": "0.1"
}
```

The `offers` array SHOULD be sorted by `valid_until` ascending (ending soonest first). Implementations MUST NOT include expired offers (where `valid_until` is in the past).

### Response headers (required)

To support efficient agent polling and CDN caching:

- `Content-Type: application/json; charset=utf-8`
- `ETag: "<strong-etag>"` — strong ETag derived from feed content
- `Last-Modified: <RFC 7231 date>` — when the feed was last regenerated
- `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=300`
- `Access-Control-Allow-Origin: *` — CORS open by default (the feed is public data)

### Conditional GET support (required)

Implementations MUST honor `If-None-Match` and `If-Modified-Since` request headers, returning `304 Not Modified` when content has not changed. This is non-negotiable: without conditional GET, agents polling at recommended cadences will overwhelm the origin.

### Polling cadence

Agents SHOULD poll no more frequently than every 5 minutes. Servers SHOULD set `max-age=60` to allow agents to amortize bursts via local cache.

### Reference implementation

[`https://deals.heartly.io/api/deals`](https://deals.heartly.io/api/deals) — Heartly's production deal feed implements pattern 1, with strong ETag, RFC 7232 conditional GET fast paths, and a single-pass allowlisted DTO mapper for credential safety. Source for the implementation pattern is available in the Heartly repository.

---

## Pattern 2 — Live query API

A more flexible pattern for merchants who want to expose runtime filtering. Same response shape as pattern 1, but with query parameter support.

### URL convention

```
GET https://merchant.example.com/api/lto/offers?country=DE&category=fashion&min_discount_pct=20&ending_within_hours=24
```

The path `/api/lto/offers` is recommended but not strictly required (the merchant manifest carries the explicit URL).

### Filter parameters (all optional)

| Parameter | Type | Description |
|---|---|---|
| `country` | ISO 3166-1 alpha-2 | Filter to merchants who ship to this country. Single value only. |
| `category` | string | Filter to top-level category. Case-insensitive match. |
| `min_discount_pct` | integer 0-100 | Only return offers with `discount_pct >= this value`. |
| `ending_within_hours` | integer 1-720 | Only return offers ending within this many hours from server time. |

Filter parameters are combinable. When multiple filters are specified, they are combined with AND semantics.

### Response shape

Identical to pattern 1: `LtoOfferFeed` JSON object.

### Pagination (optional)

For implementations with large offer catalogs (>500 active offers), pagination MAY be added via standard cursor parameters:

- Request: `?cursor=<opaque-token>&limit=100`
- Response: include `next_cursor` field at the top level of the feed

Pagination is OPTIONAL in v0.1 of this spec; implementations without pagination MUST return all matching offers in a single response.

### Reference implementation

The same Heartly endpoint at [`https://deals.heartly.io/api/deals`](https://deals.heartly.io/api/deals) doubles as a query API — filters are exposed via query params and applied server-side.

---

## Pattern 3 — MCP server

The agent-native pattern. The merchant runs a Model Context Protocol server that exposes the LTO Extension as standardized tools. AI agents (Claude Desktop, ChatGPT custom GPTs, Cursor, Perplexity) can discover and invoke these tools without custom integration code.

### Required tools

An LTO-compliant MCP server MUST expose three read-only tools:

#### `list_active_offers`

Lists currently active offers. All four standard filters are supported as tool arguments:

```typescript
{
  country?: string,           // ISO 3166-1 alpha-2
  category?: string,
  min_discount_pct?: number,  // 0-100
  ending_within_hours?: number,
}
```

Returns: array of `LtoOffer` objects, sorted by `valid_until` ascending.

#### `search_offers_by_category`

Same as `list_active_offers` but with `category` as a required argument. Lets agents express "find offers in fashion" more naturally.

```typescript
{
  category: string,           // required
  country?: string,
  min_discount_pct?: number,
  ending_within_hours?: number,
}
```

#### `get_offer_by_id`

Look up a single offer by its `offer_id`.

```typescript
{
  id: string,
}
```

Returns: a single `LtoOffer` object, or an error if the offer does not exist or has expired.

### Transport

The MCP server MUST use Streamable HTTP transport (the modern remote transport spec from Anthropic's MCP). Stateless mode is recommended for public servers.

### Security

MCP servers exposing LTO offers SHOULD implement:

- Rate limiting (60 req/min/IP recommended minimum)
- DNS rebinding protection (Host header allowlist)
- ETag/Last-Modified headers on JSON responses
- No authentication required (the data is public)
- Credentials MUST NOT enter tool responses — implementations MUST use an allowlisted DTO mapper

### Registry listing (recommended)

Implementations SHOULD list their MCP server in the [Official MCP Registry](https://registry.modelcontextprotocol.io) using DNS-based authentication for the merchant's domain. This makes the server discoverable to MCP clients that browse the registry for relevant tools.

### Reference implementation

[`https://mcp.heartly.io/`](https://mcp.heartly.io/) — Heartly's production MCP server implements all three tools. Listed in the Official MCP Registry under `io.heartly/deals`. Public documentation at [`heartly.io/developers/mcp`](https://www.heartly.io/developers/mcp).

---

## Merchant Manifest

A merchant declares LTO support by extending their existing UCP manifest at `/.well-known/ucp-manifest.json`:

```json
{
  "ucp_version": "2026-01",
  "merchant": {
    "id": "merchant.example.com",
    "name": "Merchant Example"
  },
  "extensions": {
    "lto": {
      "version": "0.1",
      "feed_url": "https://merchant.example.com/.well-known/ucp-lto-offers.json",
      "supports_realtime": true,
      "supports_mcp": "https://mcp.merchant.example.com/"
    }
  }
}
```

### Field requirements

At least one of `feed_url`, `supports_realtime`, or `supports_mcp` MUST be present. The combinations signal:

| Combination | Patterns supported |
|---|---|
| `feed_url` only | Pattern 1 only |
| `supports_realtime: true` only | Pattern 2 only (live query URL inferred from convention) |
| `supports_mcp` only | Pattern 3 only |
| Multiple | All declared patterns supported |

Merchants who support multiple patterns SHOULD prefer pattern 3 (MCP) for AI agent consumers, with pattern 1 (well-known feed) as a fallback for crawlers and indexing services.

---

## Discovery flow for an AI agent

A typical agent discovery flow:

1. Agent receives a user query: *"Find me fashion deals ending soon in Germany."*
2. Agent has a directory of LTO-compliant merchants (from the Official MCP Registry, from `agentic.json` aggregators, or from prior cached manifests)
3. For each candidate merchant:
   - Agent reads `/.well-known/ucp-manifest.json` (cached, refresh weekly)
   - Agent checks `extensions.lto.supports_mcp` → if present, calls `list_active_offers({ country: "DE", category: "fashion", ending_within_hours: 24 })`
   - Otherwise, agent falls back to the static feed at `extensions.lto.feed_url`
4. Agent aggregates offers across merchants, applies its own ranking (using `urgency_flags`, `discount_pct`, `merchant_verified`), and surfaces the top results to the user

The spec does not mandate aggregation logic — that is the agent's responsibility. The spec only ensures that the underlying data has the right shape for any reasonable aggregator to consume.
