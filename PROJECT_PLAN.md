# 기타 코드/스케일/프레이즈 연습 웹앱 개발 계획 (Cloudflare + D1, 기능 분리형)

## 1) 목표
- 목표: 기타 학습자가 `코드`, `스케일`, `메트로놈`, `프레이즈`를 안정적으로 반복 연습하고, 기록을 누적할 수 있는 웹앱을 만든다.
- 개발 원칙:
  - 유지보수성: 기능별로 독립적인 모듈로 분리한다.
  - 확정성: 같은 입력이면 같은 결과가 나오도록 데이터/로직/배포 절차를 표준화한다.
  - 확장성: 사용자/데이터 증가 시 구조 변경 없이 단계적으로 확장 가능해야 한다.

## 2) 아키텍처 (기능 분리)
- 런타임:
  - Frontend: Cloudflare Pages (React + Vite + TypeScript)
  - API: Cloudflare Workers (기능별 라우트)
  - DB: Cloudflare D1 (SQLite)
  - 확장 옵션: Cloudflare KV(조회 캐시), R2(대용량 파일), Queues(비동기 처리)
- 코드 구조(예시):
- `src/features/chords/*`
- `src/features/scales/*`
- `src/features/metronome/*`
- `src/features/phrases/*`
- `src/features/progress/*`
- `src/shared/*` (공통 UI, 유틸, 타입)
- `worker/routes/*` (기능별 API 엔드포인트)
- `db/migrations/*` (D1 마이그레이션)
- `db/seed/*` (시드 SQL)

## 3) 기능 모듈 정의

### 3.1 Chords 모듈
- 책임:
  - 코드 데이터 조회
  - 코드 퀴즈/진행 연습 로직
- 입력/출력 계약:
  - 입력: key, chordType, difficulty
  - 출력: chord diagram, tones, quiz choices
- 저장:
  - 정적 데이터 중심(JSON + seed)
- 금지:
  - practice_sessions 직접 기록 금지 (Progress API를 통해서만 기록)

### 3.2 Scales 모듈
- 책임:
  - 스케일 패턴 조회
  - 포지션 렌더링 데이터 생성
- 입력/출력 계약:
  - 입력: root, scaleType, position
  - 출력: fret positions, note list
- 저장:
  - 정적 데이터 중심(JSON + seed)

### 3.3 Metronome 모듈
- 책임:
  - BPM/박자/강세/카운트인 제어
  - 정확한 클릭 타이밍 스케줄링
- 입력/출력 계약:
  - 입력: bpm, timeSignature, subdivision, accentPattern
  - 출력: tick event stream(내부 이벤트)
- 확정성 규칙:
  - 오디오 스케줄링은 AudioContext clock 기준
  - UI 타이머(Date 기반)와 분리

### 3.4 Phrases 모듈
- 책임:
  - 프레이즈 CRUD
  - 루프 구간 재생
  - 단계별 BPM 증가 연습
- 입력/출력 계약:
  - 입력: phrase payload(title/key/bpm/content/loop)
  - 출력: 저장된 phrase 객체, 연습 상태
- 저장:
  - D1 `phrases`

### 3.5 Progress 모듈
- 책임:
  - 연습 세션 기록 저장/집계
  - 주간 지표 계산
- 입력/출력 계약:
  - 입력: session(category,target,bpm,duration,result)
  - 출력: weekly stats, max stable bpm
- 저장:
  - D1 `practice_sessions`

## 4) 기능 간 의존성 규칙
- `chords/scales/phrases` -> `progress`는 API 호출만 허용
- 기능 모듈 간 직접 import 최소화, 공통 로직은 `shared`로 이동
- 각 기능은 아래 4개를 세트로 유지:
  - `types.ts` (계약 타입)
  - `service.ts` (도메인 로직)
  - `api.ts` (서버 통신)
  - `ui/*` (화면)

## 5) D1 스키마/마이그레이션 규칙 (확정성 핵심)
- 원칙: `migration-first`, 수동 스키마 변경 금지
- 규칙:
  - 모든 스키마 변경은 `db/migrations` SQL 파일로만 수행
  - 로컬/원격 동일 파일 적용
  - 마이그레이션 파일은 append-only (기존 파일 수정 금지)

### 기본 명령
1. 마이그레이션 생성
- `wrangler d1 migrations create <DB_NAME> <name>`

2. 로컬 적용
- `wrangler d1 migrations apply <DB_NAME> --local`

3. 원격 적용
- `wrangler d1 migrations apply <DB_NAME> --remote`

4. 시드 적용
- `wrangler d1 execute <DB_NAME> --local --file ./db/seed/dev_seed.sql`
- `wrangler d1 execute <DB_NAME> --remote --file ./db/seed/prod_seed.sql`

## 6) DB 모델 (MVP)
- `chords(id, name, type, root, tones_json, fingering_json)`
- `scales(id, name, mode, root, pattern_positions_json)`
- `phrases(id, user_id, title, musical_key, time_signature, bpm, content_json, loop_start, loop_end, created_at, updated_at)`
- `practice_sessions(id, user_id, category, target_type, target_id, bpm, duration_sec, result, created_at)`
- 인덱스:
  - `idx_phrases_user_updated_at`
  - `idx_sessions_user_created_at`
  - `idx_sessions_category_created_at`

