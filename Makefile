# PolyglotFormFill — developer entry points. See memory-bank/techContext.md.
.PHONY: install dev build typecheck test db-push check clean

install:        ## Install all workspace deps (pnpm, CI-safe)
	pnpm install

dev:            ## Run API + web together
	pnpm dev

build:          ## Production build / type-check all packages
	pnpm build

typecheck:      ## Type-check without emitting
	pnpm typecheck

test:           ## Run all package tests
	pnpm test

db-push:        ## Apply the Drizzle schema to the local Postgres
	pnpm db:push

check:          ## Governance: BRD <-> traceability matrix
	pnpm check:traceability

clean:
	pnpm -r exec rm -rf dist node_modules && rm -rf node_modules
