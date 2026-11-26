# Bun.js Runtime Standards and Best Practices

## Overview

This skill provides comprehensive guidelines for using Bun.js as the runtime for the ERDwithAI project. This guide covers Bun.js specific features, optimizations, configurations, and best practices for running Next.js, NestJS, OpenUI5, and OData applications on Bun.

## Table of Contents

1. [Bun.js Fundamentals](#bunjs-fundamentals)
2. [Project Configuration](#project-configuration)
3. [Performance Optimization](#performance-optimization)
4. [Package Management](#package-management)
5. [Testing](#testing)
6. [TypeScript Configuration](#typescript-configuration)
7. [File System Operations](#file-system-operations)
8. [HTTP Server](#http-server)
9. [Worker Threads](#worker-threads)
10. [Bun-specific APIs](#bun-specific-apis)
11. [Debugging](#debugging)
12. [Production Deployment](#production-deployment)

---

## Bun.js Fundamentals

### Why Bun.js?

Bun.js is a modern JavaScript runtime that provides:

- **Speed**: 3-4x faster than Node.js for most operations
- **Native TypeScript**: No compilation step needed
- **Built-in Package Manager**: Faster installs than npm
- **Built-in Test Runner**: Faster than Jest
- **Web API Compatibility**: Fetch, FormData, WebSocket, etc.
- **Zero-configuration**: Works out of the box

### Installation

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Or via npm
npm install -g bun

# Verify installation
bun --version
```

---

## Project Configuration

### package.json Configuration

```json
{
  "name": "erdwithai-v5.1-complete",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "dev:web": "bun run packages/web/dev.ts",
    "dev:nestjs": "bun run packages/backend/src/main.ts",
    "build": "bun run build:all",
    "build:next": "bun run build --filter @erdwithai/web",
    "build:nestjs": "bun run build --filter @erdwithai/backend",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "lint": "bun run lint",
    "format": "bun prettier --write .",
    "migrate": "bun run packages/backend/migrate.ts",
    "start": "bun run start:prod"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.3.0",
    "prettier": "^3.1.0",
    "eslint": "^8.55.0"
  },
  "engines": {
    "bun": ">=1.4.4",
    "node": ">=20.0.0"
  },
  "trustedDependencies": [
    "esbuild",
    "sass"
  ]
}
```

### bunfig.toml Configuration

```toml
# bunfig.toml

[install]
# Lockfile behavior
lockfile = true
lockfileSave = true
lockfilePrint = "yarn"

# Cache behavior
cache = true
globalCacheDir = "~/.bun/install/cache"
scopeCacheDir = "~/.bun/install/cache"

# Install behavior
frozenLockfile = false
dryRun = false

# Registry configuration
registry = "https://registry.npmjs.org"
@erdwithai:registry = "http://localhost:4873"

# Behavior
autoInstallPeers = true
production = false

[install.scopes]
# Scoped package configurations

[install.cache]
# Cache behavior
enableMessage = "Adding {} to cache"
disableMessage = "Removing {} from cache"

[test]
# Test runner configuration
root = "./test"
preload = ["./test/setup.ts"]
coverage = true
coverageThreshold = 0.8

[run]
# Run behavior
shell = true
silent = false

[lockfile]
# Lockfile configuration
print = "yarn"
save = true

[log]
# Logging configuration
level = "info"
```

### TypeScript Configuration

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "lib": ["ESNext"],
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "noEmit": true,
    "incremental": true,
    "paths": {
      "@/*": ["./src/*"],
      "@web/*": ["./packages/web/*"],
      "@backend/*": ["./packages/backend/*"],
      "@ai/*": ["./packages/ai/*"],
      "@generator/*": ["./packages/generator/*"]
    }
  },
  "include": [
    "packages/**/*",
    "test/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "build",
    ".next"
  ],
  "ts-node": {
    "transpileOnly": true
  }
}
```

---

## Performance Optimization

### Bun-specific Optimizations

```typescript
// Using Bun's native file reading
import { readFileSync } from 'fs';

// Instead of this (slow):
const data = readFileSync('large-file.json');
const json = JSON.parse(data);

// Use this (fast):
import { file } from 'bun';
const json = await file('large-file.json').json();

// Native env loading
import { config } from 'dotenv';
const env = config({ path: '.env' });

// Or use Bun's built-in
const dbUrl = process.env.DATABASE_URL;
```

### Optimizing Package Imports

```typescript
// Good: Use Bun's native import
import { serve } from 'bun';

// Instead of this:
// import express from 'express';
// const app = express();

// Use this:
const server = serve({
  port: 3000,
  fetch: handler,
});
```

### Hot Module Replacement

```typescript
// dev.ts
import { watch } from 'fs';
import { build } from 'esbuild';

async function dev() {
  const ctx = await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    sourcemap: true,
    watch: {
      onRebuild(error, result) {
        if (error) console.error('Watch build failed:', error);
        else console.log('Watch build succeeded:', result);
      },
    },
  });

  // Watch for file changes
  const watcher = watch(['src/**/*.ts'], async (event, filename) => {
    console.log(`${event}: ${filename}`);
    await ctx.rebuild();
  });
}

dev();
```

---

## Package Management

### Installing Packages

```bash
# Install packages
bun install

# Add specific packages
bun add react react-dom

# Add dev dependencies
bun add -d typescript @types/react

# Install with specific version
bun add react@18.2.0

# Install from git
bun add lodash-es

# Install local packages
bun add ../my-package

# Remove packages
bun remove lodash

# Update packages
bun update
```

### Workspaces

```bash
# In root package.json
{
  "workspaces": [
    "packages/*"
  ]
}

# Install all workspace dependencies
bun install

# Add dependency to specific workspace
bun add react --filter @erdwithai/web

# Run script in workspace
bun run --filter @erdwithai/web dev

# Build all workspaces
bun run build --filter '*'
```

### Lockfile Management

```bash
# Regenerate lockfile
bun install

# Check for outdated packages
bun update

# Clean cache
bun pm cache rm
```

---

## Testing

### Bun Test Runner

```typescript
// Basic test
import { test, expect } from 'bun:test';

test('math operations', () => {
  expect(2 + 2).toBe(4);
});

// Async test
test('async operations', async () => {
  const data = await fetchData();
  expect(data).toBeDefined();
});

// Test with setup and teardown
test.describe('User service', () => {
  test.beforeEach(() => {
    // Setup before each test
  });

  test.afterEach(() => {
    // Cleanup after each test
  });

  test('should create user', async () => {
    const user = await create_user({ name: 'John' });
    expect(user.name).toBe('John');
  });
});

// Skipping tests
test.skip('this test is skipped', () => {
  // Won't run
});

// Only this test
test.only('only this test runs', () => {
  // Only this runs
});
```

### Test Configuration

```typescript
// bun test.config.ts
export default {
  // Test files to include
  files: ['**/*.test.ts', '**/*.spec.ts'],
  // Files to ignore
  ignore: ['**/node_modules/**'],
  // Preload setup files
  preload: ['./test/setup.ts'],
  // Enable coverage
  coverage: true,
  // Coverage thresholds
  coverageThreshold: {
    lines: 80,
    functions: 80,
    branches: 80,
    statements: 80,
  },
  // Timeout in milliseconds
  timeout: 5000,
  // Concurrency
  concurrency: process.env.CI ? 1 : 4,
};
```

### Mocking

```typescript
// Mocking functions
import { test, expect, mock } from 'bun:test';

test('mock example', () => {
  const mockFn = mock((val: string) => `Hello ${val}`);

  mockFn('World');
  expect(mockFn).toHaveBeenCalled();
  expect(mockFn).toHaveBeenCalledTimes(1);
  expect(mockFn).toHaveBeenCalledWith('World');

  mockFn.mockReturnValue('Mocked result');
  expect(mockFn('test')).toBe('Mocked result');
});

// Spying
import { spyOn } from 'bun:test';

test('spy example', () => {
  const obj = {
    method: () => 'original',
  };

  const spy = spyOn(obj, 'method');
  obj.method();

  expect(spy).toHaveBeenCalled();
});
```

---

## File System Operations

### Reading Files

```typescript
// Read text file
import { readFileSync } from 'fs';
const content = readFileSync('file.txt', 'utf-8');

// Read JSON file with Bun
import { file } from 'bun';
const json = await file('data.json').json();

// Read file lines
const lines = (await file('log.txt').text()).split('\n');

// Stream file
import { createReadStream } from 'fs';
const stream = createReadStream('large-file.txt');
for await (const chunk of stream) {
  console.log(chunk);
}
```

### Writing Files

```typescript
// Write text file
import { writeFileSync } from 'fs';
writeFileSync('output.txt', 'Hello, World!');

// Write JSON with Bun
await Bun.write('output.json', JSON.stringify({ data: 'value' }));

// Append to file
import { appendFileSync } from 'fs';
appendFileSync('log.txt', 'New log entry\n');

// Write with encoding
await Bun.write('output.txt', 'Content', { createPath: true });
```

### File Watching

```typescript
// Watch for file changes
import { watch } from 'fs';

const watcher = watch(['src/**/*.ts'], (event, filename) => {
  console.log(`${event}: ${filename}`);
  // Trigger rebuild
});

// Cleanup watcher
watcher.close();
```

---

## HTTP Server

### Basic HTTP Server

```typescript
import { serve } from 'bun';

serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Route handling
    if (url.pathname === '/api/hello') {
      return Response.json({ message: 'Hello from Bun!' });
    }

    if (url.pathname === '/api/time') {
      return Response.json({ time: new Date().toISOString() });
    }

    // Static file serving
    return new Response('Not Found', { status: 404 });
  },
});

console.log('Server running on http://localhost:3000');
```

### WebSocket Server

```typescript
import { serve } from 'bun';

serve({
  port: 3001,
  fetch(req, server) {
    // Upgrade WebSocket
    if (server.upgrade(req)) {
      return;
    }

    return new Response('Upgrade failed', { status: 500 });
  },
  websocket: {
    message(ws, message) {
      // Echo back message
      ws.send(message);
    },
    open(ws) {
      console.log('WebSocket opened');
      ws.send('Connected!');
    },
    close(ws, code, message) {
      console.log('WebSocket closed');
    },
  },
});
```

### Reverse Proxy

```typescript
import { serve, Response } from 'bun';

serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Proxy to backend
    if (url.pathname.startsWith('/api/')) {
      const backendUrl = `http://localhost:3001${url.pathname}${url.search}`;
      const response = await fetch(backendUrl, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
      return response;
    }

    // Serve frontend
    return new Response('Frontend');
  },
});
```

---

## Worker Threads

### Basic Worker

```typescript
// worker.ts
export default {
  message(data: any) {
    console.log('Received:', data);
    return { result: 'processed' };
  },
};

// main.ts
import { spawn } from 'bun';

const worker = spawn(new URL('worker.ts', import.meta.url));

worker.postMessage({ task: 'process' });

worker.on('message', (data) => {
  console.log('Worker response:', data);
});

worker.on('exit', (code) => {
  console.log('Worker exited with code:', code);
});
```

### Worker Pool

```typescript
// worker-pool.ts
import { spawn } from 'bun';

export class WorkerPool {
  private workers: Worker[];
  private queue: Array<{ data: any; resolve: Function }> = [];

  constructor(size: number, workerScript: string) {
    this.workers = Array.from({ length: size }, () =>
      spawn(new URL(workerScript, import.meta.url))
    );

    this.workers.forEach((worker) => {
      worker.on('message', (result) => {
        const task = this.queue.shift();
        if (task) {
          task.resolve(result);
        }
      });
    });
  }

  async run(data: any): Promise<any> {
    return new Promise((resolve) => {
      const worker = this.workers.shift();
      if (worker) {
        worker.postMessage(data);
        worker.on('message', (result) => {
          resolve(result);
          this.workers.push(worker);
        });
      } else {
        this.queue.push({ data, resolve });
      }
    });
  }

  terminate() {
    this.workers.forEach((worker) => worker.terminate());
  }
}

// Usage
const pool = new WorkerPool(4, 'worker.ts');
const results = await Promise.all([
  pool.run({ task: 'task1' }),
  pool.run({ task: 'task2' }),
]);
pool.terminate();
```

---

## Bun-specific APIs

### Bun.file()

```typescript
import { file } from 'bun';

// Read file as text
const text = await file('data.txt').text();

// Read file as JSON
const json = await file('data.json').json();

// Get file metadata
const metadata = await file('data.txt').stat();
console.log(metadata.size); // File size in bytes

// Check if file exists
const exists = await file('data.txt').exists();
```

### Bun.build()

```typescript
// Build configuration
await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  target: 'bun',
  format: 'esm',
  sourcemap: 'external',
  minify: true,
  splitting: true,
});

// Build with plugins
await Bun.build({
  entrypoints: ['src/index.ts'],
  plugins: [
    {
      name: 'custom-plugin',
      setup(build) {
        build.onLoad({ filter: /\.txt$/ }, async (args) => {
          const contents = await file(args.path).text();
          return { contents, loader: 'text' };
        });
      },
    },
  ],
});
```

### Bun.serve()

```typescript
// Advanced server configuration
const server = Bun.serve({
  port: 3000,
  // Enable TLS
  tls: {
    key: Bun.file('key.pem'),
    cert: Bun.file('cert.pem'),
  },
  // Request timeout
  maxRequestBodySize: 1024 * 1024 * 10, // 10MB
  // Enable compression
  compression: true,
  fetch(req) {
    return new Response('Hello!');
  },
});

// Stop server
server.stop();
```

---

## Debugging

### Source Maps

```typescript
// Enable source maps in development
const isDev = process.env.NODE_ENV !== 'production';

await Bun.build({
  entrypoints: ['src/index.ts'],
  sourcemap: isDev ? 'external' : false,
  // ... other options
});
```

### Logging

```typescript
// Structured logging
interface LogData {
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: any;
  timestamp: string;
}

function log(data: LogData) {
  const logEntry = {
    ...data,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(logEntry));
}

// Usage
log({
  level: 'info',
  message: 'User created',
  data: { userId: 123 },
});
```

### Debugging with VS Code

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Bun",
      "runtimeExecutable": "bun",
      "runtimeArgs": ["--inspect", "${file}"],
      "cwd": "${workspaceFolder}",
      "internalConsoleOptions": "openOnSessionStart"
    }
  ]
}
```

---

## Production Deployment

### Build Configuration

```typescript
// build.ts
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: true,
  sourcemap: false,
  outdir: 'dist',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  external: [
    'pg',
    'better-sqlite3',
  ],
});
```

### Environment Variables

```bash
# .env.production
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/db
LOG_LEVEL=warn
API_PORT=3001

# Load in application
import { config } from 'dotenv';
config({ path: '.env.production' });
```

### Docker Configuration

```dockerfile
# Dockerfile
FROM oven/bun:1.4.4 AS base
WORKDIR /app

FROM base AS install
RUN bun install --frozen-lockfile

FROM base AS build
RUN bun run build

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json bun.lockb ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
```

### Health Checks

```typescript
// health-check.ts
import { serve } from 'bun';

let healthy = true;

serve({
  port: 3001,
  routes: {
    '/health': () => new Response(
      JSON.stringify({ healthy, uptime: process.uptime() }),
      { status: healthy ? 200 : 503 }
    ),
    '/ready': () => new Response(JSON.stringify({ ready: true })),
  },
});

// Graceful shutdown
process.on('SIGTERM', () => {
  healthy = false;
  console.log('Received SIGTERM, shutting down gracefully');
  setTimeout(() => process.exit(0), 5000);
});
```

---

## Additional Resources

- [Bun.js Documentation](https://bun.sh/docs)
- [Bun.js Runtime API](https://bun.sh/docs/runtime)
- [Bun.sh Test Runner](https://bun.sh/docs/test)