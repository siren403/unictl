# unictl - Claude 세션 가이드

## 저장소 성격

**멀티 컴포넌트 repo** — CLI 한 개 패키지만 있는 게 아니다.

```
tools/unictl/
├── package.json                         ← dev 전용 (private, name: unictl-repo)
├── scripts/release.ts                   ← 버전 범프 + 커밋 + 태그 + 푸시 + npm publish
├── packages/
│   ├── cli/                             ← npm에 "unictl"로 배포
│   │   ├── package.json                 ← name: unictl, bin: ./bin.js
│   │   ├── bin.js                       ← npm bin 진입점 (src/cli.ts로 위임)
│   │   └── src/                         ← TypeScript 소스 (Bun 직접 실행)
│   └── upm/com.unictl.editor/           ← Unity UPM 패키지
├── native/unictl_native/                ← Rust native bridge (FFI)
├── integrations/                        ← Codex/Claude Code 어댑터
└── docs/standalone/                     ← 사용자 문서
```

## 배포 모델

| 컴포넌트 | 배포 채널 | 소비자 호출 |
|---------|----------|-------------|
| CLI | npm registry (`unictl`) | `bunx unictl` / `bunx unictl@<ver>` |
| Unity UPM | Git URL (태그 고정) | `com.unictl.editor: "...?path=/packages/upm/com.unictl.editor#v<ver>"` |
| Native | UPM 패키지에 prebuilt 포함 | Unity가 자동 로드 |

**핵심**: 모든 `package.json` 버전은 동기화되어야 한다. `scripts/release.ts`가 자동 처리.

## package.json 구조

### root (`tools/unictl/package.json`)
- `name: "unictl-repo"`, `private: true`
- 배포 안 됨. workspace 선언 + release 스크립트 진입점.

### CLI (`packages/cli/package.json`)
- `name: "unictl"` — npm 배포 대상
- `bin: { "unictl": "./bin.js" }` — `.ts`는 npm bin으로 허용 안 돼서 `.js` shim 사용
- `dependencies: { citty }` — npm 설치 시 같이 받아짐
- `files: ["src/", "bin.js"]` — tarball에 포함할 파일
- `repository` — `init` 명령이 UPM 참조 생성 시 사용

### UPM (`packages/upm/com.unictl.editor/package.json`)
- Unity Package Manager용. npm과 무관.

## bin.js shim

```js
#!/usr/bin/env bun
import "./src/cli.ts";
```

npm은 `.ts`를 bin으로 직접 등록할 수 없다. 그래서 `.js` shim이 `cli.ts`를 import하는 방식.
Bun은 TypeScript 네이티브 실행하므로 빌드 단계 없이 동작한다.

## 버전 관리

```bash
bun run release              # patch (0.1.2 → 0.1.3) + npm publish
bun run release minor        # 0.1.2 → 0.2.0
bun run release major        # 0.1.2 → 1.0.0
bun run release 0.3.0        # 정확한 버전
bun run release --no-publish # git만 (npm publish 스킵)
```

스크립트 실행 흐름:
1. `package.json × 3` 버전 동기화
2. git add + commit: `release: v<ver>`
3. git tag `v<ver>`
4. git push main + tag
5. `cd packages/cli && npm publish --access public`

**태그는 항상 모든 작업 완료 후에 찍는다.** 중간에 찍으면 태그 사용자가 구버전을 받는다.

## IPC 아키텍처

| 플랫폼 | 트랜스포트 | 프로토콜 |
|---------|-----------|----------|
| Windows | Named Pipe | 라인 기반 JSON |
| macOS | Unix Socket | HTTP (tiny_http) |

파이프/소켓 이름은 프로젝트 루트 경로의 SHA256 해시로 결정적 생성.
C#(`UnictlServer.cs`)과 TypeScript(`socket.ts`)가 동일 알고리즘 공유.

## 흔한 실수 방지

1. **`bunx github:repo` 지양** — bunx는 git 참조를 공격적으로 캐시한다. 태그 force-move해도 로컬 캐시가 남음. 안정 배포 채널은 npm.
2. **dist 금지** — 소스/빌드 드리프트 원천 차단. Bun이 TS 직접 실행하므로 번들 불필요.
3. **두 package.json 혼동** — root는 dev 전용, `packages/cli`가 실제 배포 패키지. 의존성은 CLI 쪽에 추가.
4. **npm publish --dry-run의 bin 경고** — "script name X was invalid and removed"는 **false warning**이다. 실제 tarball은 bin 유지. `npm pack` 후 `tar -xzf`로 package.json 확인.

## 개발 워크플로우

```bash
# 로컬 실행 (빌드 없음, 소스 직접)
cd consumer-project
bun run ../tools/unictl/packages/cli/src/cli.ts <command>

# 또는 consumer package.json에 스크립트 등록
{ "scripts": { "unictl": "bun run ./tools/unictl/packages/cli/src/cli.ts" } }

# Windows 네이티브 재빌드
bun run build:native:windows

# macOS 네이티브 재빌드
bun run build:native:macos
```
