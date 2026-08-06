# PolyglotFormFill — developer entry points. See memory-bank/techContext.md.
.PHONY: install dev build typecheck test db-push check clean guide guide-upload guide-captions

install:        ## Install all workspace deps (pnpm, CI-safe)
	pnpm install

dev:            ## Run API + web together
	pnpm dev

dev-app:        ## Clean-launch the desktop app (kills the previous session first)
	pwsh -NoProfile -File scripts/dev-app.ps1

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

guide:          ## Rebuild the guide video + captions from segment clips (data-driven, one command)
	node scripts/build-guide.mjs

guide-upload:   ## Upload the built guide to YouTube (needs YT_* env; prints the new watch URL)
	node scripts/upload-youtube.mjs

guide-captions: ## Update captions on an EXISTING YouTube video in place (same URL): make guide-captions VID=<id>
	node scripts/upload-youtube.mjs --captions docs/guide/output/captions/PolyglotFormFill-guide.en.srt --video-id $(VID)

clean:
	pnpm -r exec rm -rf dist node_modules && rm -rf node_modules
