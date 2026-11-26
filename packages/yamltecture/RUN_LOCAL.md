# Run the integrated package

From the application repository root, install the pinned workspace dependencies with `bun install --frozen-lockfile`.

- Unit and local model compatibility tests: `bun --filter @appwithai/yamltecture test`
- Package type check: `bun --filter @appwithai/yamltecture typecheck`
- Application type check: `bun run type-check`
- Project a model: `bun packages/yamltecture/scripts/project-eml.ts examples/drug-discovery.eml.mmd /tmp/model.ai.yaml`
- Inspect a model: `bun packages/yamltecture/scripts/inspect-eml.ts examples/drug-discovery.eml.mmd`

The repository pins Bun 1.4.4. Unit tests are local. `test:website` is an optional network check of published examples; it is not required by the application and was not run for this integration.

Git helpers take a host-supplied port. They cannot directly initialize or commit a repository. The web application's project repository service supplies access checks, locking, recovery, and commits.
