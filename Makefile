# Build the single self-contained booth binary: Vite SPA embedded into the Go
# server. Output: ./disasterprep
SHELL := /bin/bash
BIN := disasterprep
LDFLAGS := -s -w
DEMO_PORT ?= 8080
# How to invoke the tailscale CLI. If your tailscaled socket is root-owned
# (you normally type `sudo tailscale`), run `make demo TS="sudo tailscale"`,
# or once: `sudo tailscale set --operator=$USER` to drop the sudo requirement.
TS ?= tailscale

.PHONY: help build web gobuild run demo dev clean

.DEFAULT_GOAL := help

## help: show this message
help:
	@grep -E '^## [a-z]' Makefile | sed 's/## /  make /'

## build: full production binary (SPA + server in one file)
build: web gobuild
	@echo "Built ./$(BIN) ($$(du -h $(BIN) | cut -f1))"

## web: build the SPA and stage it for embedding
web:
	pnpm install --frozen-lockfile
	pnpm build
	rm -rf server/web
	cp -r dist server/web
	touch server/web/.gitkeep

## gobuild: compile the static binary (assumes server/web is populated)
gobuild:
	cd server && CGO_ENABLED=0 go build -trimpath -ldflags="$(LDFLAGS)" -o ../$(BIN) .

## run: build then run locally (serves SPA + API on :8080)
run: build
	ADMIN_PASSPHRASE=$${ADMIN_PASSPHRASE:-devsecret} CONTENT_DIR=$${CONTENT_DIR:-./data} ./$(BIN)

## demo: run locally and expose it on the public internet via Tailscale Funnel.
## Prints a public https URL; Ctrl-C tears down the funnel and stops the server.
## Needs sudo for tailscale? -> `make demo TS="sudo tailscale"`. Port override:
## `make demo DEMO_PORT=9000`.
demo: build
	@command -v tailscale >/dev/null 2>&1 || { echo "✗ tailscale not found — install it and run 'tailscale up' first"; exit 1; }
	@$(TS) funnel status >/dev/null 2>&1 || { echo "✗ can't reach tailscaled. Try: make demo TS=\"sudo tailscale\"  (or: sudo tailscale set --operator=\$$USER)"; exit 1; }
	@ss -ltn 2>/dev/null | grep -q ":$(DEMO_PORT) " && { echo "✗ port $(DEMO_PORT) is already in use — funnelling it would expose the wrong app."; echo "  Free it, or pick another: make demo DEMO_PORT=9000"; exit 1; } || true
	@echo "▶ Booth on :$(DEMO_PORT), funnelling to the public internet (Ctrl-C to stop)…"
	@ADMIN_PASSPHRASE=$${ADMIN_PASSPHRASE:-devsecret} CONTENT_DIR=$${CONTENT_DIR:-./data} PORT=$(DEMO_PORT) ./$(BIN) & \
	srv=$$!; \
	trap 'kill $$srv 2>/dev/null' EXIT INT TERM; \
	for i in $$(seq 1 20); do \
		curl -sf -o /dev/null http://127.0.0.1:$(DEMO_PORT)/api/health && break; \
		kill -0 $$srv 2>/dev/null || { echo "✗ booth server exited before coming up (port taken? see the log above)"; exit 1; }; \
		sleep 0.25; \
	done; \
	curl -sf -o /dev/null http://127.0.0.1:$(DEMO_PORT)/api/health || { echo "✗ booth server never became healthy on :$(DEMO_PORT)"; exit 1; }; \
	$(TS) funnel $(DEMO_PORT)

## clean: remove build artifacts
clean:
	rm -rf dist server/web/assets server/web/brand server/web/*.html server/web/*.svg $(BIN)
