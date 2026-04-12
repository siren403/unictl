# com.unictl.editor

`com.unictl.editor` is the Unity-side editor package for `unictl`.

It is the part that consumer Unity projects install through UPM, while operators and agents use the CLI through `bunx github:OWNER/REPO#vX.Y.Z ...`.

Scope of this package:

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

Naming contract for `0.1.x`:

- product name: `unictl`
- public UPM package id: `com.unictl.editor`
- UPM display name: `Unictl Editor`

This package intentionally stays lightweight enough to compile without `com.unity.test-framework`.
