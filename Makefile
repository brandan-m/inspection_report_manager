SERVICE_NAME ?= inspection-report-manager
PROJECT_NAME ?= operations
REGION ?= us-east1
RELEASE_VERSION ?= dev
IMAGE ?= $(REGION)-docker.pkg.dev/$(PROJECT_NAME)/$(SERVICE_NAME)/$(SERVICE_NAME):$(RELEASE_VERSION)
ARTIFACTORY_URL ?= https://geckorobotics.jfrog.io/artifactory/api/npm/npm/

.PHONY: build tag-image

build:
	npm run build

tag-image:
	docker build \
		--build-arg ARTIFACTORY_URL="$(ARTIFACTORY_URL)" \
		--build-arg ARTIFACTORY_USER="$(ARTIFACTORY_USER)" \
		--build-arg ARTIFACTORY_PASS="$(ARTIFACTORY_PASS)" \
		--build-arg ARTIFACTORY_EMAIL="$(ARTIFACTORY_EMAIL)" \
		-t "$(IMAGE)" .
	@echo "IMAGE=$(IMAGE)" >> "$${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set by GitHub Actions}"
	@echo "Built image $(IMAGE)"
