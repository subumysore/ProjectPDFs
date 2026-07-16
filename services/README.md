# services/ — stateless, content-free servers (down only)

**No service ever receives user content.** These serve public assets/metadata downward.

| Service | Serves | Never |
|---|---|---|
| `catalog` | public Form Catalog: metadata, tags, blank templates, field-maps (doc + web-form), fingerprints; on-device index | user content |
| `assets` | fonts, OCR/NMT/embedding models, app updates | user content |
| `account` | subscription/billing + OIDC broker + Authority/Institution **role registry** (org metadata) | user content |

`catalog` and `account` are Node-buildable and can start now (no Rust dependency). Contributions to
`catalog` are **structure-only, user-consented** (never values). See `docs/reference/repo-structure.md`.
