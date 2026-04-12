# unictl Standalone Docs

이 디렉터리는 `unictl` 단독배포에서 integration pack이 공통으로 참조하는 문서 source다.

원칙:

- Codex plugin과 Claude Code support pack은 이 디렉터리 내용을 generated copy로 포함한다.
- 설치와 워크플로우의 단일 source of truth는 여기다.
- tool-specific wrapper 문서는 pack 내부에 둘 수 있지만, 공통 설명을 각 integration이 따로 소유하지 않는다.

현재 `0.1.x` 기준 공통 흐름:

1. `bunx github:OWNER/REPO#vX.Y.Z version`
2. `bunx github:OWNER/REPO#vX.Y.Z init --project /ABS/PATH/TO/PROJECT --repo-url https://github.com/OWNER/REPO --dry-run`
3. `bunx github:OWNER/REPO#vX.Y.Z doctor --project /ABS/PATH/TO/PROJECT`
4. `bunx github:OWNER/REPO#vX.Y.Z editor status --project /ABS/PATH/TO/PROJECT`
5. 필요 시 `command capture_ui`, `command ui_toolkit_input`로 검증 루프를 수행

상세 워크플로우는 [WORKFLOWS.md](WORKFLOWS.md)를 본다.
