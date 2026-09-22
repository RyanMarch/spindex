# vinylCrate

A lightweight, local-first web application.

## Overview

- **Stack**: Vanilla HTML5, CSS custom properties, modern ES6+ JavaScript modules. No client framework or build step.
- **Hosting**: Cloudflare Pages with optional edge functions in `functions/`.
- **Privacy & Storage**: Client-side execution and local persistence by default.

## Local Development

Start the local development server (uses global Wrangler):
```bash
npm run dev
```
The app will run at `http://localhost:8780`.

## Project Structure

```
├── public/                 Static web root served by Cloudflare Pages
│   ├── index.html          Main application entry point
│   ├── 404.html            Fallback page
│   ├── manifest.webmanifest PWA manifest
│   ├── sw.js               Offline Service Worker
│   ├── css/
│   │   └── style.css       Tokens, reset, typography, and responsive styles
│   ├── js/
│   │   └── app.js          Main client application logic
│   └── assets/             Static media and icons
├── functions/              Cloudflare Pages Functions for backend edge routes
│   └── api/
│       └── health.js       Health check endpoint (/api/health)
├── tests/                  Unit and syntax tests
│   └── basic-test.js
├── package.json            Dependencies and dev scripts
├── wrangler.toml           Cloudflare Pages configuration
└── .gitignore
```
