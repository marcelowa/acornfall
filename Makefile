BIN := bin/acornfall
DATA ?= $(HOME)/.acornfall

# Bind to the tailnet address when there is one, so the listener is reachable
# from your devices and nothing else. Override with ADDR=... for another address.
TAILNET := $(shell ip -4 -brief addr show tailscale0 2>/dev/null | awk '{print $$3}' | cut -d/ -f1)
ADDR ?= $(if $(TAILNET),$(TAILNET):7777,127.0.0.1:7777)
URL ?= http://$(ADDR)

# On a tailnet the WireGuard keys and ACLs are the authentication boundary, so a
# token would be a second lock on a door that is already yours. INSECURE=0 for one.
INSECURE ?= 1
OPTS = $(if $(filter 1,$(INSECURE)),--insecure,)

.PHONY: help deps build typecheck lint tools check test ui vendor run dev fmt clean

# The linters, installed into the Go and bun toolchains rather than vendored. `make lint` runs
# whichever are present and names the ones that are not, so a missing tool is a message and
# not a silent pass.
GOBIN := $(shell go env GOPATH)/bin
STATICCHECK := $(GOBIN)/staticcheck

help:
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

deps: ## install worker and tool dependencies
	cd worker && bun install
	cd tools && bun install

build: ## build the gateway binary
	cd gateway && go build -o ../$(BIN) ./cmd/acornfall

tools: ## install the linters used by `make lint`
	go install honnef.co/go/tools/cmd/staticcheck@latest
	cd worker && bun install

typecheck: ## the compiler's opinion, without running anything
	cd worker && bun run typecheck

lint: typecheck ## the static rules; fails on the first one broken
	node scripts/check-client.mjs
	node scripts/check-context.mjs
	@if [ -z "$$(gofmt -l gateway)" ]; then echo "gofmt: clean"; else echo "gofmt:"; gofmt -l gateway; exit 1; fi
	cd gateway && go vet ./...
	@if [ -x "$(STATICCHECK)" ]; then cd gateway && $(STATICCHECK) ./... && echo "staticcheck: clean"; \
	else echo "staticcheck: not installed (make tools)"; fi
	@if grep -rn "^func init()" gateway --include=*.go | grep -q .; then \
		echo "init() is not for setup (docs/engineering/standards.md G3):"; grep -rn "^func init()" gateway --include=*.go; exit 1; \
	else echo "no init() in the gateway: clean"; fi
	@bad=$$(grep -rn "eslint-disable" worker/src worker/test 2>/dev/null | grep -v -- " -- " || true); \
	if [ -n "$$bad" ]; then echo "a lint exception without a reason (S9):"; echo "$$bad"; exit 1; \
	else echo "lint exceptions carry reasons: clean"; fi
	cd worker && bun run lint

check: typecheck ## fast: the compiler and the unit tests, no processes
	cd worker && bun test
	cd gateway && go test -short ./...

test: lint ## everything: static rules, unit tests, the worker protocol, and the features
	cd worker && bun test
	cd gateway && go test -race ./...

run: build ## run against the current directory
	./$(BIN) --addr $(ADDR) $(OPTS) --workspace $(CURDIR)

dev: build ## run with the scripted dev provider (no api key needed)
	cd worker && ACORNFALL_DEV_PROVIDER=1 ../$(BIN) --addr $(ADDR) $(OPTS) --workspace $(CURDIR) --data-dir $(DATA) --model faux/faux-1 --worker-dir $(CURDIR)/worker

ui: ## check the client in a real browser (needs a running gateway)
	cd tools && bun run check-ui.mjs $(URL)

vendor: ## regenerate the vendored browser bundles (marked, DOMPurify, highlight.js)
	cd tools && bun run vendor.mjs

fmt: ## format Go sources
	cd gateway && gofmt -w .

clean:
	rm -rf bin
