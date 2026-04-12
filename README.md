# unictl

`unictl`은 Unity Editor를 CLI 기반 인터페이스로 제어하고 확장하는 standalone 도구입니다.

구성:

- root package: GitHub tag-pinned `bunx` 진입점
- `packages/cli`: CLI source
- `packages/upm/com.unictl.editor`: Unity UPM editor package
- `native/unictl_native`: Rust native bridge
- `integrations/`: Codex / Claude Code thin wrapper source

빠른 참고:

- 소비자 가이드: [docs/standalone/consumer-guide.md](docs/standalone/consumer-guide.md)
- 개발자 세팅: [docs/standalone/development-setup.md](docs/standalone/development-setup.md)
- 고정 스펙: [docs/standalone/standalone-0.1-spec.md](docs/standalone/standalone-0.1-spec.md)
