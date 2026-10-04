BIN := bin/acornfall
DATA ?= $(HOME)/.acornfall

# Bind to the tailnet address when there is one, so the listener is reachable
# from your devices and nothing else. Override with ADDR=... for another address.
TAILNET := $(shell ip -4 -brief addr show tailscale0 2>/dev/null | awk '{print $$3}' | cut -d/ -f1)
ADDR ?= $(if $(TAILNET),$(TAILNET):7777,127.0.0.1:7777)

# On a tailnet the WireGuard keys and ACLs are the authentication boundary, so a
# token would be a second lock on a door that is already yours. INSECURE=0 for one.
INSECURE ?= 1
OPTS = $(if $(filter 1,$(INSECURE)),--insecure,)

.PHONY: help deps build typecheck check run dev fmt clean

help:
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

deps: ## install worker dependencies
	cd worker && bun install

build: ## build the gateway binary
	cd gateway && go build -o ../$(BIN) ./cmd/acornfall

typecheck: ## typecheck the worker and check the client against its markup
	cd worker && bun run typecheck
	node scripts/check-client.mjs

check: ## verify the client and worker agree with their contracts
	node scripts/check-client.mjs
	cd worker && bun run typecheck

run: build ## run against the current directory
	./$(BIN) --addr $(ADDR) $(OPTS) --workspace $(CURDIR)

dev: build ## run with the scripted dev provider (no api key needed)
	cd worker && ACORNFALL_DEV_PROVIDER=1 ../$(BIN) --addr $(ADDR) $(OPTS) --workspace $(CURDIR) --data-dir $(DATA) --model faux/faux-1 --worker-dir $(CURDIR)/worker

fmt: ## format Go sources
	cd gateway && gofmt -w .

clean:
	rm -rf bin
