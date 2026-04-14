# unictl

`unictl`은 Unity Editor를 CLI 기반 인터페이스로 제어하고 확장하는 standalone 도구입니다.

## Quick Start

### 1. CLI 실행 (bunx)

Bun이 설치되어 있으면 별도 설치 없이 바로 실행할 수 있습니다:

```bash
# 최신 버전 실행
bunx unictl health

# 특정 버전 실행
bunx unictl@0.1.0 health

# GitHub repo에서 직접 실행
bunx github:siren403/unictl health
```

주요 커맨드:

```bash
bunx unictl health                              # 에디터 연결 확인
bunx unictl list                                # 등록된 도구 목록
bunx unictl editor status                       # 에디터 프로세스 상태
bunx unictl editor_control -p action=compile    # 컴파일 트리거
bunx unictl doctor                              # 설치 진단
```

### 2. Unity UPM 패키지 설치

Unity Editor 패키지(`com.unictl.editor`)를 프로젝트에 설치하는 방법:

#### Git URL (권장)

`Packages/manifest.json`에 추가:

```json
{
  "dependencies": {
    "com.unictl.editor": "https://github.com/siren403/unictl.git?path=packages/upm/com.unictl.editor"
  }
}
```

특정 버전을 고정하려면 태그를 지정:

```json
{
  "dependencies": {
    "com.unictl.editor": "https://github.com/siren403/unictl.git?path=packages/upm/com.unictl.editor#v0.1.0"
  }
}
```

#### unictl init (CLI로 자동 설정)

```bash
# repo URL로 설치
bunx unictl init --repo-url https://github.com/siren403/unictl.git

# 특정 버전
bunx unictl init --repo-url https://github.com/siren403/unictl.git --version 0.1.0

# 변경 내용 미리 보기
bunx unictl init --repo-url https://github.com/siren403/unictl.git --dry-run
```

#### 로컬 파일 경로 (개발용)

서브모듈이나 로컬 클론으로 개발할 때:

```json
{
  "dependencies": {
    "com.unictl.editor": "file:../tools/unictl/packages/upm/com.unictl.editor"
  }
}
```

> **요구사항**: Unity 6000.0+, `com.unity.nuget.newtonsoft-json` 3.2.1+

## 구성

- root package: GitHub tag-pinned `bunx` 진입점
- `packages/cli`: CLI source
- `packages/upm/com.unictl.editor`: Unity UPM editor package
- `native/unictl_native`: Rust native bridge
- `integrations/`: Codex / Claude Code thin wrapper source

## 참고 문서

- 소비자 가이드: [docs/standalone/consumer-guide.md](docs/standalone/consumer-guide.md)
- 개발자 세팅: [docs/standalone/development-setup.md](docs/standalone/development-setup.md)
- 고정 스펙: [docs/standalone/standalone-0.1-spec.md](docs/standalone/standalone-0.1-spec.md)
