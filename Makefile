# =============================================================================
#  Developer entry points. `make help` lists everything.
# =============================================================================
.DEFAULT_GOAL := help
SHELL := /bin/bash
COMPOSE := ./scripts/compose.sh

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

# --- Local -------------------------------------------------------------------
.PHONY: up
up: ## Start the local stack
	$(COMPOSE) local up -d --build

.PHONY: up-tools
up-tools: ## Start the local stack including mongo-express and mailhog
	$(COMPOSE) local --profile tools up -d --build

.PHONY: down
down: ## Stop the local stack
	$(COMPOSE) local down

.PHONY: reset
reset: ## Stop the local stack and delete its volumes (destroys local data)
	$(COMPOSE) local down -v

.PHONY: logs
logs: ## Tail local logs
	$(COMPOSE) local logs -f

.PHONY: ps
ps: ## Show local service status
	$(COMPOSE) local ps

.PHONY: shell
shell: ## Open a shell in the backend container
	$(COMPOSE) local exec backend sh

.PHONY: mongo
mongo: ## Open mongosh against the local database
	$(COMPOSE) local exec mongo mongosh

# --- Data --------------------------------------------------------------------
.PHONY: seed
seed: ## Seed baseline roles, permissions, settings and the bootstrap admin
	$(COMPOSE) local exec backend npm run seed

.PHONY: migrate
migrate: ## Run pending database migrations
	$(COMPOSE) local exec backend npm run migrate

# --- Quality -----------------------------------------------------------------
.PHONY: lint
lint: ## Lint backend and frontends
	npm --prefix backend-node run lint
	npm --prefix frontend-vue run lint

.PHONY: test
test: ## Run backend and frontend tests
	npm --prefix backend-node run test
	npm --prefix frontend-vue run test

.PHONY: verify
verify: ## Run the full template validation suite
	npm --prefix backend-node run lint
	npm --prefix frontend-vue run lint
	npm --prefix backend-node run test
	npm --prefix frontend-vue run test
	node backend-node/scripts/verify-module-contracts.js
	node backend-node/scripts/verify-exec-bits.js
# >>> template-only
# The generator only exists in the template, so only the template can test it.
# Globbed rather than passed as a directory: `node --test <dir>` fails on
# Windows, which would make the suite unrunnable for half the team.
	node --test tools/generator/test/*.test.js
# <<< template-only
	@cmp -s infra/nginx/default.conf frontend-vue/nginx/default.conf \
		|| { echo 'infra/nginx/default.conf and frontend-vue/nginx/default.conf have drifted.'; \
		     echo 'The first is the source of truth - copy it over the second.'; exit 1; }
	$(COMPOSE) local config -q

# >>> template-only
# --- Generator ---------------------------------------------------------------
# Stripped from generated projects: a child has no tools/generator/ to invoke.
.PHONY: new
new: ## Generate a child project: make new CODE=hrms NAME="HR System" OUT=../hrms
	node tools/generator/bin/create-project.js \
		--project-code "$(CODE)" \
		--project-name "$(NAME)" \
		--out "$(OUT)"
# <<< template-only

# --- Preproduction / Production ----------------------------------------------
.PHONY: preprod-up
preprod-up: ## Start the preproduction stack
	$(COMPOSE) preproduction up -d

.PHONY: prod-up
prod-up: ## Start the production stack (images pulled from the registry)
	$(COMPOSE) production pull
	$(COMPOSE) production up -d
