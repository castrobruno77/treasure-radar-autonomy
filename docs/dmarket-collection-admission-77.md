# #77 strict COLLECTION token equivalence

Base: main `cdc9b399c1998f9f47849bc9e885ea584a3826d5`.
The recorded native diagnostic found TOKEN_EQUIVALENT in 10/10 rows (five Consumer,
five Industrial). This change only updates observeP0Identity's COLLECTION guard.

Before changing admission, an offline enumeration of the canonical P0 cells proved
eight distinct, nonempty keys. The committed test pins those keys and checks all
16 cells:

| Collection ID | Sorted tokens |
| --- | --- |
| mirage-2021 | 2021, mirage |
| vertigo-2021 | 2021, vertigo |
| ancient | ancient |
| norse | norse |
| st-marc | marc, st |
| canals | canals |
| cobblestone | cobblestone |
| chop-shop | chop, shop |

Rule: lowercase, tokenize ASCII alphanumeric runs, remove only whole `the` and
`collection` tokens, sort and compare serialized multisets. Years, other words
and multiplicity survive. Missing/non-string/empty keys fail closed. No fuzzy
matching, transliteration, substring aliases or token deduplication. Raw source
collection remains unchanged in provenance.

Tests cover equivalent order/case/separators, extra/missing/duplicate tokens,
wrong years, joined tokens, whole-token removal, and every neighboring P0
collection. Existing negative identity tests now also exercise token-equivalent
input with invalid name/category/quality/float/listing. Variant/scope, economics,
score and runtime code are unchanged. Diagnostic classification remains observational;
its strict identity counts now reflect this updated COLLECTION guard.

No live probe, merge, deployment or Railway hook is part of this unit. Local and
CI evidence is synthetic and does not prove downstream native guards pass.
#77 and Coverage Beta remain open. Rollback: revert this isolated guard change.
