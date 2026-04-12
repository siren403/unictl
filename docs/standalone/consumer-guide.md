# unictl 소비자 가이드

이 문서는 `unictl`을 제품으로 소비하는 Unity 프로젝트 입장에서 필요한 설치와 사용 흐름을 정리한다.

`unictl` 자체를 개발하는 사람은 [DEVELOPMENT_SETUP.md](development-setup.md)를 본다.

중요:

- 이 문서는 `0.1.x` 목표 UX를 기준으로 정리한 소비자 가이드다.
- 현재 Queenzle 내부 구현은 dogfooding 프로토타입이므로, 실제 배포 저장소 기준 경로와 명령은 별도 `unictl` 저장소를 기준으로 본다.

## 1. unictl이 제공하는 것

`unictl`은 Unity Editor를 CLI 기반 인터페이스로 제어하고 확장하는 도구다.

소비자 프로젝트 입장에서는 아래 두 축으로 생각하면 된다.

1. Unity 프로젝트 안에 들어가는 것
- UPM 패키지 `com.unictl.editor`
- built-in `UnictlTool`
- 플랫폼별 native plugin

2. 작업자 머신에서 실행하는 것
- `bunx github:OWNER/REPO#vX.Y.Z ...` 형태의 CLI

즉, 프로젝트에는 UPM 패키지가 들어가고, 사람이나 에이전트는 `bunx`로 CLI를 실행한다.

## 2. 0.1.x 전제 조건

- Unity Editor 프로젝트가 있어야 한다.
- 프로젝트에 Git 기반 UPM dependency를 추가할 수 있어야 한다.
- 작업자 머신에 Bun이 설치되어 있어야 한다.
- macOS와 Windows x64를 `0.1.x` 지원 범위로 본다.

## 3. 설치 구조

명칭 규칙:

- 제품 이름은 `unictl`이다.
- Unity 프로젝트가 설치하는 public UPM package id는 `com.unictl.editor`다.
- Unity Package Manager에서 보이는 이름은 `Unictl Editor`로 고정한다.
- 작업자 머신에서 실행하는 CLI 이름은 `unictl`이다.

### 3.1 프로젝트 설치

소비자 프로젝트는 `Packages/manifest.json`에 `com.unictl.editor`를 추가한다.

목표 형태:

```json
{
  "dependencies": {
    "com.unictl.editor": "REPO_GIT_URL.git?path=/packages/upm/com.unictl.editor#vX.Y.Z"
  }
}
```

원칙:

- `com.unictl.editor`는 Unity 프로젝트 안의 editor package이며, 기본 서버와 built-in tool을 제공한다.
- 프로젝트 고유 명령은 소비자 프로젝트가 자체 `[UnictlTool]` 클래스로 추가한다.

### 3.2 CLI 사용

운영 진입점은 아래처럼 tag-pinned `bunx`다.

```bash
bunx github:OWNER/REPO#vX.Y.Z health --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z list --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z editor status --project /ABS/PATH/TO/PROJECT
```

## 4. 기본 사용 흐름

### 4.1 연결 확인

가장 먼저 아래 둘을 본다.

```bash
bunx github:OWNER/REPO#vX.Y.Z health --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z list --project /ABS/PATH/TO/PROJECT
```

- `health`는 endpoint와 서버 상태를 확인한다.
- `list`는 built-in tool과 프로젝트 확장 tool 목록을 확인한다.

### 4.2 에디터 프로세스 제어

기본 editor 명령은 아래 네 개다.

```bash
bunx github:OWNER/REPO#vX.Y.Z editor open --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z editor status --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z editor restart --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z editor quit --project /ABS/PATH/TO/PROJECT
```

기본 원칙:

- 프로젝트당 editor session은 하나만 지원한다.
- CLI는 `.unictl/endpoint.json`을 통해 현재 세션을 찾는다.
- Windows에서는 새 `open` 또는 `restart`마다 새 token이 발급된다.

### 4.3 built-in tool 사용

`0.1.x` core built-in contract는 아래 네 개다.

- `ping`
- `editor_control`
- `capture_ui`
- `ui_toolkit_input`

대표 예시:

