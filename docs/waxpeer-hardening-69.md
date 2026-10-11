# Waxpeer final bounded decision — #69

Base: main `8c7a6aaa18d05c77ff5ef09810072ee4c327dcaa`. Contracts #37/#38,
P0 #63/#64 and existing adapter #58 remain unchanged. This adds only an explicit
diagnostic, not scheduling, feed integration, scoring or source promotion.

`node scripts/check-waxpeer-hardening.mjs` first reads up to 20,000 public CSV
listings and the public maximum-order snapshot. It uses exact allowed names
expanded from the 70-row #63 catalog already stored in csdeals-catalog.json;
that file's CS.Deals-specific purpose does not confer native Waxpeer provenance.
Collection/rarity remain canonical-catalog mappings, not upstream fields.
Missing rows in this prefix do not establish market absence.

With the explicitly authorized existing WAXPEER_API_KEY supplied by Railway
reference to scale-runtime-market, it reads at most eight diverse exact P0 titles,
one page of 100 float items and one page of active orders for each. Public listing
price bounds narrow the float lookup. Joins require item_id, exact name, price,
numeric float in canonical and exterior bounds, and <=180s observed skew.
Missing joins and pagination flags are retained; no completeness inference.

Bounds: <=30 GETs, >=3.1s spacing, 20s per-response timeout, <=32 MiB per response,
20,000 listing rows, eight names, <=480s total under these fixed loops. No retries.
HTTP rejection stops further calls; Retry-After seconds are recorded, but no
deliberate throttling load is generated. Existing adapter backoff remains tested.
Source errors and transport failures are sanitized: no URLs, credentials, raw
source bodies or buyer/account identifiers are logged. Authenticated source time
is unknown, separate from ingestion. Amount/filled are observations, never
remaining executable quantity or BID_EXECUTABLE. Runtime viability beyond this
one-shot remains unproved.

Deployment gate: focused tests and full CI PASS before merge; run merged script
once as temporary preDeployCommand using only the secure reference. Review staged
changes before applying. Afterwards restore preDeployCommand=[], remove temporary
timeout, confirm staged=null and healthy final deployment. Shared source secret
must never be read, duplicated or removed. Reference alone does not activate the
adapter because the production runtime does not call this diagnostic.

Rollback: revert this diagnostic PR if needed; restore the prior merged revision
with preDeployCommand=[] and no diagnostic timeout. Remove the newly added
reference through Railway if reverting access, never alter its source variable.
Final live evidence and classification belong in #69 and roadmap #42.
