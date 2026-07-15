# Data Classification & Handling

Every data field the system stores or processes has a class. Handling rules follow from the class.

## Classes
| Class | Examples | Storage | In logs? | Access |
|---|---|---|---|---|
| **Public** | marketing copy, docs | any | yes | anyone |
| **Internal** | non-sensitive config, aggregates | app store | yes | authenticated |
| **Confidential** | user profile, business data | encrypted at rest | redacted | role-scoped |
| **Restricted (PII/PHI/secrets)** | health data, credentials, tokens | encrypted; least-privilege | **never** | strict RBAC + audit |

## Rules
- **Restricted data never appears in logs, error messages, analytics, or non-prod environments** without
  masking/synthetic substitution.
- Secrets live in a secret manager, never in code or git. Rotate on schedule and on exposure.
- Access to Confidential/Restricted is role-scoped and **audited**.
- Deletion/retention honors policy: TODO (retention windows per class).
- Synthetic or de-identified data for demos/tests.

## Field register (fill in)
| Field | Class | Where stored | Notes |
|---|---|---|---|
| TODO | | | |
