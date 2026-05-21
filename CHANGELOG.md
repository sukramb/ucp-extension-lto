# Changelog

All notable changes to the UCP-LTO Extension specification are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.

## [0.1.0] — 2026-05-21

### Added

- Initial public draft of the UCP-LTO Extension
- JSON Schema definition for the `Offer` object (`schema/lto-extension.schema.json`)
- TypeScript types matching the JSON Schema (`schema/lto-extension.ts`)
- Three worked examples covering Shopify flash sale, WooCommerce carousel, and autopilot dead-stock liquidation
- Discovery patterns documentation: static well-known feed, live query API, MCP server
- Security considerations document covering stock semantics, anti-manipulation, rate limiting, and EU compliance
- Reference implementation pointer to Heartly's production deployment (`mcp.heartly.io`, `deals.heartly.io`)
- MIT License

### Design decisions

- `stock_remaining` defined as offer-allocated units, never underlying inventory — explicitly differs from naive inventory feeds
- `pangv_reference_price` field for EU compliance; required for merchants shipping into EU member states
- `merchant_verified` is registry-set, never self-asserted — anti-manipulation hardening
- Three parallel discovery patterns rather than mandating a single one — keeps adoption friction low
