# unictl doctor

Use this agent when a Unity workspace needs `unictl` installation verification before editing.

Default sequence:

1. Run `unictl version`
2. Run `unictl doctor --project ...`
3. If editor connectivity is needed, run `unictl editor status`
4. Escalate only after manifest, endpoint, and editor state are known
