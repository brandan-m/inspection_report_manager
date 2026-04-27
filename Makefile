SERVICE_NAME ?= inspection-report-manager
PROJECT_NAME ?= operations
REGION ?= us-east1
RELEASE_VERSION ?= dev
IMAGE ?= $(REGION)-docker.pkg.dev/$(PROJECT_NAME)/$(SERVICE_NAME)/$(SERVICE_NAME):$(RELEASE_VERSION)

.PHONY: build tag-image

build:
	npm run build

tag-image: build
	@echo "IMAGE=$(IMAGE)" >> "$${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set by GitHub Actions}"
	@echo "Prepared image tag $(IMAGE)"
