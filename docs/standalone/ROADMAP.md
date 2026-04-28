# unictl Roadmap

`v0.5.0` 시점 기준 후속 로드맵. 확정된 방향과 아이디어 수준을 분리한다.

## 현재 릴리즈 — `v0.6.1`

배포 완료 항목 (전체 목록은 [CHANGELOG.md](../../CHANGELOG.md)):

### v0.5.0 (Discoverability 완성)

- `--json` machine-readable help: `unictl --help`와 모든 서브커맨드 `--help`에 구조화 JSON 출력
- `hint_command` 런타임 emit: 모든 `errorExit(...)`가 `error-registry.json`의 hint를 응답에 자동 포함
- Cross-OS drift check 확장: `check:error-registry`를 ubuntu/macos/windows 모두에서 실행
- Release-rehearsal content assertion + file-count data-driven + cleanup 명시 실패
- Windows `wmic` ENOENT graceful + CIM empty-stdout 처리
- `-projectpath` 대소문자 매칭 (Unity Hub 호환)
- `compile` 출력 자기모순 버그 수정 (object spread 순서)
- 릴리즈 자동화: `release.ts`가 CHANGELOG `[Unreleased]` → `[<version>] - <date>` 자동 승격 + ROADMAP 헤더 자동 갱신

### v0.4.0 (Release infrastructure)

