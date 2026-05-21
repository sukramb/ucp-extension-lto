/**
 * UCP Live-Time-Offer Extension v0.1 — TypeScript types
 *
 * Mirrors the JSON Schema at ./lto-extension.schema.json. Both files
 * MUST stay in sync; the JSON Schema is the source of truth for the
 * wire format, this file is provided for ergonomic implementation in
 * TypeScript-based merchant integrations and AI agent SDKs.
 *
 * Authored by Heartly (https://www.heartly.io) as part of the public
 * UCP-LTO Extension RFC.
 */

/**
 * The campaign type taxonomy. Implementations SHOULD use the most
 * specific value that applies. New values will be added in future
 * versions of the spec.
 *
 * - `standard_flash_sale`: time-limited discount on a single product
 * - `carousel`: part of a multi-product campaign with shared timing
 * - `autopilot`: AI-generated offer (dead-stock liquidation, market reaction, etc.)
 * - `evergreen_promo`: ongoing offer with no scheduled end (valid_until far in future)
 * - `flash_drop`: limited-quantity new-product drop
 * - `raffle_drop`: probability-based access drop
 */
export type LtoCampaignType =
  | 'standard_flash_sale'
  | 'carousel'
  | 'autopilot'
  | 'evergreen_promo'
  | 'flash_drop'
  | 'raffle_drop'

/**
 * Pre-computed urgency signals emitted by merchants to help AI agents
 * rank and frame offers. Server-side computation ensures consistency
 * across implementations.
 */
export interface LtoUrgencyFlags {
  /**
   * Hours until valid_until. 0 means the offer has effectively ended.
   * Implementations SHOULD recompute on every discovery response (or
   * use ETag-based cache invalidation) to keep this field accurate.
   */
  ending_within_hours: number

  /**
   * True when stock_remaining is less than 10% of the original offer
   * allocation. Signals scarcity to the agent for ranking and copy
   * generation.
   */
  stock_critical: boolean

  /**
   * True when (ending_within_hours <= 2 AND stock_critical = true).
   * The strongest urgency signal in the protocol — agents SHOULD treat
   * last_chance offers as high-priority surface candidates.
   */
  last_chance: boolean
}

/**
 * EU compliance reference price (PAngV §11, Omnibus Directive 2019/2161).
 * The 30-day-lowest-price anchor that EU consumer law requires merchants
 * to display alongside any discount claim.
 *
 * Required for merchants who ship to EU member states. Optional outside
 * the EU.
 */
export interface LtoPangvReferencePrice {
  /**
   * The 30-day lowest price observed for this product, in the same
   * currency as the offer.
   */
  amount: number

  /**
   * ISO 8601 date (YYYY-MM-DD) when this reference price was first
   * observed. Used by agents and consumers to validate compliance with
   * PAngV §11.
   */
  valid_since: string
}

/**
 * A single time-bounded promotional offer. This is the root object of
 * the LTO Extension.
 *
 * Field requirements follow the JSON Schema:
 * - Required: offer_id, merchant_id, valid_from, valid_until
 * - All others are optional but most are strongly recommended (SHOULD)
 *   for agent compatibility. See README.md for guidance per field.
 */
export interface LtoOffer {
  // ─── Required ─────────────────────────────────────────────────────

  /**
   * Stable unique identifier for this specific offer. MUST be stable
   * across the offer's lifetime — a merchant updating the discount
   * percentage should keep the same offer_id.
   */
  offer_id: string

  /**
   * Matches UCP Merchant.id. Identifies which merchant is offering
   * this promotion.
   */
  merchant_id: string

  /**
   * ISO 8601 datetime (UTC) marking when the offer becomes active.
   * Offers with valid_from in the future are scheduled; agents MAY
   * surface them as upcoming but MUST NOT present them as currently
   * active.
   */
  valid_from: string

  /**
   * ISO 8601 datetime (UTC) marking when the offer expires. After
   * this timestamp the offer is no longer valid; implementations
   * SHOULD NOT return expired offers in discovery responses.
   */
  valid_until: string

  // ─── Strongly recommended ─────────────────────────────────────────

  /**
   * Matches UCP Product.id. Identifies which product the offer
   * applies to. SHOULD be present for single-product offers; MAY be
   * omitted for category-wide or storewide offers.
   */
  product_id?: string

  /**
   * Canonical product detail page URL on the merchant store. MUST be
   * HTTPS. Used by agents to render the offer with a link the shopper
   * can follow.
   */
  product_url?: string

  /**
   * Pre-discount price, used to display savings. MUST reflect the
   * actual price the product was sold at before the offer became
   * active. EU implementations SHOULD ensure this is consistent with
   * the pangv_reference_price field.
   */
  original_price?: number

  /**
   * The price during the offer window. MUST be less than or equal to
   * original_price.
   */
  sale_price?: number

