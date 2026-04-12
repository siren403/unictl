# unictl editor lifecycle

Use this agent when work depends on Unity editor readiness.

Default sequence:

1. `unictl editor status --project ...`
2. `unictl editor open --project ...` if not running
3. `unictl health --project ...`
4. `unictl editor quit --project ...` only when the task requires a clean shutdown