```bash
bunx github:OWNER/REPO#vX.Y.Z command ping --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z command editor_control -p action=compile --project /ABS/PATH/TO/PROJECT
echo '{"output_path":".screenshots/capture.png"}' | bunx github:OWNER/REPO#vX.Y.Z command capture_ui --project /ABS/PATH/TO/PROJECT
echo '{"action":"click","type":"Button","text":"+ Increment"}' | bunx github:OWNER/REPO#vX.Y.Z command ui_toolkit_input --project /ABS/PATH/TO/PROJECT
```

### 4.4 버전, 진단, 설치 보조 명령

CLI 제품 표면에는 아래 보조 명령도 포함된다.

```bash
bunx github:OWNER/REPO#vX.Y.Z version
bunx github:OWNER/REPO#vX.Y.Z doctor --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z init --project /ABS/PATH/TO/PROJECT --repo-url https://github.com/OWNER/REPO --dry-run
```

원칙:

- `version`은 CLI와 embedded core package 버전 메타데이터를 보여준다.
- `doctor`는 설치, manifest, endpoint, editor reachability를 점검한다.
- `init`은 먼저 `--dry-run`으로 계획을 확인한 뒤 실제 쓰기를 수행하는 흐름을 권장한다.

## 5. 소비자 프로젝트가 확장하는 방법

`unictl`의 core contract 밖 명령은 소비자 프로젝트 안에서 직접 확장한다.

원칙:

- public extension surface는 `[UnictlTool]`이다.
- 프로젝트 고유 자동화, 게임 로직 특화 명령, 진단용 실험 명령은 소비자 프로젝트가 소유한다.
- `0.1.x`에서 core contract에 없는 기능을 강제로 core에 넣지 않는다.

## 6. 권장 운영 루프

1. `health`와 `list`로 연결 상태를 확인한다.
2. 필요하면 `editor open`으로 에디터를 띄운다.
3. 에디터 상태 전환은 `editor_control`로 수행한다.
4. UI 확인은 `capture_ui`와 `ui_toolkit_input`으로 수행한다.
5. 문제가 있으면 `doctor`로 설치, 버전, endpoint 상태를 점검한다.

## 7. 문제 해결 포인트

### 7.1 `health` 실패

가능한 원인:

- 에디터가 아직 완전히 올라오지 않음
- stale `.unictl/endpoint.json`
- 프로젝트 경로 불일치
- Windows에서는 token mismatch

우선 조치:

```bash
bunx github:OWNER/REPO#vX.Y.Z editor status --project /ABS/PATH/TO/PROJECT
bunx github:OWNER/REPO#vX.Y.Z doctor --project /ABS/PATH/TO/PROJECT
```

### 7.2 `init` 재실행

`init`은 `com.unictl.editor` 항목만 관리하는 보수적 명령으로 본다.

원칙:

- unrelated dependency는 보존해야 한다.
- 같은 명령을 두 번 실행해도 결과가 망가지면 안 된다.
- custom ref를 덮어써야 할 때만 `--force`가 필요하다.

현재 embedded prototype 메모:

- 현재 Queenzle 안의 프로토타입 CLI에서는 `--repo-url` 또는 `--package-ref`를 주는 경로를 권장한다.
- 이 워크스페이스 안에서만 검증할 때는 local prototype package reference로 fallback 할 수 있다.

예시:

```bash
bunx github:OWNER/REPO#vX.Y.Z init --project /ABS/PATH/TO/PROJECT --repo-url https://github.com/OWNER/REPO --dry-run
bunx github:OWNER/REPO#vX.Y.Z init --project /ABS/PATH/TO/PROJECT --package-ref file:/ABS/PATH/TO/packages/upm/com.unictl.editor --dry-run
```

## 8. 플랫폼 메모

- macOS `0.1.x`는 Unix socket 기반 연결을 사용한다.
- Windows `0.1.x`는 loopback TCP + `X-Unictl-Token` 기반 연결을 사용한다.
- Linux Editor 지원은 `0.1.x` 범위가 아니다.

## 9. 에이전트 통합 패키지

`0.1.x`에서는 Codex plugin과 Claude Code support pack을 thin wrapper로 제공한다.

원칙:

- 공통 설치/워크플로우 문서는 `docs/standalone/` source에서 생성된다.
- integration pack은 `doctor`, `editor`, built-in tool workflow만 얇게 감싼다.
- 프로젝트 고유 규칙이나 자동화는 소비자 저장소가 소유한다.

예상 산출물:

- `codex-plugin-X.Y.Z.zip`
- `claude-code-support-X.Y.Z.zip`
