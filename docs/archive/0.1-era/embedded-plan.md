# unictl 설계 및 구현 계획

## 1. 배경 및 동기

현재 `unity-cli`(Go 바이너리) + `unity-cli-connector`(UPM 패키지) 구조의 한계:

| 문제 | 원인 |
|------|------|
| 프로토콜 불일치 | CLI와 커넥터가 개별 설치/업데이트 |
| 컴파일 중 연결 불가 | Domain Reload 시 C# HttpListener 소멸 |
| 폴링 의존 | heartbeat.json 0.5초 쓰기 + CLI에서 1초 읽기 |
| Play Mode 대기 지연 | `editor play --wait` → 120초 폴링 + 60초 UI 대기 |
| 디버깅 난이도 | Go 바이너리라 소스 없이 추적 불가 |

## 2. 설계 원칙

1. **CLI = stateless** — 데몬/서버 관리 불필요, fire-and-forget
2. **서버 = 에디터 라이프사이클** — 에이전트 세션과 무관, 에디터와 함께 시작/종료
3. **Domain Reload 불사** — Rust cdylib native plugin이 서버 앵커
4. **UPM 패키지 불필요** — `Assets/Editor/Unictl/`에 직접 배치
5. **단일 리포** — CLI + native + Unity 파일이 한 곳에서 버전 관리

## 3. 확정된 설계 결정

| 항목 | 결정 |
|------|------|
| 도구명 | `unictl` |
| 소켓 위치 | `{projectRoot}/.unictl/unictl.sock` |
| 어트리뷰트명 | `[UnictlTool]` |
| asmdef | `Unictl.Editor.asmdef` 별도 생성 |
| CLI 배포 (개발 중) | 프로젝트 로컬 (`bun run`) |
| CLI 배포 (0.1.0) | npm publish → `bunx unictl` / `npx unictl` |
| `unictl init` | 0.1.0 시점에 스캐폴딩 방식으로 결정 |
| unity-cli 병행 | 0.1.0 완료 시점에 마이그레이션 |
| Newtonsoft.Json | 커넥터 제거 후 직접 의존 추가 |
| native plugin DllImport명 | `unictl_native` |

## 4. 아키텍처

```
CLI (Bun/TS, stateless)                  Unity Editor Process
                                     ┌────────────────────────────┐
  HTTP req (Unix socket) ────────▶   │  Rust Native Plugin        │
  HTTP res ◀─────────────────────    │  (.bundle/.dll/.so)        │
  SSE stream ◀───────────────────    │  - tiny_http 서버           │
                                     │  - Domain Reload 무관      │
                                     │  - 요청 큐잉 (Reload 중)   │
                                     │         ↕ extern "C"       │
                                     │  C# (Assets/Editor/Unictl/)│
                                     │  - [InitializeOnLoad]      │
                                     │  - [UnictlTool] 라우팅     │
                                     │  - 에디터 이벤트 발행      │
                                     └────────────────────────────┘

소켓 경로: {projectRoot}/.unictl/unictl.sock
```

### 통신 프로토콜

- **명령**: `POST /command` → `{"id":"...","command":"list","params":{}}` → JSON 응답
- **대기 명령**: `POST /command` → 서버가 조건 충족까지 응답 보류 (long-poll)
- **이벤트**: `GET /events` → SSE (`text/event-stream`)
- **상태**: `GET /health` → 즉시 응답

### Domain Reload 시 동작

```
시간   Rust Native Plugin          C#                         CLI
──────────────────────────────────────────────────────────────────
정상    HTTP 수신 → C# 콜백 호출    처리 → unictl_respond 응답   요청/응답 ✓

── Domain Reload 시작 (beforeAssemblyReload → unregister) ──
+0ms   서버 살아있음                소멸됨 (handler=None)
+50ms  요청 수신 → 큐에 저장       (리로딩 중)                  (대기 중)

── Domain Reload 완료 ──
+200ms 서버 살아있음                [InitializeOnLoad] 재실행
       큐 flush → C# 콜백 호출     핸들러 재등록 → 처리         응답 수신 ✓
```

### 파일 구성

```
unictl/                                  # (현재 unity-bridge/, 리네임 예정)
├── PLAN.md                              # 이 문서
├── package.json                         # bun CLI (name: unictl)
├── src/                                 # Bun CLI
│   ├── cli.ts                           # 엔트리포인트
│   ├── socket.ts                        # 소켓 경로 계산
│   └── client.ts                        # HTTP 클라이언트
├── native/                              # Rust native plugin 소스
│   ├── Cargo.toml                       # cdylib, tiny_http 의존
│   └── src/
│       └── lib.rs                       # HTTP 서버 + extern "C" exports
├── scripts/
│   └── build.sh                         # cargo build + codesign
└── unity/                               # Unity 프로젝트에 배치될 파일들
    ├── Plugins/macOS/unictl_native.bundle
    └── Editor/Unictl/
        ├── Unictl.Editor.asmdef
        ├── UnictlNative.cs              # P/Invoke 바인딩
        ├── UnictlServer.cs              # 서버 라이프사이클 + 마샬링
        ├── ToolRouter.cs                # 명령 라우팅 + 도구 디스커버리
        └── UnictlToolAttribute.cs       # [UnictlTool] + 응답 타입 + 유틸
```

