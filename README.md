# NexCart Render

[![CI](https://img.shields.io/badge/CI-ready-2ea44f)](https://github.com/)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-24%2B-40B5A4)](https://pptr.dev/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Executive Overview

NexCart Render is an enterprise-ready rendering service for ecommerce creative operations. It turns product data, brand direction, and commerce assets into production-ready Pinterest imagery and short-form MP4 video through a consistent, automatable workflow.

The service is designed for dependable integration with ecommerce platforms and workflow orchestrators. Browser rendering is centralized in `core/puppeteer.js`, while image and video composition remain independently testable and deployable.

## Capabilities

- Render validated Pinterest images from product imagery and campaign copy.
- Generate animated product videos with configurable dimensions, duration, frame rate, and audio.
- Integrate Shopify product data through the shared integration boundary.
- Support API-key protected rendering endpoints and configurable runtime timeouts.
- Produce deterministic, automation-friendly outputs for workflow systems such as n8n.

## Strategic Technology Partners

| Partner | Role | Value to NexCart Render |
| --- | --- | --- |
| [Shopify](https://www.shopify.com/) | Commerce platform | Product, catalog, and storefront data integration |
| [Puppeteer](https://pptr.dev/) | Browser automation | Reliable HTML/CSS rendering and frame capture |
| [Render](https://render.com/) | Cloud deployment platform | Managed hosting and production service delivery |

## Repository Layout

```text
core/
	puppeteer.js             Shared browser launch configuration
integrations/shopify/
	client.js                Shopify API integration boundary
renderer/
	video-renderer.js        Video validation, composition, and export
	test/                    Renderer test suite
server.js                  HTTP API and request orchestration
templates/
	pinterest-template.js    Pinterest image composition template
data/                      Samples and generated exports
docs/                      API, architecture, and operations documentation
```

## Getting Started

### Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- A local or deployed Shopify integration when commerce data is required

### Install

```bash
npm install
npx puppeteer browsers install chrome
```

### Configure

Create a `.env` file from the available environment examples and set the values appropriate for the target environment:

```dotenv
RENDERER_PORT=3000
RENDERER_API_KEY=replace-with-a-secret
RENDERER_TIMEOUT_MS=120000
PUPPETEER_EXECUTABLE_PATH=
```

`PUPPETEER_EXECUTABLE_PATH` is optional. When it is not set, Puppeteer uses its managed browser installation.

### Run

```bash
npm start
```

The service exposes health endpoints at `/` and `/health`, image rendering at `/render`, and video rendering at `/render-video`.

### Test

```bash
npm test
```

The standard test command runs the renderer suite without requiring `NODE_PATH` or other manual module-resolution setup.

## Configuration Principles

Browser launch defaults are centralized in `core/puppeteer.js` so server and video rendering share the same sandbox, executable, and resource settings. Callers may provide targeted overrides such as `protocolTimeout`; default browser arguments are retained and caller arguments are appended.

Production video rendering uses a four-minute fallback ceiling, while test-mode renders retain a shorter timeout for fast feedback. The `RENDERER_TIMEOUT_MS` environment variable controls the server-level timeout passed to video rendering.

## API Surface

### `POST /render`

Renders a Pinterest image. Requests require the configured `x-api-key` header and include `productImage` and `headline` values.

### `POST /render-video`

Renders an MP4 video. Requests require the configured `x-api-key` header and accept validated product, composition, platform, duration, frame-rate, and optional audio fields.

### `GET /health`

Returns a lightweight service health response suitable for deployment probes.

## GitFlow Guidelines

NexCart Render uses GitFlow-style branch conventions:

| Branch | Purpose |
| --- | --- |
| `main` | Production-ready releases only |
| `develop` | Integration branch for the next release |
| `feature/<name>` | New functionality and enhancements |
| `release/<version>` | Release hardening and final verification |
| `hotfix/<name>` | Urgent production fixes branched from `main` |

Pull requests should target `develop` for normal work and `main` for approved releases or hotfixes. Keep commits focused, run `npm test` before opening a pull request, and include operational or API documentation when behavior changes.

## Operational Notes

- Keep API keys and Shopify credentials outside source control.
- Use the health endpoint for deployment readiness checks.
- Review render duration and temporary storage requirements when increasing video dimensions or duration.
- Treat generated media under `renders/` and temporary frame data as runtime artifacts.

## License

This project is distributed under the terms in [LICENSE](LICENSE).