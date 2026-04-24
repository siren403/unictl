# unictl Roadmap

`v0.3.0` 시점 기준 후속 로드맵. 확정된 방향과 아이디어 수준을 분리한다.

## 현재 릴리즈 — `v0.3.0`

배포 완료 항목:

- `build_project` 빌트인 (IPC + 배치모드 듀얼 레인, WebForge 패턴)
- `build_cancel` queue-stage 협조적 취소
- BuildProfile (Unity 6+) via `-activeBuildProfile` CLI 플래그
- 빌드 메타데이터 (output_kind / size / sha256 / manifest_sha256)
- `unictl compile` — 헤드리스 배치모드 컴파일 + `.meta` 생성

설계 기록: plan v4.3, 두 차례 외부 리뷰 (내부 code-reviewer + Codex) 통과.

---

## v0.3.x — Patch (완성도 보강)

신규 기능 없이 현재 동작 견고성만 개선한다.

- **`BuildProfileAdapter.IsValidProfileAsset` 경로 처리 정리**
  - 현재 `File.Exists(assetPath)` 사용 → 프로젝트 root 외 작업 디렉터리에서 false negative 가능.
  - 해결: `AssetDatabase.LoadAssetAtPath` 단일 경로로 일원화. 호출처가 추가될 때 활성화.
  - 영향: latent. 현 릴리즈에서 호출처 없음.

- **UNC 경로 명시 가드 (`--build-profile`)**
  - Windows `\\server\share\...` 경로가 `replace(/\\/g, "/")`로 `//server/share/...`가 되어 Unity 배치모드에 그대로 전달됨.
  - 해결: `raw.startsWith("\\\\")` 감지 시 `profile_invalid_path` exit 2로 즉시 거부.
  - 현실적 필요도: Windows CI/CD 엣지 케이스.

---

## v0.4.0 — Minor (발견성 강화)

에이전트 워크플로우의 가장 큰 남은 갭. 에디터 기동 없이도 도구 스키마를 조회할 수 있도록 한다.

- **`unictl capabilities` 오프라인 caps JSON**
  - 에디터 IPC 연결 없이 CLI 레벨에서 빌트인 도구 목록, 파라미터 스키마, exit code 표, known limitations 출력.
  - 정적 메타데이터는 `packages/cli/src/capabilities.json`에 두고 릴리즈 시 CI가 UPM 어셈블리에서 추출하도록 하는 방안 검토.
  - 현 제약: `unictl command list`는 Unity runtime 속성 스캔 의존 → 에디터 꺼짐 상태에선 `Failed to reach unictl endpoint` 오류.

- **`--json` machine-readable help**
  - `unictl build --help --json`, `unictl --help --json` 등 구조화 출력.
  - 에이전트가 정규식 파싱 없이 flag 스키마를 그대로 사용 가능.

- **에러 응답 `hint_command` 필드**
  - `hint` 텍스트와 별도로, 복구용 정확한 명령줄 스니펫을 기계가 바로 실행할 수 있게 제공.
  - 예: `{"kind": "profile_switch_requires_batch", "hint_command": "unictl build --target X --build-profile Y.asset --batch"}`.

---

## v0.5.0 — Minor (Lane parity 복구)

plan v4.3에서 의도적으로 제거된 기능을 선택적으로 재도입한다. 모두 opt-in.

- **P2a.2 2-phase Prepare/Resume — target / scripting-define 스위치**
  - 현재 v4.3 제약: target 또는 define 변경 시 에디터 재시작 또는 `--batch` 필요 (IPC 레인은 domain reload 횡단 불가).
  - 후보: `[InitializeOnLoad]` 마커 파일 + `EditorApplication.wantsToQuit` 가드 + `File.Replace` 아토믹 진행 파일 — v4.1 시절 설계 부활, 단 v4.3이 증명한 단순 원칙 유지.
  - 범위가 커서 단일 마이너 릴리즈 하나에 집중.

- **Strict-mode hook audit (opt-in `--strict-hooks`)**
  - Third-party `IPostprocessBuildWithReport`가 `EditorApplication.Exit` 호출하는지 TypeCache + `Mono.Cecil` IL 스캔.
  - 기본은 off (Known Limitation 1 수용). CI 엄격성 요구 사용자만 활성화.
  - Mono.Cecil 의존성 추가 필요 → UPM 패키지 크기 증가 트레이드오프 검토.

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
- 내부 설계 기록 전문은 `plan v4.3` (PickUpCat 프로젝트의 `.omc/plans/unictl-build-project-v4.md`).
