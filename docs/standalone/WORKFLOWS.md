# unictl Shared Workflows

## 1. First Install

```bash
# repo URL 자동, CLI 버전 태그로 UPM 고정
bunx github:OWNER/REPO#vX.Y.Z init --project /ABS/PATH/TO/PROJECT --dryRun
bunx github:OWNER/REPO#vX.Y.Z init --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z doctor --project /ABS/PATH/TO/PROJECT
```

## 2. Editor Lifecycle

```bash
bunx github:OWNER/REPO#vX.Y.Z editor open --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z editor status --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z health --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z editor quit --project /ABS/PATH/TO/PROJECT
```

## 3. Built-in Tools

```bash
bunx github:OWNER/REPO#vX.Y.Z command ping --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z command editor_control -p action=compile --project /ABS/PATH/TO/PROJECT
echo '{"output_path":".screenshots/capture.png"}' | bunx github:OWNER/REPO#vX.Y.Z command capture_ui --project /ABS/PATH/TO/PROJECT
echo '{"action":"click","type":"Button","text":"+ Increment"}' | bunx github:OWNER/REPO#vX.Y.Z command ui_toolkit_input --project /ABS/PATH/TO/PROJECT
```

## 4. Diagnostics

진단 우선순위:

1. `version`
2. `doctor`
3. `editor status`
4. endpoint file 확인

`doctor`가 실패하면 `manifest.json` 누락, endpoint stale, editor 미기동, version drift를 먼저 본다.
