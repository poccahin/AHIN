# Blue Water Legacy Slot

`scripts/backup_and_restructure_chippmf.sh` copies chippmf UI, hooks, and page views into `src/agents/blue_water/legacy`.

The files in this Agent cluster must not initiate wallet prompts, asset checks, or entry-fee transactions. They consume only the global session state exposed by the application shell.
