# QA of the generated app's rule and workflow editors

Drives a running generated application (default `http://localhost:4000`, admin
sign-in) through the API paths its editors use. Not the `gstack` `/qa` skill.

| Script | What it does |
|---|---|
| `run-rules.ts` | 60 rules (`rules-catalog.ts`, R01–R60): creates, updates, simulates, attaches, then writes real records and checks the verdict; deactivates and deletes |
| `run-workflows.ts` | 61 workflows (`workflows-catalog.ts`, W01–W61): creates, publishes, runs on real writes, checks the records and run history; edits and deletes |
| `cleanup.ts` | Removes anything a failed run left behind |

```bash
GEN_DIR=/path/to/generated-app bun run-rules.ts      # GEN_URL, GEN_EMAIL, GEN_PASSWORD optional
GEN_DIR=/path/to/generated-app bun run-workflows.ts
```

Generate the CRM model (`language/examples/crm.eml.mmd`) first. The editors' real
canvas is driven by `scripts/e2e-rules-workflows/specs/10` and `11`.