## 5. 기술 검증 체크리스트

### P0: 아키텍처 성립 조건 ✅ 전체 통과

- [x] **V1: Rust cdylib → Unity 로드** ✅ 2026-04-01
  - Rust `bridge_ping` → 42 반환, `[DllImport("unity_bridge")]` 성공
  - 바이너리 17KB (함수만), 443KB (tiny_http 포함)
  - macOS에서 `codesign -s -` ad-hoc 서명 필수 (없으면 CODESIGNING crash)

- [x] **V2: Domain Reload에 Rust 전역 상태 생존** ✅ 2026-04-01
  - `static AtomicI32` 카운터가 Domain Reload 후에도 누적 (count=1→2)
  - native plugin은 에디터 프로세스 수명과 동일, Reload에 영향 없음

- [x] **V3+V4: Rust std::thread HTTP 서버 + Unix domain socket** ✅ 2026-04-01
  - `tiny_http` + `ConfigListenAddr::unix_from_path()` 정상 동작
  - `curl --unix-socket <path> http://localhost/health` → JSON 응답
  - Domain Reload 후에도 서버 생존 확인

- [x] **V5: Rust→C# 콜백** ✅ 2026-04-01
  - `extern "C" fn` 함수 포인터 등록 → HTTP 요청 시 Rust에서 C# 호출 성공
  - `MonoPInvokeCallback` + 정적 delegate 참조로 GC 수집 방지
  - 주의: 콜백은 Rust HTTP 스레드에서 호출됨 → Unity API 직접 호출 불가

- [x] **V6: Domain Reload 후 콜백 재등록** ✅ 2026-04-01
  - `AssemblyReloadEvents.beforeAssemblyReload`에서 unregister 필수
  - 미해제 시 dangling pointer → 에디터 hang/crash
  - Reload 후 `[InitializeOnLoad]`에서 새 콜백 등록 → 정상 동작

### P1: 실용성 확인

- [x] **V7: 메인 스레드 마샬링** ✅ 2026-04-01
  - ConcurrentQueue + EditorApplication.update로 메인 스레드 실행
  - 채널을 콜백 호출 전에 등록 필수 (race condition 방지)
  - Unity API (Application.unityVersion, EditorApplication.isPlaying 등) 정상 호출 확인

- [ ] **V8: SSE 이벤트 스트림** → 구현 단계로 이연
  - Rust `GET /events` 엔드포인트 추가만으로 완결, C# 레이어와 독립
  - plugin 안정화에 영향 없음

- [x] **V9: Bun Unix socket fetch** ✅ 2026-04-01
  - `fetch("http://localhost/...", { unix: path })` — health, 동기, 비동기 3경로 모두 성공

- [x] **V10: 빌드 크기** ✅ 2026-04-01
  - `cargo build --release` → **443KB** (성공 기준 < 10MB 대비 대폭 여유)

### P2: 운영 안정성 → 구현 후 진행

- [ ] **V11: 에디터 종료/강제종료 시 소켓 정리**
- [ ] **V12: 다중 에디터 인스턴스**
- [ ] **V13: 장시간 안정성**

## 6. 구현 진행 상황

| Phase | 상태 | 비고 |
|-------|------|------|
| A: Rust plugin 리네이밍 | ✅ 완료 | unictl_native, .unictl/unictl.sock, build.sh |
| B: C# 프로덕션 파일 | ✅ 완료 | 4개 파일 + asmdef + PingTool |
| C: Bun CLI | ✅ 완료 | citty, -p/\@file/stdin, ProjectVersion.txt 탐색 |
| D0: editor_control | ✅ 완료 | play/stop/compile/restart/status, Rust MAIN_QUEUE |
| D0: read_console | 미진행 | |
| S: 도입 전 안정화 | ✅ 완료 | S1(코드정리) S2(Reload) S3(프로세스제어) |
| D1: 기존 도구 교체 | ✅ 완료 | [UnityCliTool] → [UnictlTool] |
| D2: 하네스 전환 | ✅ 완료 | run-ui-smoke.mjs → unictl |
| D3: 문서 업데이트 | ✅ 완료 | CLAUDE.md, AGENTS.md |
| D4: 커넥터 제거 | ✅ 완료 | manifest.json에서 제거, Newtonsoft.Json 직접 의존 |

## 7. 엣지케이스 분석

개발 중 반복적으로 발생하는 문제들. 0.1.0 전에 대응 방안 필요.

### EC1: EditorApplication.update 미실행

**현상**: 명령 전송 → Rust가 수신 → C# inbox에 enqueue → ProcessInbox가 안 돌아서 응답 없음 → 30초 타임아웃

**원인 후보**:
- ~~에디터 비포커스~~ (이전에 의심했으나, 실제 원인은 EC2였음)
- `QueuePlayerLoopUpdate`가 Rust 스레드에서 호출되어 콜백 크래시 (확인됨)
- safe mode 진입 시 `[InitializeOnLoad]` 미실행 가능
- Domain Reload 중 타이밍 이슈

