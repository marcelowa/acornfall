BIN := bin/acornfall
DATA ?= $(HOME)/.acornfall
ADDR ?= 0.0.0.0:7777

.PHONY: help deps build typecheck run dev fmt clean

help:
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

deps: ## install worker dependencies
	cd worker && bun install

build: ## build the gateway binary
	cd gateway && go build -o ../$(BIN) ./cmd/acornfall

typecheck: ## typecheck the worker
	cd worker && bun run typecheck

run: build ## run against the current directory
	./$(BIN) --addr $(ADDR) --workspace $(CURDIR)

dev: build ## run with the scripted dev provider (no api key needed)
	cd worker && ACORNFALL_DEV_PROVIDER=1 ../$(BIN) --addr $(ADDR) --workspace $(CURDIR) --data-dir $(DATA) --model faux/faux-1 --worker-dir $(CURDIR)/worker

fmt: ## format Go sources
	cd gateway && gofmt -w .

clean:
	rm -rf bin
