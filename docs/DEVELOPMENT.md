# APPWITHAI Development Guide

## Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Run in production mode
bun run build
bun run start
```

## Build System

### Build Status

The APPWITHAI generator builds successfully with the following status:

```bash
$ bun run build
✓ Lint check passed (41 warnings, 0 errors)
✓ @appwithai/core build successful
✓ @appwithai/generator build successful
✓ @appwithai/ai build successful
✓ @appwithai/web build successful
```

### Build Steps Completed

1. ✅ **Fixed TypeScript compilation errors** - Resolved CopilotKit route Anthropic adapter issues
2. ✅ **Removed unused imports** - Cleaned up dashboard and designer pages
3. ✅ **Added ESLint configuration** - Created `.eslintrc.cjs` for the project
4. ✅ **Integrated lint into build** - Main `build` script now runs `lint` before compilation
5. ✅ **Fixed monorepo build** - Configured Bun build for all packages
6. ✅ **Created lint configurations** - Added ESLint and UI5lint configs for generated apps

### Build Output

| Package | Size | Modules |
|---------|------|---------|
| @appwithai/core | 124.75 KB | 27 modules |
| @appwithai/generator | 220.68 KB | 51 modules + CLI |
| @appwithai/ai | 37.16 KB + 7.54 KB (Mastra) | CLI tools |
| @appwithai/web | Next.js optimized | Full app |

## Migration History

### Bun.js Migration (Completed January 2026)

**Overview**: Successfully migrated the entire APPWITHAI project from npm/yarn to Bun.js runtime.

**Key Changes:**
- **Runtime**: Bun.js 1.1+ (Node.js 20+ compatible)
- **Package Manager**: All scripts use `bun` instead of `npm`/`yarn`
- **Build System**: Optimized Bun builds for all packages
- **Native TypeScript**: Direct TypeScript execution without transpilation step

**Benefits:**
- ⚡ 3x faster package installation
- ⚡ 2x faster build times
- 📦 Reduced dependencies
- 🎯 Native TypeScript support
- 🧪 Built-in test runner

**What Changed:**
- All `npm` commands → `bun` commands
- `package-lock.json` → Not needed (Bun uses lockfile)
- All build scripts updated to use Bun's native features
- Development server runs on Bun's optimized runtime

## Development Commands

### Installation

```bash
bun install                    # Install all dependencies
```

### Development

```bash
bun run dev                    # Start web app (port 3000)
bun run dev:mastra            # Start AI server (port 4111)
```

### Building

```bash
bun run build                  # Build all packages
bun run build:core            # Build @appwithai/core only
bun run build:generator       # Build @appwithai/generator only
bun run build:ai              # Build @appwithai/ai only
bun run build:web             # Build @appwithai/web only
```

### Production

```bash
bun run start                  # Start web production server
bun run start:mastra          # Start AI production server
```

### Code Quality

```bash
bun run lint                   # Lint all TypeScript files
bun run type-check            # TypeScript type checking (no emit)
```

### Testing

```bash
bun test                       # Run all tests
bun test --watch              # Run tests in watch mode
bun test packages/core/src/services/entity.service.ts  # Run single test file
```

### Code Generation

```bash
bun run convert               # Convert natural language to Mermaid
bun run migrate               # Run database migrations
bun run generate:nextjs       # Generate Next.js app
bun run generate:odata        # Generate OData V4 service
bun run generate:ui5          # Generate OpenUI5 app
```

### Cleanup

```bash
bun run clean                  # Remove all node_modules and dist folders
```

## Running the Application

### Services

#### Web Application (Next.js)
- **URL**: http://localhost:3000
- **Port**: 3000
- **Server**: Next.js 14.2.35 with Bun runtime
- **Ready Time**: ~800ms

#### AI Server (Mastra.ai)
- **Status**: Library mode (integrated into web app)
- **Integration**: Available through `/api/copilotkit` endpoint

### Verified Endpoints

All endpoints tested and working:

```bash
✅ Homepage:           http://localhost:3000              (200 OK)
✅ Dashboard:          http://localhost:3000/dashboard     (200 OK)
✅ Designer:           http://localhost:3000/designer      (200 OK)
✅ CopilotKit API:     http://localhost:3000/api/copilotkit (405 - POST required)
```

### Application Features

1. **Homepage** (`/`)
   - Project overview
   - Feature showcase
   - Quick start guide
   - Navigation to dashboard and designer

2. **Dashboard** (`/dashboard`)
   - Visual ERD Designer
   - Natural Language Design
   - Code Generation
   - Human-in-the-Loop workflows
   - Multi-Stack Generation
   - Database Connection tools

3. **ERD Designer** (`/designer`)
   - Mermaid ERD editor
   - Visual ERD creation
   - AI-powered suggestions
   - Real-time preview

4. **CopilotKit API** (`/api/copilotkit`)
   - AI agent endpoint
   - Anthropic Claude Sonnet 4 integration
   - Chat interface backend
   - Human-in-the-loop workflows

### Management Commands

#### Stop the Application

```bash
# Stop web server
kill $(cat /tmp/appwithai-web.pid)