**확인된 대응**:
- Rust 스레드에서 Unity API 호출 금지 (QueuePlayerLoopUpdate 포함)
- `/command`를 별도 스레드에서 처리하여 `/health` 블로킹 방지
- `list`는 동기 경로(Unity API 미사용)로 항상 동작

**추가 조사 필요**:
- 실제로 에디터 비포커스 시 update가 안 도는지 격리 테스트
- 안 돈다면: `SynchronizationContext.Post()` 또는 `EditorApplication.delayCall` 대안 검토
- 또는 CLI에서 `osascript` 자동 활성화

### EC2: Rust 스레드에서 Unity API 호출

**현상**: `QueuePlayerLoopUpdate()`, `EditorApplication.isPlaying` 등을 Rust 콜백(HTTP 스레드)에서 호출 시 `UnityException: can only be called from the main thread`

**규칙**: OnCommand 콜백에서는 **순수 데이터 조작만** (JSON 파싱, 큐 enqueue). Unity API는 반드시 ProcessInbox(메인 스레드)에서.

**예외**: `list` 명령의 리플렉션 스캔은 메타데이터 읽기만이라 허용.

### EC3: 컴파일 에러 → Safe Mode 팝업

**현상**: C# 컴파일 에러 시 에디터가 Safe Mode로 진입 → 팝업이 자동화 흐름 차단

**영향**:
- `[InitializeOnLoad]`가 실행되지 않을 수 있음 → unictl 서버 미등록
- CLI 명령이 타임아웃
- Ignore 선택 시에도 일부 어셈블리 미로드 가능

**대응 방안 (연구 필요)**:
- CLI에서 `-batchmode -nographics` 옵션으로 팝업 없이 컴파일 가능한지
- `unictl doctor`에서 컴파일 에러 사전 감지 (`.csproj` 파싱 또는 `dotnet build` 시도)
- 컴파일 에러 발생 시 CLI가 감지하고 에러 내용을 반환하는 경로

### EC4: 씬 복구 팝업

**현상**: 비정상 종료 후 에디터 재시작 시 "Scene backups detected" 팝업 → 자동화 흐름 차단

**원인**: `pkill -9` 등 강제 종료 시 씬 상태가 저장되지 않음

**추가 발견 (2026-04-01)**:
- `osascript -e 'tell application "Unity" to quit'` 시 `Temp/UnityTempFile-*` "No such file or directory" 팝업 발생
- "Try Again" / "Force Quit" 버튼 — 자동화 흐름에서 Force Quit 필요
- 첫 quit 요청이 무시되는 경우도 있음 (재시도 필요)

**대응 방안 (연구 필요)**:
- 에디터 종료 시 반드시 graceful shutdown (osascript quit + 종료 확인 대기)
- 강제 종료가 불가피할 때: 사전에 `EditorSceneManager.SaveOpenScenes()` 호출
- 재시작 전 `Temp/__Backupscenes/` 디렉토리 정리하면 팝업 회피 가능한지
- `-batchmode` 옵션으로 팝업 자체를 건너뛸 수 있는지
- `Temp/UnityTempFile-*` 사전 정리로 팝업 회피 가능한지

### EC5: 에디터 중복 실행

**현상**: 이전 에디터가 완전히 종료되기 전에 새 인스턴스 시작 → 2개 에디터가 같은 프로젝트를 열음

**영향**: 프로젝트 잠금 충돌, Library/ 캐시 손상 가능

**대응 방안**:
- `unictl editor open` 구현 시: PID 파일 또는 소켓 존재 확인 → 이미 실행 중이면 거부
- graceful shutdown 후 프로세스 완전 종료 확인 (`pgrep` 루프) → 타임아웃 후에만 재시작

### EC6: Domain Reload 경계에서의 요청 유실

**현상**: compile/play/stop 시 Domain Reload 발생 → C# 핸들러 해제 → Rust에 PENDING 큐잉 → Reload 완료 후 flush

**현재 동작**: PENDING 큐 + `unictl_register_handler` 시 flush로 대응됨 (검증 완료)

**잠재 위험**: flush 시 call_handler가 C# 콜백을 호출 → inbox enqueue → ProcessInbox 대기. 이 시점에 EditorApplication.update가 아직 등록 안 됐을 수 있음. 하지만 `[InitializeOnLoad]`에서 update 등록이 handler 등록과 같은 시점이므로 OK.

### EC7: EditorApplication.update Edit 모드 idle 문제

**현상**: Edit 모드에서 `EditorApplication.update`가 초기 3프레임 후 정지. inbox 처리 불가.

**원인**: Unity Edit 모드는 on-demand 렌더링. 상호작용 없으면 update 중단.
- 기존 unity-cli-connector는 .NET HttpListener의 IO 활동이 에디터 루프를 유지시킴
- Rust native plugin은 .NET 바깥이라 이 효과 없음

**트러블슈팅 과정 (2026-04-01 ~ 04-02)**:

