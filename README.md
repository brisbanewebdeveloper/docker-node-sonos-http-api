# docker-node-sonos-http-api
Docker wrapper for https://github.com/jishi/node-sonos-http-api

[![GitHub issues](https://img.shields.io/github/issues/chrisns/docker-node-sonos-http-api.svg)](https://github.com/chrisns/docker-node-sonos-http-api/issues)
[![GitHub forks](https://img.shields.io/github/forks/chrisns/docker-node-sonos-http-api.svg)](https://github.com/chrisns/docker-node-sonos-http-api/network)
[![GitHub stars](https://img.shields.io/github/stars/chrisns/docker-node-sonos-http-api.svg)](https://github.com/chrisns/docker-node-sonos-http-api/stargazers)
[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://raw.githubusercontent.com/chrisns/docker-node-sonos-http-api/master/LICENSE)
[![Docker Stars](https://img.shields.io/docker/stars/chrisns/docker-node-sonos-http-api.svg)](https://hub.docker.com/r/chrisns/docker-node-sonos-http-api)
[![Docker Pulls](https://img.shields.io/docker/pulls/chrisns/docker-node-sonos-http-api.svg)](https://hub.docker.com/r/chrisns/docker-node-sonos-http-api)
[![Docker Automated buil](https://img.shields.io/docker/automated/chrisns/docker-node-sonos-http-api.svg)](https://hub.docker.com/r/chrisns/docker-node-sonos-http-api)
![Docker Image CI](https://github.com/chrisns/docker-node-sonos-http-api/workflows/Docker%20Image%20CI/badge.svg?branch=master)

## Usage
Refer to https://github.com/jishi/node-sonos-http-api for all the configuration detail

First create the local directories and the settings file:
```shell
mkdir clips
mkdir cache
mkdir presets
curl https://raw.githubusercontent.com/jishi/node-sonos-http-api/master/presets/example.json > presets/example.json
echo {} > settings.json
```

Then run the docker image:
```shell
docker run \
  --net=host \
  --name sonos \
  --restart=always \
  -d \
  -v `pwd`/settings.json:/app/settings.json \
  -v `pwd`/clips:/app/static/clips \
  -v `pwd`/cache:/app/cache \
  -v `pwd`/presets:/app/presets \
  chrisns/docker-node-sonos-http-api
```

If you want to run in a swarm see an example setup here: https://github.com/pinked/clustered_sonos. The important thing is using the *host* networking interface so that it can discover your Sonos devices.

If you're looking this as part of a bigger home automation piece you might also want to look at [my MQTT hack job](https://github.com/chrisns/sonos-mqtt).

## [Custom] Use AWS Polly (TTS) with the Docker Image having Sonos HTTP API enabled to use the neural engine

### Installation

```
mkdir clips cache presets

curl https://raw.githubusercontent.com/jishi/node-sonos-http-api/master/presets/example.json > presets/example.json

echo {} > settings.json
OR
{
  "aws": {
    "credentials": {
      "region": "ap-southeast-2",
      "accessKeyId": "EXAMPLE",
      "secretAccessKey": "ExampleExampleExampleExampleExample"
    },
    "name": "Kendra"
  }
}

cp docker-compose.example.yml docker-compose.yml

docker-compose up -d
```

### References

- https://github.com/jishi/node-sonos-http-api#aws-polly
- https://github.com/jishi/node-sonos-http-api
- https://www.voicerss.org/personel/
- https://github.com/chrisns/docker-node-sonos-http-api

MCP TEXT SERVER
---------------

An isolated MCP sidecar lives in `mcp/`. It does not change the legacy Sonos HTTP API process or runtime requirements.

Requirements:

* Node 20 or newer for the `mcp/` package

Install and run it from the sidecar directory:

```bash
cd mcp
npm install
npm start
```

The server listens on `http://127.0.0.1:3101/mcp` by default.

Best way to use the MCP server in VS Code:

1. Start the server with Docker Compose if you want the full stack and the default workspace port mapping:

```bash
docker compose up -d
```

If you only want the MCP sidecar during local development, run it directly instead:

```bash
cd mcp
npm install
npm start
```

2. Register the server in VS Code.

Create `.vscode/mcp.json` in this workspace, or open your user-level MCP configuration with the `MCP: Open User Configuration` command, and add this server:

```json
{
  "servers": {
    "sonos-http-api": {
      "type": "http",
      "url": "http://127.0.0.1:33101/mcp"
    }
  }
}
```

Use `http://127.0.0.1:3101/mcp` instead if you run the sidecar directly with `cd mcp && npm start` instead of Docker Compose.

3. In VS Code, run `MCP: List Servers` if you want to confirm the server is visible, then start or trust `sonos-http-api` when prompted.

4. Open Chat and use the MCP tools directly in a prompt. Good first prompts are:

```text
Use process-chat-text on: "  Hello   team  "
```

```text
Use speak-on-sonos to say "Dinner is ready" in room "Office".
```

```text
Use play-sonos-clip to play "doorbell.mp3" in room "Office".
```

If you want VS Code to restart MCP servers automatically when configuration changes, add this to your VS Code `settings.json`:

```json
{
  "chat.mcp.autoStart": true
}
```

Environment variables:

* `MCP_HOST` overrides the bind host
* `MCP_PORT` overrides the port
* `MCP_PATH` overrides the MCP route path
* `SONOS_API_BASE_URL` points the sidecar at the Sonos HTTP API and defaults to `http://127.0.0.1:5005`
* `SONOS_API_TIMEOUT_MS` overrides the Sonos API request timeout in milliseconds

The sidecar exposes three tools:

* `process-chat-text` validates and normalizes one plain UTF-8 string intended for a chat session
* `speak-on-sonos` delegates plain-text announcements to the existing Sonos HTTP API for one room, all rooms, or a preset
* `play-sonos-clip` delegates clip playback to the existing Sonos HTTP API for one room, all rooms, or a preset

Client expectations:

* Send one plain text string in the `text` argument
* Do not send serialized JSON objects, arrays, transcripts, files, or multimodal payloads
* Empty strings and null bytes are rejected
* Room and preset playback targets must be supplied per tool call
* Preset-based playback does not support custom volume overrides because the legacy API does not accept them

When running the bundled Docker Compose stack on Linux, the `mcp` service now resolves the host-networked Sonos API through `host.docker.internal`. Override `SONOS_API_BASE_URL` if your deployment uses a different reachable address.

Run the sidecar tests with:

```bash
cd mcp
npm test
```

Run a live speech smoke test against a running MCP sidecar with explicit inputs:

```bash
cd mcp
SMOKE_TARGET_TYPE=room \
SMOKE_TARGET=Office \
SMOKE_TEXT='Sonos MCP smoke test' \
npm run smoke:speak
```

Optional smoke-test environment variables:

* `MCP_SERVER_URL` overrides the MCP endpoint and defaults to `http://127.0.0.1:3101/mcp`
* `SMOKE_LANGUAGE` passes an optional language or voice to `speak-on-sonos`
* `SMOKE_VOLUME` passes an optional announce volume from 0 to 100

The smoke test performs a real `speak-on-sonos` call, so it should only be run when you intend to trigger live Sonos playback.

Run a live clip smoke test with the same target options:

```bash
cd mcp
SMOKE_TARGET_TYPE=room \
SMOKE_TARGET=Office \
SMOKE_CLIP_NAME=doorbell.mp3 \
npm run smoke:clip
```

The clip smoke test performs a real `play-sonos-clip` call. `SMOKE_VOLUME` is optional for room and all-player playback, but not supported for preset clip playback.

Run both live smoke steps in sequence against the same target:

```bash
cd mcp
SMOKE_TARGET_TYPE=room \
SMOKE_TARGET=Office \
SMOKE_TEXT='Sonos MCP smoke test' \
SMOKE_CLIP_NAME=doorbell.mp3 \
npm run smoke:all
```

The combined smoke command runs `speak-on-sonos` first and `play-sonos-clip` second using the same target and optional `SMOKE_LANGUAGE` and `SMOKE_VOLUME` inputs.