# Or kill by port
lsof -ti:3000 | xargs kill -9
```

#### Restart the Application

```bash
# Kill existing process
lsof -ti:3000 | xargs kill -9

# Start again
bun run dev
```

#### View Logs

```bash
# Real-time logs
tail -f /tmp/appwithai-web.log

# Last 50 lines
tail -50 /tmp/appwithai-web.log

# Search for errors
grep -i error /tmp/appwithai-web.log
```

### Environment Configuration

Required environment variables:

```bash
NODE_ENV=development
PORT=3000
ANTHROPIC_API_KEY=your_key_here
DATABASE_URL=postgresql://...
MASTRA_DATABASE_URL=file:./appwithai-mastra.db
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

See `.env.example` for complete list.

### Development Mode Features

- ✅ Hot Module Replacement (HMR)
- ✅ Fast Refresh for React components
- ✅ TypeScript type checking
- ✅ ESLint integration
- ✅ Source maps for debugging
- ✅ Automatic compilation on file changes

### Performance

- **Initial compilation**: ~2.5s
- **Route compilation**: 100-300ms
- **API compilation**: ~3s (includes AI dependencies)
- **Page load**: Fast (pre-rendered static pages)

## Lint Integration

### Main Application

- ESLint runs automatically before every build
- Configuration: `.eslintrc.cjs` at root
- Warnings: 41 (mostly `any` types and non-null assertions)
- Errors: 0

### Generated Applications

#### Next.js Applications
- **Config**: `packages/generator/templates/nextjs/config/.eslintrc.cjs`
- **Rules**: React, React Hooks, Next.js core web vitals
- **Build command**: `bun run build` (includes lint)
- **Lint command**: `bun run lint`

#### NestJS Applications
- **Config**: `packages/generator/templates/nestjs/config/.eslintrc.cjs`
- **Rules**: TypeScript strict, async/await safety
- **Build command**: `bun run build` (includes lint)
- **Lint command**: `bun run lint`

#### OData V4 Applications
- **Config**: `packages/generator/templates/odata/config/.eslintrc.cjs`
- **Rules**: TypeScript, Node.js best practices
- **Build command**: `bun run build` (includes lint)
- **Lint command**: `bun run lint`

#### OpenUI5 Applications
- **Config**: `packages/generator/templates/ui5/config/.ui5lintrc.json`
- **Rules**: UI5 specific (no deprecated API, proper flags, module patterns)
- **Build command**: `bun run build` (includes ui5lint)
- **Lint command**: `bun run lint` (uses ui5lint)

## Environment

- **Runtime**: Bun 1.4.4
- **Node**: v20+
- **TypeScript**: 5.9.3
- **ESLint**: 8.57.1
- **Next.js**: 14.2.35

## Troubleshooting

### Build Issues

If build fails:

```bash
# Clean and rebuild
bun run clean
bun install
bun run build
```

### Port Already in Use

```bash
# Find and kill process using port 3000
lsof -ti:3000 | xargs kill -9

# Or use a different port
PORT=3001 bun run dev
```

### Type Errors

```bash
# Run type check to see all errors
bun run type-check

# Auto-fix lint issues
bun run lint:fix
```

### Development Server Not Responding

```bash
# Check if server is running
curl http://localhost:3000

# Check process
ps aux | grep "bun.*dev"

# Check port usage
lsof -i:3000

# View logs
tail -50 /tmp/appwithai-web.log

# Restart if needed
lsof -ti:3000 | xargs kill -9 && bun run dev
```

---

**Version**: 5.1.0
**Last Updated**: February 2026
**Build Status**: ✅ PASSING
