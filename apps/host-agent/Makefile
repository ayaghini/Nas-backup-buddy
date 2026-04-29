.PHONY: build test lint docker-build docker-up docker-down verify

build:
	go build -o bin/nasbb-agent ./src

test:
	go test ./tests/...

lint:
	go vet ./src/... ./tests/...

docker-build:
	docker compose -f compose/docker-compose.yml build

docker-up:
	docker compose -f compose/docker-compose.yml up -d

docker-down:
	docker compose -f compose/docker-compose.yml down

verify:
	bash tests/scripts/verify.sh
