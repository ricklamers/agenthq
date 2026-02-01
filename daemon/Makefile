.PHONY: build build-all clean

BINARY_NAME=agenthq-daemon
VERSION?=dev

build:
	go build -ldflags="-s -w -X main.version=$(VERSION)" -o $(BINARY_NAME) ./cmd/agenthq-daemon

build-all:
	GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o $(BINARY_NAME)-darwin-arm64 ./cmd/agenthq-daemon
	GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o $(BINARY_NAME)-darwin-amd64 ./cmd/agenthq-daemon
	GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o $(BINARY_NAME)-linux-arm64 ./cmd/agenthq-daemon
	GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o $(BINARY_NAME)-linux-amd64 ./cmd/agenthq-daemon

clean:
	rm -f $(BINARY_NAME) $(BINARY_NAME)-*

run:
	go run ./cmd/agenthq-daemon