1단계: C# 큐 인스턴스 불일치 발견
- `ConcurrentQueue<T> _inbox`의 `RuntimeHelpers.GetHashCode` 비교
- OnCommand(Rust 스레드): 850766432 ≠ OnUpdate(메인 스레드): 1358588210
- `MonoPInvokeCallback`이 Domain Reload 후 이전 도메인의 `static readonly` 필드 참조
- `Debug.Log`가 네이티브 콜백 스레드에서 출력 안 됨 → 파일 기반 로깅으로 진단

2단계: Rust MAIN_QUEUE 도입 → push/pop 불일치
- C# `_inbox` 제거, Rust `MAIN_QUEUE` (Vec<String>) + P/Invoke 도입
- push는 성공(C# 로그 확인)하나 pop이 빈 큐를 반환
- 원인: C#→Rust P/Invoke 재진입이 Mono에서 조용히 무시됨 (예외 없이 no-op)
- 해결: Rust `call_handler`에서 cb() 반환 후 **직접** MAIN_QUEUE에 push

3단계: main loop idle 문제 (unfocused에서 명령 미실행)
- Rust push + OnUpdate pop은 정상이나, unfocused 시 `EditorApplication.update` 자체가 멈춤
- 시도한 방법과 결과:
  - `QueuePlayerLoopUpdate()` from Rust thread → ❌ 메인 스레드 전용 API
  - `QueuePlayerLoopUpdate()` from .NET thread pool → ❌ 메인 스레드 전용 API
  - `RepaintAllViews()` from .NET thread pool → ❌ 메인 스레드 전용 API
  - `QueuePlayerLoopUpdate()` self-chain (main thread) → ⚠️ focused에서만 동작, unfocused 무효
  - `InteractionMode = No Throttle` → ⚠️ focused에서만 동작, unfocused 무효
  - `EditorWindow.OnInspectorUpdate` → ❌ 윈도우 생성/실행 불안정
  - .NET `TcpListener` wake 채널 → ❌ IO completion이 main loop을 깨우지 못함
  - .NET `HttpListener` 패시브 리스닝 → ❌ 존재만으로는 부족
  - .NET `HttpClient` self-ping → ❌ 효과 없음
  - fire-and-forget 모델 (즉시 "accepted" 응답) → ⚠️ 읽기는 해결, 쓰기는 실행 지연
  - `osascript activate` → ⚠️ 동작하나 플랫폼 종속 해킹

4단계: unity-cli-connector 비교 실험 (결정적 단서)
- `unity-cli editor play` → unfocused에서 **play 진입 성공**
- unity-cli-connector의 .NET HttpListener가 실제 요청을 처리하면서 main loop을 살려둠
- 핵심 차이: .NET managed IO의 **실제 요청-응답 사이클**이 Unity main loop을 활성화

5단계: 최종 해결 — Rust + C# HttpListener 하이브리드
- Rust HTTP (Unix socket): CLI 진입점, Domain Reload 생존, 경로 불변
- C# HttpListener (내부 포트): Rust에서 wake HTTP 요청 → IO completion → main loop 활성화
- 흐름: Rust → MAIN_QUEUE push → C# HttpListener wake → ProcessMainQueue 실행 → unictl_respond
- **unfocused에서 play/stop/status 모두 동기 응답 확인 (2026-04-02)**

**발견된 Mono 제약 3가지**:
1. `MonoPInvokeCallback` 실행 중 `static readonly` 필드가 이전 도메인 값 참조 (해시 불일치)
2. Rust callback 내에서 같은 native library로 P/Invoke 재진입 시 호출이 무시됨 (예외 없이 no-op)
3. `QueuePlayerLoopUpdate`, `RepaintAllViews` 등 main thread 전용 API는 .NET thread pool에서도 호출 불가

**Unity Edit 모드 idle 동작 정리**:
- Edit 모드에서 `EditorApplication.update`는 on-demand (상호작용/이벤트 시에만 실행)
- `InteractionMode = No Throttle`: focused에서만 연속 실행, unfocused에서는 여전히 idle
- .NET HttpListener의 IO completion callback은 Unity main loop을 깨우는 효과가 있음
- 이 효과는 실제 HTTP 요청-응답 사이클에서만 발생 (패시브 리스닝/self-ping으로는 부족)

**최종 아키텍처**:
```
CLI ──Unix socket──▶ Rust HTTP (tiny_http, Domain Reload 생존)
                         │
                         ├─ 동기: list, ping, status → Rust 스레드에서 즉시 응답
                         │
                         └─ 비동기: play, stop, compile, quit
                              1. Rust → MAIN_QUEUE push
                              2. Rust → C# HttpListener wake (내부 HTTP 요청)
                              3. IO completion → main loop 활성화
                              4. ProcessMainQueue → pop → Execute → unictl_respond
                              5. Rust → CLI 응답
```

**상태**: ✅ 해결됨 (2026-04-02). unfocused + Default InteractionMode에서 play/stop/status 동기 실행 확인.

### EC8: refresh_unity 후 재컴파일 미발생

**현상**: `unity-cli refresh_unity --params '{"mode":"force","compile":"request"}'` 후 C# 변경분이 반영 안 됨.

**근본 원인 (2026-04-01 확정)**:
- `refresh_unity`는 기존 unity-cli-connector 경유 → HttpListener 기반이라 Edit 모드에서도 메인 스레드 활성
- `unity-cli refresh_unity`는 정상 동작함 (DLL 타임스탬프 갱신 확인)
- 이전 세션에서 "재컴파일 안 됨"으로 오진한 이유: EC7(다른 _inbox 인스턴스) 때문에 새 코드가 실행되어도 비동기 경로가 안 돌았음
- 에디터 포커스(`osascript activate`)만으로는 재컴파일 안 되는 경우 있음 → `unity-cli refresh_unity` 사용 필요

**상태**: ✅ 해결됨. EC7이 진짜 원인이었고, refresh_unity 자체는 정상 동작.

### 우선순위

| 엣지케이스 | 심각도 | 빈도 | 0.1.0 대응 |
|-----------|--------|------|-----------|
| EC7: update idle + 비동기 경로 | 높음 | 해결됨 | ✅ Rust-side MAIN_QUEUE로 해결 |
| EC8: 재컴파일 미발생 | — | 해결됨 | ✅ EC7이 진짜 원인, refresh_unity 정상 |
| EC2: Rust→Unity API | 높음 | 해결됨 | ✅ 규칙 확립 |
| EC3: Safe Mode | 중간 | 개발 중 빈번 | doctor 명령에서 감지 |
| EC4: 씬 복구 팝업 | 중간 | 강제 종료 시 | `Temp/__Backupscenes/` 사전 제거로 회피 가능 확인 |
| EC5: 중복 실행 | 높음 | CLI 자동화 시 | PID/소켓 기반 감지 |
| EC6: Reload 유실 | 낮음 | 해결됨 | ✅ PENDING 큐 |
| EC1: update 미실행 | — | EC7로 통합 | — |

## 8. 구현 로드맵

### Phase A: Rust Native Plugin 정리

**A1. 리네이밍 + 정리**
- `unity-bridge/` → `unictl/` 디렉토리 리네임
- Cargo.toml: `name = "unictl_native"`
- DllImport명: `unictl_native`
- 검증 전용 코드 유지 (디버깅 유용), export명만 정리

**A2. 프로덕션 export API**
- `unictl_start(sock_path) → i32` — 서버 시작 (중복 호출 guard)
- `unictl_register_handler(cb)` — C# 콜백 등록
- `unictl_unregister_handler()` — Domain Reload 전 해제
- `unictl_respond(id, json)` — 비동기 응답 전달
- `unictl_emit_event(json)` — SSE broadcast (추후)
- HTTP 엔드포인트: `POST /command`, `GET /health`, `GET /events`(추후)

**A3. 빌드 스크립트 (`scripts/build.sh`)**
```bash
cargo build --release
cp target/release/libunictl_native.dylib ../../Assets/Plugins/macOS/unictl_native.bundle
codesign -s - -f ../../Assets/Plugins/macOS/unictl_native.bundle
```

### Phase B: C# Unity 파일 (`Assets/Editor/Unictl/`)

BridgeVerify.cs → 프로덕션 4개 파일 분리.

**B1. UnictlNative.cs — P/Invoke 바인딩**
- `[DllImport("unictl_native")]` 선언
- `unictl_start`, `unictl_register_handler`, `unictl_unregister_handler`, `unictl_respond`
- `CommandHandlerDelegate` 정의

**B2. UnictlServer.cs — 서버 라이프사이클 + 메인 스레드 마샬링**
- `[InitializeOnLoad]` static constructor:
  1. `unictl_start(sockPath)` — 소켓 경로: `{projectRoot}/.unictl/unictl.sock`
  2. 콜백 등록
  3. `EditorApplication.update += ProcessInbox`
- `AssemblyReloadEvents.beforeAssemblyReload`:
  1. `unictl_unregister_handler()` — dangling pointer 방지
  2. `EditorApplication.update -= ProcessInbox`
- `OnCommand` 콜백 (Rust 스레드):
  - `"list"` → 동기 응답 (ToolRouter.GetSchemas)
  - 그 외 → ConcurrentQueue enqueue, NULL 반환 (비동기)
- `ProcessInbox` (메인 스레드):
  - dequeue → `ToolRouter.Execute(command, params)` → `unictl_respond(id, result)`

**B3. ToolRouter.cs — 명령 라우팅 + 도구 디스커버리**
- `Execute(string command, JObject params) → string` (JSON 직렬화된 응답)
- `GetToolSchemas() → List<object>` (리플렉션 기반 `[UnictlTool]` 스캔)
- snake_case 자동 변환, `Parameters` 중첩 클래스 스키마 추출
- 비동기 핸들러 지원 (`Task<object>` 반환 시 대기)

**B4. UnictlToolAttribute.cs — 어트리뷰트 + 응답 타입 + 유틸**
- `[UnictlTool]`: Name, Description, Group
- `[ToolParameter]`: Description, Required, DefaultValue
- `SuccessResponse` / `ErrorResponse`: `{ success, message, data }`
- `ToolParams`: JObject 래퍼 (Get, GetRequired, GetInt, GetBool, GetFloat)
- `StringCaseUtility.ToSnakeCase`

**B5. Unictl.Editor.asmdef**
- 어셈블리명: `Unictl.Editor`
- 참조: 없음 (자체 완결)
- 에디터 전용 플랫폼
- `Queenzle.Editor.asmdef`가 `Unictl.Editor` 참조

**기존 도구 호환**: `[UnityCliTool]` → `[UnictlTool]`로 어트리뷰트명만 교체.
HandleCommand 시그니처, SuccessResponse/ErrorResponse, ToolParams 패턴 모두 동일.

### Phase C: Bun CLI (`unictl/src/`)

**C1. 프로젝트 초기화**
- `package.json`: `name: "unictl"`, `bin: { "unictl": "./src/cli.ts" }`
- 의존성: `citty` (CLI 파싱, 7KB, 의존성 0)
- 개발 중: `bun run src/cli.ts` 또는 `bun link`

**C2. 소켓 경로 계산 (`src/socket.ts`)**
- cwd에서 상위 탐색 → `ProjectSettings/ProjectVersion.txt` 존재 → projectRoot 확정
- `{projectRoot}/.unictl/unictl.sock`
- 소켓 파일 존재 확인 → 없으면 에러 ("Unity editor not running")
- `--project <path>` 플래그로 명시적 지정 가능

**C3. HTTP 클라이언트 (`src/client.ts`)**
- `command(cmd, params?) → Promise<any>` — POST /command
- `health() → Promise<object>` — GET /health
- `events(filter?) → AsyncGenerator<any>` — GET /events (SSE, 추후)

**C4. CLI 엔트리 (`src/cli.ts`)**
```
unictl list                                    # 빌트인: 도구 목록
unictl health                                  # 빌트인: 연결 상태
unictl <command>                               # 도구: 파라미터 없이
unictl <command> -p key=value -p key2=value2   # 도구: key=value 파라미터
unictl <command> @params.json                  # 도구: 파일에서 JSON 읽기
unictl <command> <<EOF                         # 도구: stdin에서 JSON 읽기
{"key": "value"}
EOF
```
- 파라미터 우선순위: `-p` > `@file` > stdin (non-TTY)
- 출력: 항상 JSON 한 줄
- 종료 코드: success → 0, error → 1

### Phase D: 코어 도구 구현 + 마이그레이션

**D0. 코어 도구 구현 (`Assets/Editor/Unictl/Tools/`)**

C# 서버 사이드 도구. 모든 대기 로직은 `EditorApplication.update`에서 처리.

| 도구 | 설명 | 범용성 |
|------|------|--------|
| `editor_control` | play/stop/compile/restart + 완료까지 서버 사이드 대기 | 모든 프로젝트 |
| `ui_wait` | 셀렉터 매칭까지 서버 사이드 대기 (stable_frames, until_gone) | UI Toolkit |
| `ui_action` | ui_wait + click/set_value 통합 | UI Toolkit |
| `read_console` | 콘솔 로그 읽기 | 모든 프로젝트 |

### Phase S: 도입 전 안정화

D1(도구 마이그레이션) 전에 현재 코어의 품질과 안정성을 확보하는 단계.

**S1. 코드 품질 정리**
- [ ] 디버깅용 코드 제거 (DebugWrite, 불필요한 로그)
- [ ] Phase B의 설명 업데이트 (ConcurrentQueue → Rust MAIN_QUEUE 반영)
- [ ] `unictl_pop_main` 메모리 해제 경로 검증 (C# try/finally)
- [ ] Rust `call_handler`의 에러 전파 경로 검토 (panic 시 에디터 크래시 방지)
- [ ] `검증에서 발견된 핵심 사항` 테이블 업데이트

**S2. Domain Reload 내성 검증**
- [ ] 연속 compile 요청 시 MAIN_QUEUE + PENDING 동시 사용 시나리오
- [ ] Reload 중 요청 → PENDING 큐잉 → Reload 완료 → flush → MAIN_QUEUE → OnUpdate 경로
- [ ] 핸들러 재등록 시 MAIN_QUEUE에 남은 아이템 처리 확인
- [ ] 연속 Reload 3회 + 비동기 명령 혼합 시나리오

**S3. 에디터 프로세스 제어 (`unictl editor` 서브커맨드)**

CLI 수준의 에디터 라이프사이클 관리. sleep 폴링 최소화 설계.

| 서브커맨드 | 설명 | 구현 위치 |
|-----------|------|----------|
| `unictl editor status` | 에디터 실행 여부 + 소켓 상태 + PID | CLI (소켓 probe + PID 감지) |
| `unictl editor quit` | graceful 종료 요청 + 프로세스 종료 대기 | C# 도구 (`EditorApplication.Exit`) + CLI 대기 |
| `unictl editor quit --force` | 응답 없을 시 SIGTERM → SIGKILL | CLI (OS 프로세스 제어) |
| `unictl editor open` | 에디터 시작 + 소켓 ready 대기 | CLI (프로세스 시작 + health 폴링) |
| `unictl editor restart` | quit → Temp 정리 → open 체인 | CLI (위 조합) |
| `unictl editor doctor` | 소켓/PID/버전 일치/컴파일 에러 진단 | CLI + C# (혼합) |

**대기 전략 (sleep 최소화)**:
- `quit`: `editor_control quit` (C# `EditorApplication.Exit(0)`, 내부 정상종료) → CLI는 소켓 연결 실패를 종료 시그널로 사용 (폴링 간격 200ms, 타임아웃 15초). 응답 없으면 PID로 SIGTERM → SIGKILL 폴백.
- `open`: Temp 잔여물 정리 (`__Backupscenes/`, `UnityTempFile-*`) → Unity 바이너리 직접 실행 → `/health` 폴링 (200ms 간격, 타임아웃 120초). health 타임아웃 시 Safe Mode 가능성 안내.
- `restart`: quit 완료 확인 → Temp 정리 → open (체인)
- 서버 사이드 대기가 가능한 명령은 long-poll 사용 (클라이언트 sleep 제거)

**`open` 시 health 폴링이 유일한 대기 전략인 이유**:
- Rust 서버는 에디터 프로세스 내부에서 기동 → CLI가 에디터를 시작하는 시점엔 서버 자체가 없음
- 에디터→CLI 방향 알림 채널 없음 (SSE도 서버 기동 후에야 연결 가능)
- 따라서 CLI가 `/health` 를 능동적으로 폴링하는 pull 방식만 가능

**팝업 엣지케이스 대응**:
- EC3 (Safe Mode): `doctor`에서 컴파일 에러 사전 감지, `open`에서 `-batchmode` 옵션 지원
- EC4 (씬 복구): `restart`에서 `Temp/__Backupscenes/` 자동 정리
- EC4-bis (UnityTempFile 팝업): `quit` 시 `Temp/UnityTempFile-*` 사전 정리 또는 Force Quit 폴백
- EC5 (중복 실행): `open` 시 소켓/PID 기반 중복 감지 → 이미 실행 중이면 거부

**S4. CLI 안정성**
- [ ] 서버 미응답 시 타임아웃 (기본 30초) + 명확한 에러 메시지
- [ ] 소켓 없을 때 "Unity editor not running. Use `unictl editor open` to start." 가이드
- [ ] `--timeout <ms>` 글로벌 플래그
- [ ] `--wait` 패턴: compile/play 후 상태 변화까지 서버 사이드 대기

**진행 순서**: S1 → S2 → S3 → S4 (S1/S2는 코드 기반 검증, S3/S4는 기능 추가)

**D1. 기존 도구 어트리뷰트 교체**
- `UiToolkitInputTool.cs`: `[UnityCliTool]` → `[UnictlTool]`
- `ScreenshotBridge.cs`: `[UnityCliTool]` → `[UnictlTool]`
- `Queenzle.Editor.asmdef`: `UnityCliConnector.Editor` 참조 제거 → `Unictl.Editor` 추가

**D2. 하네스 통합 + 안정성 검증**
- `run-ui-smoke.mjs`: `execFile("unity-cli")` → unictl CLI 호출로 전환
- 서버 사이드 대기 활용으로 클라이언트 폴링 제거
- 기존 시나리오 전체 실행하여 안정성 비교

**D3. 문서 업데이트**
- CLAUDE.md, AGENTS.md, .claude/rules/ → unity-cli 참조를 unictl로

**D4. unity-cli-connector 제거**
- `Packages/manifest.json`에서 `com.youngwoocho02.unity-cli-connector` 제거
- `com.unity.nuget.newtonsoft-json` 직접 의존 추가
- 검증: 기존 시나리오 전체 통과

### 배포 전략 (0.1.0 릴리스 시)

**monorepo 구조로 전환:**
- CLI: npm 패키지 (`bunx unictl` / `npx unictl`)
- Unity: UPM 패키지 (`com.unictl.editor`)
- 같은 리포, 같은 버전 번호

**버전 동기화:**
- `health` 응답에 Unity 패키지 버전 포함
- `unictl doctor`: CLI ↔ Unity 패키지 버전 일치 검증
- 불일치 시 경고 + 업데이트 안내

**초기화:**
- `unictl init`: manifest.json에 UPM 추가 + .gitignore 설정

## 7. 검증에서 발견된 핵심 사항

| 발견 | 대응 |
|------|------|
| macOS에서 codesign 없으면 CODESIGNING crash | 빌드 스크립트에 `codesign -s -` 포함 |
| native plugin은 에디터 재시작 없이 교체 불가 | plugin 변경 빈도 최소화 설계 (전송만 담당) |
| Domain Reload 전 콜백 해제 안 하면 hang | `beforeAssemblyReload`에서 unregister 필수 |
| 콜백 반환 전에 비동기 채널 등록 필수 | race condition 방지: 채널 먼저 등록 → 콜백 호출 |
| 콜백은 Rust 스레드에서 호출됨 | Unity API는 Rust MAIN_QUEUE → ProcessMainQueue에서만 호출 |
| MonoPInvokeCallback에서 C# static 필드 참조 불가 | Domain Reload 후 stale 값 — 큐/상태 모두 Rust static에 저장 |
| C#→Rust P/Invoke 재진입 무시됨 | Rust callback 내에서 같은 라이브러리로 P/Invoke 호출 금지 |
| unfocused에서 EditorApplication.update 미실행 | C# HttpListener IO completion으로 main loop 활성화 |

## 8. 설계 결정 로그

| # | 항목 | 결정 | 이유 |
|---|------|------|------|
| 1 | `list` 명령 스레드 | Rust 스레드에서 동기 처리 | 리플렉션은 메타데이터 읽기만, Unity API 호출 없음. 현 커넥터도 동일 방식 |
| 2 | 비동기 핸들러 | 동기만 지원, 비동기 추후 | 현 프로젝트에서 Task<object> 반환 도구 미사용. 에디터 사이클 엣지케이스 별도 설계 필요 |
| 3 | BridgeVerify.cs | Phase B에서 삭제 | 새 파일 4개가 기능 완전 대체. Domain Reload 트리거는 아무 C# 수정으로 가능 |
| 4 | asmdef 참조 | B에서 Unictl+커넥터 둘 다, D에서 커넥터 제거 | 마이그레이션 시점까지 기존 도구 동작 유지 |
| 5 | `.unictl/` gitignore | 초기화 도구(init/setup)에서 처리 | 런타임 디렉토리는 초기화 시점에 자동 관리 |
| 6 | Newtonsoft.Json | Unictl.Editor.asmdef에서 직접 참조 | 초기화 명령에서 manifest.json 의존성 안내 |
| 7 | C# namespace | `namespace Unictl` 필수 | 글로벌 오염 방지 |
| 8 | `list` 응답 포맷 | 현 커넥터 포맷 유지, 필요 시 필드 추가 | 에이전트 호환성 |
| 9 | sync/async 라우팅 | `list`만 동기(Rust 스레드), 나머지 전부 비동기(메인 스레드) | Unity API 안전성 |
| 10 | Phase B 검증 도구 | `[UnictlTool(Name="ping")]` 테스트 도구 생성, Phase D 후 삭제 | 독립 검증 가능 |
| 11 | BridgeVerify.cs 삭제 순서 | InitializeOnLoad 제거 → 새 파일 추가 → 검증 → 삭제 | 중복 서버 시작 방지 |
| 12 | CLI 명령 구문 | 플랫 커맨드, 0.2.0에서 `editor` 서브커맨드 추가 | 빌트인/도구 구분 불필요 |
| 13 | CLI 파싱 라이브러리 | citty (7KB, TS 네이티브, Bun 호환) | help 자동생성 + 서브커맨드 + 의존성 0 |
| 14 | CLI 출력 포맷 | 항상 JSON 한 줄 | 에이전트가 주 소비자, `jq`로 디버깅 |
| 15 | 프로젝트 루트 탐색 | `ProjectSettings/ProjectVersion.txt` 기준 + `--project` 폴백 | Unity 전용 파일로 확실한 감지, 에디터 버전 정보 부가 |
| 16 | 파라미터 입력 | `-p key=value`, `@file`, stdin. `--params` 없음 | 이스케이프 문제 해결, gcloud 스타일 |
| 17 | 배포 | monorepo: CLI(npm) + Unity(UPM), 동일 버전 | 버전 불일치 근본 해결 |
| 18 | 도구 로직 위치 | 전부 C# 서버 사이드. CLI는 thin sender | Unity API는 C#에서만 접근 가능 |
| 19 | 초기화 명령 | `unictl init` | 생태계 표준 (npm/git/cargo init) |
| 20 | 도구 범용성 | editor_control/capture_ui/read_console/ping은 코어, ui_wait/ui_action은 UI Toolkit 확장 | 0.1.0은 한 패키지, 추후 분리 가능 |

## 9. 0.2.0 로드맵 메모

- Unity Hub CLI (`--headless`)로 에디터 설치/목록 조회 가능 확인
- Unity Editor 바이너리 직접 실행으로 프로젝트 열기 가능
- 에디터 종료: `osascript` graceful quit 또는 프로세스 시그널
- 예정 명령: `unictl editor open/close/status`, `unictl hub editors/install`

### 연구 필요 사항
- **에디터 중복 실행 방지**: 1프로젝트에서 N개 에디터가 열리는 경우 감지/차단. lock 파일 또는 PID 기반
- **에디터 열기 팝업 흐름 중단 방지**: 컴파일 에러(safe mode), 씬 복구 팝업 등이 자동화 흐름을 차단. 사전 방지(열기 전 정적 분석/상태 확인) 또는 후처리(자동 응답) 연구
- **graceful shutdown 보장**: `pkill -9` 대신 `osascript quit` + 종료 확인 대기. 강제 종료 시 씬 백업 잔류 문제

## 10. 폴백 전략

| 실패 지점 | 대안 |
|-----------|------|
| Rust cdylib가 특정 플랫폼에서 로드 불가 | 순수 C로 최소 구현 |
| Rust 스레드가 Unity와 충돌 | 에디터가 spawn하는 Bun sidecar 프로세스 |
| Unix socket 불가 (Windows 구버전) | TCP localhost + SessionState 포트 고정 |