- 통합 릴리즈 드라이버 (`scripts/release.ts` ↔ `assemble.ts`), `--dry-run` 플래그, idempotency guard, CHANGELOG 검증
- orphan-tag 제거: 릴리즈 순서 재설계 (commit → npm publish → push main → tag → push tag) + partial-release 복구 계약
- 통합 팩 메타데이터 version-matched + `integrations/_template/` 스캐폴더
- `CHANGELOG.md`, `MIGRATION.md`, `DEPRECATION.md`, `docs/standalone/release-process.md`
- UnityLockfile 경로 단일 helper (`process.ts:getUnityLockfilePath`)
- Windows 프로세스 탐색: PowerShell `Get-CimInstance` 우선 + `wmic` 레거시 fallback + ENOENT graceful degradation
- 에러 taxonomy 통합: `error-registry.json` + CI drift check (CLI ∪ C# ⊆ registry)
- `doctor` + `compile` typed error kinds
- 오프라인 발견성: `unictl capabilities` 서브커맨드 + 핸드-메인 JSON
- CI smoke workflow (3-OS) + release-rehearsal workflow
- `docs/standalone/security-model.md`
- 0.1-era 문서 5개 아카이브 + 6개 live 문서 재작성

설계 기록: plan v4.3 + 4차례 Codex 외부 리뷰 (holistic → plan v1 → plan v2.1 → release-readiness). 내부 기록은 PickUpCat 레포의 `.omc/plans/`에 위치하며 npm tarball에는 포함되지 않는다.

---

## v0.4.x — Patch (완성도 보강)

신규 기능 없이 현재 동작 견고성 개선. `CHANGELOG.md [Unreleased]`에 이미 수집 중인 fix 2건 + 이 버킷 항목으로 구성한다.

- **[Unreleased에 누적 중] CI smoke workflow standalone repo 호환**
  - `bun run unictl -- ...` 패턴이 standalone repo 루트 `package.json` scripts에 없던 이슈. 추가 완료.
- **[Unreleased에 누적 중] Windows CIM empty-stdout + wmic ENOENT graceful handling**
  - Windows Server 2022+/Win11-최신에서 `wmic` 부재 시 `doctor`/`editor status`/`health`가 uncaught exception으로 크래시하던 문제. `[]` 반환으로 완화.

### 남은 항목 (다음 패치 대상)

- **`BuildProfileAdapter.IsValidProfileAsset` 경로 처리 정리**
  - 현재 `File.Exists(assetPath)` 사용 → 프로젝트 root 외 작업 디렉터리에서 false negative 가능.
  - 해결: `AssetDatabase.LoadAssetAtPath` 단일 경로로 일원화. 호출처가 추가될 때 활성화.
  - 영향: latent. 현 릴리즈에서 호출처 없음.

- **UNC 경로 명시 가드 (`--build-profile`)**
  - Windows `\\server\share\...` 경로가 `replace(/\\/g, "/")`로 `//server/share/...`가 되어 Unity 배치모드에 그대로 전달됨.
  - 해결: `raw.startsWith("\\\\")` 감지 시 `profile_invalid_path` exit 2로 즉시 거부.
  - 현실적 필요도: Windows CI/CD 엣지 케이스.

---

## v0.5.0 — Minor (Discoverability 완성) ✅ 배포 완료

오프라인 발견성의 남은 절반 + v0.4.0 작업 중 드러난 CI 견고성 항목.

- **`--json` machine-readable help (F2 from v0.4.0 plan, deferred)**
  - `unictl build --help --json`, `unictl --help --json` 등 구조화 출력.
  - 에이전트가 정규식 파싱 없이 flag 스키마를 그대로 사용 가능.

- **`hint_command` 런타임 emit**
  - `error-registry.json`은 이미 per-kind `hint_command` 값을 보유. CLI의 `errorExit(...)` 응답에 이 필드를 실제로 포함시키는 wiring이 필요.
  - 현 상태: 데이터는 있으나 응답 JSON엔 나오지 않음. 에이전트가 기계 실행 가능한 복구 스니펫 사용 못 함.

- **Cross-OS drift check 확장**
  - `.github/workflows/smoke.yml`의 `check:error-registry` 스텝이 Linux only (`if: runner.os == 'Linux'`). CRLF / 경로 / encoding 드리프트는 Windows/macOS에서만 드러날 수 있음.
  - 해결: 3-OS 모두 활성화.

- **Release-rehearsal 강화**
  - 현재 `release-rehearsal.yml`은 `.tmp/phase-e-release/` 디렉터리 존재만 확인 (`ls -la`). `assemble.ts`가 빈 디렉터리만 만들어도 그린.
  - 해결: checksum 파일 존재, `plugin.config.json` 플레이스홀더 치환, 템플릿 완전 채움 등 content-level assertion 추가.

- **Release-rehearsal 파일 수 data-driven**
  - 현재 `"$changed" -ne "6"` 하드코딩. 새 version-synced 파일을 추가하면 rehearsal이 무음으로 깨짐.
  - 해결: `scripts/release.ts`의 sync 리스트를 읽거나 별도 manifest 파일로 source-of-truth 통일.

- **Cleanup 에러 명시화**
  - 현재 `|| true`로 에러 무음 처리. 실패해도 job 그린.
  - 해결: 실패 시 `git status --porcelain` 확인 후 dirty면 명시적 실패.

---

## v0.6.0 — Test Runner Editor Lane ✅ 배포 완료

`unictl test` 실행 시 에디터가 실행 중이면 IPC로 `TestRunnerApi`를 호출 (editor lane).
batchmode 대비 새 Unity 프로세스 띄우는 비용 없음.

### 출시 항목
- editor lane (EditMode + PlayMode with DisableDomainReload)
- progress file 기반 비동기 결과 수신 (`Library/unictl-tests/<job-id>.json`)
- Preflight 8종 + 단일 활성 job 강제 (`test_already_running`)
- Domain reload 횡단 미지원 (PlayMode + Full Reload 거부: `editor_reload_active`)
- 11종 신규 에러 kind (editor_busy_*, editor_dirty_*, editor_died, editor_session_changed, test_heartbeat_stale)
- `UnictlServer.SessionId` (UUID v4) — 에디터 세션 교체 감지
- `--allow-unsaved-scenes`, `--allow-reload-active` 플래그

### 검증
- PoC-1, 2, 5a, 5b, 8 통과
- `Assets/Editor/UnictlPoc/` + `Assets/Tests/UnictlPoc(PlayMode)/`
- v2 설계 + Codex 외부 리뷰 2회 (Conditional → Conditional)

---

## v0.7.0+ — 미래 후보 (아이디어 단계)

확정 전이며 우선순위 미지정. 실제 수요 발생 시 승격.

- **P2a.2 2-phase Prepare/Resume — target / scripting-define 스위치**
  - 현재 v4.3 제약: target 또는 define 변경 시 에디터 재시작 또는 `--batch` 필요 (IPC 레인은 domain reload 횡단 불가).
  - 후보: `[InitializeOnLoad]` 마커 파일 + `EditorApplication.wantsToQuit` 가드 + `File.Replace` 아토믹 진행 파일 — v4.1 시절 설계 부활, 단 v4.3이 증명한 단순 원칙 유지.

- **Strict-mode hook audit (opt-in `--strict-hooks`)**
  - Third-party `IPostprocessBuildWithReport`가 `EditorApplication.Exit` 호출하는지 TypeCache + `Mono.Cecil` IL 스캔.
  - 기본은 off (Known Limitation 1 수용). CI 엄격성 요구 사용자만 활성화.
  - Mono.Cecil 의존성 추가 필요 → UPM 패키지 크기 증가 트레이드오프 검토.

- **Docs maturity**: 영문/한국어 통합 인덱스, localized user guide, consolidated reference index.
- **Multi-project concurrent builds 지원**: UnityLockfile 원천 차단 완화 (per-project lock 전략 재검토).
  - 참고: `UnityLockfile`은 Unity 에디터 자체가 `<projectRoot>/Library/UnityLockfile`에 생성하는 락 파일이며 unictl이 만드는 락이 아니다. 동일 프로젝트의 Unity 동시 오픈을 엔진 차원에서 막기 때문에, 워크트리/복제 기반 동시 빌드 전략이 필요하다.

---

## 계획 없음 (Known Limitations 수용)

plan v4.3 §0.3 "Known Limitations"과 일치. 사용자가 명시적으로 재평가를 요청하지 않는 한 재개 안 함.

1. Third-party `EditorApplication.Exit(int)` 호출 방어 — IPC 레인 인프로세스 차단 불가. 회피는 `--batch`.
2. Running 단계 `build_cancel` — Unity `BuildPipeline.BuildPlayer`에 interrupt API 없음.
3. 비-terminal 진행 파일 자동 복구 — `Library/unictl-builds/` 수동 청소.
4. 동일 프로젝트 다중 unictl-배치 Unity 동시 기동 — UnityLockfile이 원천 차단.

---

## 기여와 우선순위

- 각 항목의 채택 순서는 사용자 피드백과 실제 문제 발생 빈도로 결정.
- 신규 아이디어는 GitHub Issues에 올리고, 확정된 설계 결정은 이 문서에 반영한다.
- 내부 설계 기록 (plan v4.3 + Codex 리뷰 히스토리)은 PickUpCat 소비자 레포의 `.omc/plans/` 에 위치하며, npm tarball에는 포함되지 않는다. 배포 독자성이 깨지지 않도록 외부 docs에서는 요약 + CHANGELOG 참조로 충분하게 유지한다.
