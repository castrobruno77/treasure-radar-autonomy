# Opportunity API Contract v0

## Goal
Stable contract between the Treasure Skins Radar engine and the Chromium extension.

## Endpoint
`GET /v1/opportunities`

### Query
- `limit` optional integer, default 20
- `status` optional, extension uses `CERTIFIED`
- `since` optional ISO timestamp

### Response
```json
{
  "status": "OK",
  "generated_at": "2026-10-02T00:00:00Z",
  "freshness_seconds": 0,
  "items": []
}
```

Each item follows `contracts/opportunity.schema.json`.

## Extension rules
- Never display REJECTED as an opportunity.
- INSUFFICIENT may be shown only in an explicit diagnostic view later.
- Show freshness.
- If `listing_url` exists, CTA may open it directly.
- If endpoint is unavailable, keep the last known state and show stale/error state.
- API credentials must not be embedded in the extension.

## MVP authentication boundary
Steam authentication is part of the MVP, but the opportunity feed contract is defined independently so UI and engine can evolve in parallel.

## Free/Pro boundary
Exact quotas are server-configured. The extension must consume entitlement metadata later rather than hard-code limits.
