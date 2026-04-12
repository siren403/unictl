# com.unictl.core

Embedded prototype of the `unictl` core UPM package.

Scope of this package prototype:

- editor server and router
- native plugin bridge
- core built-in tools:
  - `ping`
  - `editor_control`
  - `capture_ui`
  - `ui_toolkit_input`

Explicitly out of core package scope for `0.1.x`:

- playmode test orchestration
- automation profile features
- profiler diagnostics add-ons

This prototype intentionally keeps the package lightweight enough to compile without `com.unity.test-framework`.
