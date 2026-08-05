# Engine benchmark — Current engine (proximity + tooltip/section precision fix)

Reproduce: `node scripts/engine-benchmark/run-current.mjs` (baseline) → `node scripts/engine-benchmark/report.mjs baseline-current.json`.
Vault + ground-truth: `scripts/engine-benchmark/score.mjs`, `docs/testing/engine-benchmark/ground-truth/*.json`.

**P** = precision (of labeled fills, how many correct) · **R** = recall (of should-fill fields, how many correct) · **blankOK** = of should-be-BLANK fields, how many correctly left blank (over-fill guard) · **cov** = distinct vault values that landed.

| Form | Pages | Fields | Filled | P | R | blankOK | cov | GT |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| 01-uscis-i9.pdf | 4 | 128 | 24 | — | — | — | 8 | 0 |
| 02-uscis-i130.pdf | 12 | 405 | 102 | — | — | — | 11 | 0 |
| 03-uscis-n400.pdf | 14 | 391 | 46 | 100% | 75% | 100% | 12 | 15 |
| 04-uscis-i485.pdf | 24 | 626 | 52 | — | — | — | 9 | 0 |
| 05-uscis-i765.pdf | 7 | 145 | 24 | — | — | — | 10 | 0 |
| 06-uscis-i131.pdf | 14 | 209 | 22 | — | — | — | 10 | 0 |
| 07-uscis-g28.pdf | 4 | 77 | 20 | — | — | — | 8 | 0 |
| 08-uscis-i90.pdf | 7 | 146 | 25 | — | — | — | 10 | 0 |
| 09-uscis-n600.pdf | 16 | 261 | 56 | — | — | — | 11 | 0 |
| 10-irs-w4.pdf | 5 | 48 | 1 | 100% | 20% | 100% | 1 | 7 |
| 11-irs-w9.pdf | 6 | 23 | 3 | 50% | 33% | — | 2 | 3 |
| 12-irs-w7.pdf | 1 | 69 | 4 | 100% | 100% | 60% | 3 | 6 |
| 13-irs-1040.pdf | 2 | 199 | 28 | 80% | 80% | 50% | 10 | 9 |
| 14-irs-w8ben.pdf | 1 | 23 | 2 | 100% | 100% | — | 1 | 2 |
| 15-irs-8822.pdf | 2 | 25 | 9 | 100% | 100% | 75% | 3 | 6 |

## Rollup (macro-average over 7 ground-truth-labeled forms)

- **Precision:** 90%
- **Recall:** 73%
- **Blank-correctness (over-fill guard):** 77%

## Confirmed failures (proof)

### 03-uscis-n400.pdf — 1 issue(s)

- **not filled** — BUG: street filled with NAME; should be street address 

### 10-irs-w4.pdf — 4 issue(s)

- **not filled** — first name + MI 
- **not filled** — last name 
- **not filled** — address 
- **not filled** — SSN 

### 11-irs-w9.pdf — 2 issue(s)

- **not filled** — line 1 name of individual 
- **wrong value** — line 6 city/state/zip (got: ["27587"])

### 12-irs-w7.pdf — 2 issue(s)

- **should be BLANK but was filled** — NEGATIVE: name/SSN of U.S. citizen (delegate) (got: ["123-45-6789"])
- **should be BLANK but was filled** — NEGATIVE: college city and state (got: ["WAKE FOREST"])

### 13-irs-1040.pdf — 3 issue(s)

- **wrong value** — your first name + MI (bug: only 'S' landed) (got: ["S"])
- **should be BLANK but was filled** — NEG: foreign province (over-filled NC) (got: ["NC"])
- **should be BLANK but was filled** — NEG: foreign postal (over-filled 27587) (got: ["27587"])

### 14-irs-w8ben.pdf — 1 issue(s)

- **locator matched no field** — line 1 name 

### 15-irs-8822.pdf — 1 issue(s)

- **should be BLANK but was filled** — BUG: decedent's SSN over-filled with applicant (got: ["123-45-6789"])

