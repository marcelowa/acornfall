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

.PHONY: help deps build typecheck lint tools commits check test test-sandbox sandbox-preflight ui vendor run dev fmt clean

# The linters, installed into the Go and bun toolchains rather than vendored. `make lint` runs
# whichever are present and names the ones that are not, so a missing tool is a message and
# not a silent pass.
GOBIN := $(shell go env GOPATH)/bin
STATICCHECK := $(GOBIN)/staticcheck
# modernize lives inside gopls, so the path looks wrong and is not: it is the analyzer gopls
# serves to editors, published as a vet tool. Installing it pulls the toolchain gopls needs.
MODERNIZE := $(GOBIN)/modernize

help:
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

deps: ## install worker and tool dependencies
	cd worker && bun install
	cd tools && bun install

build: ## build the gateway binary
	cd gateway && go build -o ../$(BIN) ./cmd/acornfall

tools: ## install the linters used by `make lint`
	go install honnef.co/go/tools/cmd/staticcheck@latest
	go install golang.org/x/tools/gopls/internal/analysis/modernize/cmd/modernize@latest
	cd worker && bun install

typecheck: ## the compiler's opinion, without running anything
	cd worker && bun run typecheck

lint: typecheck ## the static rules; fails on the first one broken
	node scripts/check-client.mjs
	node scripts/check-context.mjs
	@out=$$(gofmt -l gateway); if [ -n "$$out" ]; then echo "$$out"; echo "gofmt: not formatted"; exit 1; fi; echo "gofmt: clean"
	cd gateway && go vet ./...
	@if [ -x "$(STATICCHECK)" ]; then cd gateway && $(STATICCHECK) ./... && echo "staticcheck: clean"; \
	else echo "staticcheck: not installed (make tools)"; fi
	@if [ -x "$(MODERNIZE)" ]; then cd gateway && go vet -vettool=$(MODERNIZE) ./... && echo "modernize: clean"; \
	else echo "modernize: not installed (make tools)"; fi
	node scripts/check-house-rules.mjs
	cd worker && bun run format:check
	cd worker && bun run lint

commits: ## check commit messages (RANGE=origin/main..HEAD by default)
	node scripts/check-commits.mjs $(RANGE)

# The slow tier's image cache, shared across runs and across both the Go and worker suites so
# an image is pulled once per machine. Nothing may delete it: a fresh state directory per run
# is how a suite meets a registry's anonymous rate limit. /tmp keeps it short enough for the
# engine's runtime sockets (docs/adr/0012-sandbox.md).
SANDBOX_STATE ?= /tmp/acornfall-e2e-sandboxes

# How many end-to-end tests the fast tier runs at once: one per core, because each test is a
# gateway and a worker under -race, and six of those on a two-core CI runner starve the
# conversations they are waiting for. Override with TEST_PARALLEL.
TEST_PARALLEL ?= $(shell getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)

# How many workspace sandboxes the slow tier runs at once. Six is one per core on the machine
# this was measured on: the 17 sandbox tests took 125s at 2, 85s at 4, 72s at 6, and 76s at 8
# (contention). Override per machine; each sandbox asks for 2 cpus and 2G. The tier is not
# "serial-ish" for a reason any more — the per-test cleanup made parallel VMs safe.
SANDBOX_PARALLEL ?= 6

check: typecheck ## fast: the compiler and the unit tests, no processes
	cd worker && bun test
	# -count=1 because the suite's inputs include worker/src and gateway/web, which Go's test
	# cache cannot see: a cached pass would be a pass for code that has changed.
	# The end-to-end suite is excluded: it starts a gateway and a worker per test, and that is
	# its own tier (`make test`). A gate that takes a minute is a gate nobody runs.
	cd gateway && go test -short -count=1 $$(go list ./... | grep -v /internal/e2e)

test: lint ## the default tier: units and the feature suite, no hypervisor needed
	cd worker && bun test
	# ACORNFALL_NO_SANDBOX forces the refusal path instead of auto-detecting a hypervisor, so
	# the same command behaves the same on a machine with /dev/kvm and in CI. -short skips the
	# tests whose assertions need a sandbox; the rest of the feature suite runs in parallel.
	# -count=1 because the suite's inputs include worker/src and gateway/web, which Go's test
	# cache cannot see: a cached pass would be a pass for code that has changed.
	cd gateway && ACORNFALL_NO_SANDBOX=1 go test -short -race -count=1 -parallel $(TEST_PARALLEL) ./...

test-sandbox: sandbox-preflight ## the engine boundary: live driver, SDK client, and its e2e tests
	# env -u so a shell that exported the fast tier's switch cannot silently turn this into a
	# suite of skips. -race stays here: the sandbox's start, attach, and mount path is only
	# taken in this tier, and the four tests plus the live driver are ~35s instrumented.
	cd worker && env -u ACORNFALL_NO_SANDBOX ACORNFALL_SANDBOX_INTEGRATION=1 MSB_HOME=$(SANDBOX_STATE) bun test test/sandbox.integration.test.ts
	cd gateway && env -u ACORNFALL_NO_SANDBOX ACORNFALL_SANDBOX_ONLY=1 ACORNFALL_LIVE_SANDBOX=1 ACORNFALL_SANDBOX_STATE=$(SANDBOX_STATE) go test -race -count=1 -parallel $(SANDBOX_PARALLEL) ./...

sandbox-preflight: ## fail, not skip, when there is no hypervisor for the microVM engine
	@if [ "$$(uname -s)" = "Linux" ] && [ ! -r /dev/kvm ]; then \
		echo "the sandbox tiers need a hypervisor and /dev/kvm is not readable; see docs/adr/0012-sandbox.md"; exit 1; \
	fi
	@if [ "$$(uname -s)" = "Darwin" ] && [ "$$(sysctl -n kern.hv_support 2>/dev/null)" != "1" ]; then \
		echo "the sandbox tiers need a hypervisor and this Mac reports none; see docs/adr/0012-sandbox.md"; exit 1; \
	fi

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
