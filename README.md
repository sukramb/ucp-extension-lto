# UCP-LTO Extension

> A proposed extension to the [Universal Commerce Protocol (UCP)](https://ucp.dev) for time-bounded promotional offers.
> Authored by [Heartly](https://www.heartly.io) as a public RFC. Open to community contribution.

**Status:** Draft v0.1 · Published 2026-05-21 · Comments welcome

---

## The gap this fills

UCP's `Discount Extension` (`dev.ucp.shopping.discount`, spec dated 2026-01-11) standardizes how merchant discount codes are applied at checkout when an AI agent triggers a purchase. It does not standardize **time-bounded promotional discovery**.

Concretely, the UCP `Discount` object specifies `code`, `amount`, `amount_type`, and `description`. It does not specify:

- `valid_until` — when the offer ends, so the agent can prioritize urgency
- `stock_remaining` — units allocated to this offer, so the agent can communicate scarcity
- `campaign_type` — flash sale, daily deal, carousel, autopilot, evergreen
- `merchant_verified` — whether the merchant has a valid integrator connection

Without these primitives, AI agents using UCP today cannot answer queries like *"what flash sales end in the next two hours"* or *"show me deals with at least 30 percent off this weekend."* The agent can find products, get prices, and trigger a purchase. The agent cannot rank by urgency, because the protocol does not carry urgency information.

The UCP-LTO Extension adds these primitives.

## Elevator example

```json
{
  "offer_id": "f4e3a2c1-shopify-klostergin-monastic-gin",
  "merchant_id": "klostergin.com",
  "product_id": "monastic-dry-gin-10x0-04l",
  "product_url": "https://klostergin.com/products/monastic-dry-gin",
  "valid_from": "2026-05-20T19:00:00Z",
  "valid_until": "2026-05-21T19:00:00Z",
  "original_price": 39.90,
  "sale_price": 29.90,
  "currency": "EUR",
  "discount_pct": 25,
  "stock_remaining": 7,
  "stock_capped": true,
  "campaign_type": "standard_flash_sale",
  "urgency_flags": {
    "ending_within_hours": 12,
    "stock_critical": false,
    "last_chance": false
  },
  "merchant_verified": true,
  "pangv_reference_price": {
    "amount": 39.90,
    "valid_since": "2026-04-20"
  }
}
```

## Specification overview

The extension is structured in four layers:

1. **Data schema** — what an LTO Offer object looks like. See [`schema/lto-extension.schema.json`](./schema/lto-extension.schema.json) (JSON Schema) and [`schema/lto-extension.ts`](./schema/lto-extension.ts) (TypeScript types).

2. **Discovery patterns** — three ways an agent can fetch LTO Offers from a merchant: a static well-known feed, a live query API, or an MCP server. See [`docs/discovery-patterns.md`](./docs/discovery-patterns.md).

3. **Merchant manifest declaration** — how a merchant signals support for the extension in their UCP manifest. See `docs/discovery-patterns.md`.

4. **Security considerations** — stock semantics, rate limits, EU compliance hooks, anti-manipulation guidance. See [`docs/security-considerations.md`](./docs/security-considerations.md).

## Schema fields

### Required

| Field | Type | Description |
|---|---|---|
| `offer_id` | string | Stable unique identifier for this specific offer |
| `merchant_id` | string | Matches UCP `Merchant.id` |
| `valid_from` | ISO 8601 datetime (UTC) | When the offer becomes active |
| `valid_until` | ISO 8601 datetime (UTC) | When the offer expires |

### Strongly recommended

| Field | Type | Description |
|---|---|---|
| `product_id` | string | Matches UCP `Product.id` |
| `product_url` | URL | Canonical product page URL on the merchant store |
| `original_price` | number | Pre-discount price, used to display savings |
| `sale_price` | number | The price during the offer window |
| `currency` | ISO 4217 | Three-letter currency code |
| `discount_pct` | integer 0-100 | Discount percentage, convenience field for ranking |
| `stock_remaining` | integer \| null | **Units allocated to this offer**, not underlying inventory. See note below. |
| `stock_capped` | boolean | Whether the merchant set a hard stock limit for the offer |

> **Stock semantics:** `stock_remaining` refers to the units the merchant allocated to this specific offer, not their total inventory. A merchant running a "10-unit flash sale" reports 10 regardless of holding 10 or 10,000 in stock. Implementations MUST NOT expose underlying inventory counts via this field. See [`docs/security-considerations.md`](./docs/security-considerations.md).

### Optional

| Field | Type | Description |
|---|---|---|
| `campaign_type` | enum | One of: `standard_flash_sale`, `carousel`, `autopilot`, `evergreen_promo`, `flash_drop`, `raffle_drop` |
| `urgency_flags` | object | Pre-computed signals for agent ranking; see schema |
| `merchant_verified` | boolean | Set by the registry/protocol authority; merchants MUST NOT self-set this to `true` |
| `pangv_reference_price` | object | EU compliance: the 30-day lowest-price reference required by PAngV §11 and the Omnibus Directive |

### `urgency_flags` object

```typescript
{
  ending_within_hours: number,   // 0 = ended, 1 = within 1h, ...
  stock_critical: boolean,       // remaining < 10% of original allocation
  last_chance: boolean,          // ending within 2h AND stock_critical
}
```

### `pangv_reference_price` object (EU compliance)

```typescript
{
  amount: number,                // the 30-day lowest price observed
  valid_since: string,           // ISO 8601 date when the reference price was anchored
}
```

Required for merchants who ship to EU member states (PAngV §11, Omnibus Directive 2019/2161). Optional outside the EU.

## Discovery patterns

The extension specifies three discovery patterns. Implementers MAY support one or more.

1. **Static well-known feed** — `GET https://merchant.com/.well-known/ucp-lto-offers.json` returning a JSON array of `Offer` objects. Cacheable, simple, agent-friendly.

2. **Live query API** — `GET https://merchant.com/api/lto/offers?country=DE&min_discount_pct=20&ending_within_hours=24` returning filtered offers. Supports the same filters as the MCP transport.

3. **MCP server** — exposing three tools (`list_active_offers`, `get_offer_by_id`, `search_offers_by_category`) over the Model Context Protocol. See the [reference implementation](#reference-implementation).

See [`docs/discovery-patterns.md`](./docs/discovery-patterns.md) for the full specification of each pattern.

## Merchant manifest declaration

A merchant signals support for the LTO Extension by extending their UCP manifest at `/.well-known/ucp-manifest.json`:

```json
{
  "ucp_version": "2026-01",
  "extensions": {
    "lto": {
      "version": "0.1",
      "feed_url": "https://merchant.com/.well-known/ucp-lto-offers.json",
      "supports_realtime": true,
      "supports_mcp": "https://mcp.merchant.com/"
    }
  }
}
```

## Reference implementation

A production implementation of the LTO Extension runs at [Heartly](https://www.heartly.io):

- **MCP server:** [`https://mcp.heartly.io/`](https://mcp.heartly.io/) — listed in the [Official MCP Registry](https://registry.modelcontextprotocol.io) under `io.heartly/deals`
- **Public deal feed:** [`https://deals.heartly.io/api/deals`](https://deals.heartly.io/api/deals) — implements pattern #1 (static well-known feed)
- **Documentation:** [`heartly.io/developers/mcp`](https://www.heartly.io/developers/mcp)

The reference implementation has run in production since May 2026 across 120+ DACH Shopify and WooCommerce merchants.

## Examples

Three worked examples in [`/examples`](./examples):

- [`01-shopify-flash-sale.json`](./examples/01-shopify-flash-sale.json) — single product, 24-hour flash sale, stock-capped
- [`02-woocommerce-carousel.json`](./examples/02-woocommerce-carousel.json) — multi-product carousel campaign with shared timing
- [`03-autopilot-deadstock.json`](./examples/03-autopilot-deadstock.json) — AI-recommended dead-stock liquidation with auto-revert

## Security considerations

Critical for implementers:

- **Stock semantics:** `stock_remaining` is offer-allocated, not inventory. Implementations MUST NOT expose underlying inventory counts.
- **Anti-manipulation:** EU implementers MUST populate `pangv_reference_price` to comply with PAngV §11 and Omnibus Directive.
- **Trust signal:** `merchant_verified` MUST be set by the registry/protocol authority, never self-asserted by the merchant.
- **Rate limiting:** Discovery endpoints MUST implement ETag/Last-Modified for cache-friendly polling. Recommended 60 req/min/IP minimum.
- **Brand safety:** Implementations are expected to respect consumer protection law in their target jurisdictions. The spec defines data shape; legal compliance remains the merchant's responsibility.

See [`docs/security-considerations.md`](./docs/security-considerations.md) for full guidance.

## How to participate

This is a public RFC. Feedback is welcome via:

- **GitHub Issues** — open an issue in this repository for spec questions or proposed changes
- **Pull Requests** — propose concrete spec edits via PR
- **RFC discussion on the official UCP repository** — see the linked RFC issue [pending submission]

Topics where community input is especially valued:

- Trust model for `merchant_verified` (centralized registry vs federated attestation)
- Compliance hooks beyond PAngV/Omnibus — equivalents for other jurisdictions (CCPA, UK Consumer Rights Act, etc.)
- Extending `campaign_type` enum to cover new promotional formats
- Stock-bucketing recommendations for merchants who want to obfuscate exact counts

## Status and roadmap

- **v0.1 (current)** — initial draft, three discovery patterns, EU compliance hooks
- **v0.2 (planned)** — feedback-driven revisions, additional `campaign_type` values, stock bucketing helpers
- **v0.3** — formal RFC submission to the UCP working group

## Authors

This extension is authored by **Markus Böhme** ([Heartly Apps](https://www.heartly.io), Leipzig, Germany) as part of an open RFC contribution to the agentic commerce ecosystem.

Contributions and feedback are welcome from anyone in the agentic commerce, e-commerce protocol, or promotional infrastructure space.

## License

[MIT](./LICENSE) — use freely, contribute back if useful.

## Related work

- [Universal Commerce Protocol (UCP)](https://ucp.dev) — Google's parent specification
- [Model Context Protocol](https://modelcontextprotocol.io) — Anthropic-led protocol used by the LTO MCP server reference implementation
- [Agentic Commerce Protocol (ACP)](https://openai.com/index/powering-product-discovery-in-chatgpt/) — OpenAI's parallel specification
- [Heartly platform](https://www.heartly.io/platform) — the three-surface commerce platform that motivated this extension