## 7) 개발 순서 (기능별 병렬 가능)

### 단계 0: 기반(1주)
- 프로젝트 기본 셋업
- D1 연결 + 초기 migration + seed
- 공통 타입/에러 포맷/응답 포맷 정의

### 단계 1: Metronome 단독 완성(1주)
- 오디오 타이밍 안정화
- BPM/박자/강세/카운트인 구현
- 기준 테스트 통과 후 다음 단계 진행

### 단계 2: Chords + Scales(2주)
- 정적 데이터 조회/렌더링
- 연습 UI + 퀴즈 로직
- Progress 기록 API 연동

### 단계 3: Phrases(2주)
- CRUD API + UI
- 루프 재생 + 템포 단계 상승
- 저장/로드/수정 흐름 완성

### 단계 4: Progress 대시보드(1주)
- 세션 집계 쿼리
- 주간/월간 통계 UI

### 단계 5: 배포/운영(1주)
- Cloudflare Pages 배포
- 원격 migration 적용
- 모니터링/에러 로깅/Smoke test

## 8) 테스트 전략 (기능 단위)
- 공통 원칙:
  - 기능마다 `unit -> integration -> e2e` 최소 1개 이상
  - 실패 재현 가능한 테스트 데이터 고정(seed fixture)
- Chords/Scales:
  - 패턴 계산/퀴즈 로직 단위 테스트
- Metronome:
  - tick 간격 오차 검증(허용 범위 정의)
- Phrases:
  - CRUD + loop 파싱/검증 테스트
- Progress:
  - 집계 쿼리 스냅샷 테스트

## 9) 확정성 체크리스트
- [ ] `npm ci`로 의존성 고정 설치(`package-lock.json` 커밋)
- [ ] Node/Wrangler 버전 고정(`.nvmrc` 또는 Volta)
- [ ] 모든 DB 변경은 migration 파일로만 반영
- [ ] 로컬/원격 스키마 해시 비교 절차 마련
- [ ] API 응답 포맷 버전화(`v1` prefix)
- [ ] 시드 데이터 버전화(`seed_version` 테이블)

## 10) 유지보수 규칙
- PR 단위: 기능 모듈 하나씩 분리해서 변경
- 금지:
  - 한 PR에서 다수 기능 모듈 동시 대규모 수정
  - 기능 내부 로직이 다른 기능 DB 테이블 직접 조작
- 권장:
  - 기능별 README 유지 (`src/features/<name>/README.md`)
  - 기능별 에러코드 표준화
  - 기능별 소유 테스트 유지

## 11) 확장성 전략
- 아키텍처 확장 단위:
  - 기능 모듈은 독립 배포 가능한 API 경계 유지 (`/api/v1/chords`, `/api/v1/scales` 등)
  - 읽기 많은 API는 캐시 가능 응답으로 설계(`ETag`, `Cache-Control`)
- DB 확장 원칙(D1):
  - 초기에 필요한 인덱스만 도입하고, 슬로우 쿼리 기준으로 인덱스 추가
  - 목록 API는 오프셋 대신 커서 기반 페이지네이션 우선
  - 집계는 요청 시 실시간 계산보다 `daily summary` 테이블로 단계 전환 가능하게 설계
- 트래픽 확장 단계:
  - 1단계: 단일 Worker + D1 (MVP)
  - 2단계: KV 캐시 도입(코드/스케일 조회, 통계 조회 캐시)
  - 3단계: Queues 기반 비동기 처리(세션 집계, 통계 사전 계산)
- 코드 확장 원칙:
  - 기능 추가 시 `src/features/<new-feature>` 신규 모듈 생성, 기존 모듈 직접 수정 최소화
  - 공통 변경이 필요하면 `src/shared/*`로 추상화 후 기능별 적용
- 운영 확장 지표:
  - API p95 latency, D1 쿼리 시간, 에러율, 캐시 적중률을 릴리스 기준 지표로 관리

## 12) 배포 절차 (Cloudflare)
1. main 머지 전: 로컬 migration + 테스트 통과
2. main 머지 후: Pages 빌드
3. 배포 직전: `wrangler d1 migrations apply <DB_NAME> --remote`
4. 배포 직후: 기능별 Smoke 테스트
- `/metronome` 시작/중지
- `/phrases` 생성/조회
- `/progress` 통계 조회

## 13) 바로 시작할 실행 체크리스트
- [ ] 기능 폴더 구조 생성(`src/features/*`)
- [ ] Worker 라우트를 기능별로 분리(`worker/routes/*`)
- [ ] D1 초기 migration 작성
- [ ] seed SQL 작성(dev/prod 분리)
- [ ] Metronome 기능부터 독립 구현/테스트
- [ ] Chords/Scales 기능 구현
- [ ] Phrases 기능 구현
- [ ] Progress 기능 구현
- [ ] Cloudflare 배포 및 원격 migration 적용
- [ ] p95 latency/쿼리시간/에러율 대시보드 추가