  /**
   * ISO 4217 three-letter currency code (e.g., EUR, USD, GBP, CHF).
   */
  currency?: string

  /**
   * Discount percentage, 0-100. Convenience field for agents ranking
   * offers by depth of discount. Implementations MUST derive this
   * consistently from (original_price - sale_price) / original_price
   * * 100.
   */
  discount_pct?: number

  /**
   * Units allocated to THIS OFFER that have not yet been sold. NOT the
   * merchant's underlying inventory count. A merchant running a
   * 10-unit flash sale reports 10 here regardless of whether their
   * warehouse holds 10 or 10,000.
   *
   * Implementations MUST NOT expose underlying inventory via this
   * field. null indicates the merchant does not publish stock counts.
   */
  stock_remaining?: number | null

  /**
   * Whether the merchant has set a hard upper limit on units sold
   * under this offer. true means stock_remaining decrements as orders
   * complete and reaches zero when the cap is hit. false means
   * unlimited under the offer (the time window is the only constraint).
   */
  stock_capped?: boolean

  /**
   * Top-level product category (e.g., fashion, beauty, electronics,
   * home, food-and-beverage). Used by agents to filter by category.
   * null when the merchant does not publish a category taxonomy.
   */
  category?: string | null

  // ─── Optional ─────────────────────────────────────────────────────

  /**
   * The nature of the promotional event. See LtoCampaignType for
   * documentation per value.
   */
  campaign_type?: LtoCampaignType

  /**
   * Pre-computed urgency signals for agent ranking and copy generation.
   * See LtoUrgencyFlags.
   */
  urgency_flags?: LtoUrgencyFlags

  /**
   * Whether the merchant has a verified status with the protocol
   * authority or registry. MUST be set by the registry, NOT
   * self-asserted by the merchant. Implementations of discovery
   * endpoints MUST validate this field against an authoritative
   * source before returning offers.
   */
  merchant_verified?: boolean

  /**
   * EU compliance field. Required for merchants who ship to EU member
   * states (PAngV §11, Omnibus Directive 2019/2161); optional otherwise.
   * See LtoPangvReferencePrice.
   */
  pangv_reference_price?: LtoPangvReferencePrice

  /**
   * Reserved namespace for jurisdiction-specific or merchant-specific
   * fields outside the core LTO spec. Implementations MAY add custom
   * fields here without breaking forward compatibility.
   *
   * Recommended naming: vendor-prefixed (e.g., 'heartly:autopilot_rule_id').
   */
  extensions?: Record<string, unknown>
}

/**
 * A discovery response from a merchant feed or query API. Returns a
 * collection of offers along with metadata for caching and
 * pagination.
 *
 * Static well-known feeds and live query APIs both return this shape;
 * the MCP transport returns LtoOffer objects directly via tool calls.
 */
export interface LtoOfferFeed {
  /**
   * The list of currently active offers. SHOULD be sorted by
   * valid_until ascending (ending soonest first).
   */
  offers: LtoOffer[]

  /**
   * Total number of offers in this response. Convenience field for
   * agents; equivalent to offers.length.
   */
  count: number

  /**
   * Server timestamp when the feed was generated (ISO 8601 UTC).
   * Agents MAY use this for cache invalidation logic.
   */
  generated_at: string

  /**
   * Spec version this feed conforms to. MUST be "0.1" for this
   * version of the extension.
   */
  spec_version: '0.1'
}

/**
 * Merchant manifest extension fragment. The merchant publishes their
 * UCP manifest at /.well-known/ucp-manifest.json and adds an `lto`
 * entry under `extensions` to signal support for this protocol.
 *
 * Implementations MAY support one or more of the three discovery
 * patterns. At least one MUST be specified.
 */
export interface LtoManifestExtension {
  /**
   * Spec version the merchant implements. Currently "0.1".
   */
  version: '0.1'

  /**
   * Static well-known feed URL, if implemented. Pattern #1.
   */
  feed_url?: string

  /**
   * True when the merchant implements the live query API. Pattern #2.
   */
  supports_realtime?: boolean

  /**
   * MCP server URL, if implemented. Pattern #3.
   */
  supports_mcp?: string
}

/**
 * Filter parameters used by both the live query API (pattern #2) and
 * the MCP search tools (pattern #3). All filters are optional and
 * combinable.
 */
export interface LtoOfferFilters {
  /**
   * ISO 3166-1 alpha-2 country code. Filters to merchants who ship
   * to this country.
   */
  country?: string

  /**
   * Top-level product category to match (case-insensitive).
   */
  category?: string

  /**
   * Minimum discount_pct to include. Useful for "show me only the
   * best deals" queries.
   */
  min_discount_pct?: number

  /**
   * Only return offers ending within this many hours from now. Useful
   * for "what's expiring soon" queries.
   */
  ending_within_hours?: number
}
