# 기타 연습 웹앱 API 스펙 v1 (Cloudflare Workers + D1)

## 1) 목적
- 기능 모듈(`chords`, `scales`, `metronome`, `phrases`, `progress`)별 API 계약을 고정한다.
- 로컬 개발과 배포 환경에서 동일한 요청/응답 형태를 보장한다.

## 2) 공통 규약

### 2.1 Base URL / Version
- Base URL: `/api/v1`
- 버전 변경 원칙: 브레이킹 변경은 `/api/v2`로 분리한다.

### 2.2 Content-Type
- 요청/응답 JSON: `application/json; charset=utf-8`

### 2.3 인증
- MVP:
  - 인증 없이 시작 가능
  - 사용자 데이터가 필요한 API는 `x-user-id` 헤더를 사용한다.
- 이후 확장:
  - Cloudflare Access/JWT 도입 후 `x-user-id` 대체

### 2.4 응답 포맷 (고정)
```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "req_01J....",
    "timestamp": "2026-02-14T10:00:00.000Z"
  }
}
```

### 2.5 에러 포맷 (고정)
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "bpm must be between 40 and 240",
    "details": {
      "field": "bpm"
    }
  },
  "meta": {
    "requestId": "req_01J....",
    "timestamp": "2026-02-14T10:00:00.000Z"
  }
}
```

### 2.6 공통 에러 코드
- `VALIDATION_ERROR` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `CONFLICT` (409)
- `RATE_LIMITED` (429)
- `INTERNAL_ERROR` (500)

### 2.7 ID / 시간 규칙
- `id`: ULID 문자열 권장
- 시간: UTC ISO-8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`)

### 2.8 페이지네이션 규칙
- 목록 API는 커서 기반 사용
- 요청: `?limit=20&cursor=<opaque>`
- 응답 `meta.pagination`:
```json
{
  "pagination": {
    "limit": 20,
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTAyLTE0VDEwOjAwOjAwWiIsImlkIjoiMDEuan..." 
  }
}
```

### 2.9 멱등성/중복 방지
- 세션 기록 POST는 `Idempotency-Key` 헤더 지원
- 동일 키 + 동일 body 재요청 시 동일 결과 반환

### 2.10 동시성 제어
- `phrases` 수정은 `version` 필드 기반 낙관적 잠금
- `PATCH /phrases/:id` 요청에 최신 `version` 필수
- 버전 불일치 시 `409 CONFLICT`

## 3) 모듈별 API

## 3.1 Chords API

### GET `/api/v1/chords`
- 설명: 코드 목록 조회
- Query:
  - `root` (optional, 예: `C`)
  - `type` (optional, 예: `major`, `minor`, `7`)
  - `limit`, `cursor`
- Response `data`:
```json
{
  "items": [
    {
      "id": "01JCHORD...",
      "name": "C Major",
      "root": "C",
      "type": "major",
      "tones": ["C", "E", "G"],
      "fingering": [null, 3, 2, 0, 1, 0]
    }
  ]
}
```

### GET `/api/v1/chords/:id`
- 설명: 코드 상세 조회
- Response `data`:
```json
{
  "id": "01JCHORD...",
  "name": "C Major",
  "root": "C",
  "type": "major",
  "tones": ["C", "E", "G"],
  "fingering": [null, 3, 2, 0, 1, 0],
  "diagram": {
    "baseFret": 1
  }
}
```

### GET `/api/v1/chords/quiz`
- 설명: 코드 퀴즈 문제 생성
- Query:
  - `difficulty` (`easy|normal|hard`)
  - `count` (기본 10)
- Response `data`:
```json
{
  "questions": [
    {
      "id": "01JQ...",
      "chordId": "01JCHORD...",
      "promptType": "name_from_tones",
      "prompt": {
        "tones": ["C", "E", "G"]
      },
      "choices": ["C Major", "A Minor", "G Major", "F Major"],
      "answerIndex": 0
    }
  ]
}
```

## 3.2 Scales API

### GET `/api/v1/scales`
- 설명: 스케일 목록 조회
- Query:
  - `root` (optional)
  - `mode` (optional: `major|minor|pentatonic|blues`)
  - `limit`, `cursor`

### GET `/api/v1/scales/:id`
- 설명: 스케일 상세 조회

### GET `/api/v1/scales/pattern`
- 설명: 특정 루트/스케일/포지션의 운지 패턴 조회
- Query:
  - `root` (required)
  - `mode` (required)
  - `position` (required, 1~5)
- Response `data`:
```json
{
  "root": "A",
  "mode": "minor_pentatonic",
  "position": 1,
  "notes": ["A", "C", "D", "E", "G"],
  "fretPositions": [
    {"string": 6, "frets": [5, 8]},
    {"string": 5, "frets": [5, 7]}
  ]
}
```

## 3.3 Metronome API

### GET `/api/v1/metronome/presets`
- 설명: 사용자 메트로놈 프리셋 목록
- Header:
  - `x-user-id` (required)

### POST `/api/v1/metronome/presets`
- 설명: 프리셋 생성
- Header:
  - `x-user-id` (required)
- Body:
```json
{
  "name": "16비트 100bpm",
  "bpm": 100,
  "timeSignature": "4/4",
  "subdivision": "16n",
  "accentPattern": [1, 0, 0, 0]
}
```

### DELETE `/api/v1/metronome/presets/:id`
- 설명: 프리셋 삭제
- Header:
  - `x-user-id` (required)

## 3.4 Phrases API

### GET `/api/v1/phrases`
- 설명: 사용자 프레이즈 목록
- Header:
  - `x-user-id` (required)
- Query:
  - `limit`, `cursor`
  - `sort` (`updated_at_desc` 기본)

### POST `/api/v1/phrases`
- 설명: 프레이즈 생성
- Header:
  - `x-user-id` (required)
- Body:
```json
{
  "title": "A minor lick 1",
  "musicalKey": "A",
  "timeSignature": "4/4",
  "bpm": 90,
  "content": {
    "type": "tab_text",
    "value": "e|----------------5-8-5-----|"
  },
  "loopStart": 0,
  "loopEnd": 8
}
```
- Response `data`:
```json
{
  "id": "01JPHRASE...",
  "version": 1
}
```

### GET `/api/v1/phrases/:id`
- 설명: 프레이즈 단건 조회
- Header:
  - `x-user-id` (required)

### PATCH `/api/v1/phrases/:id`
- 설명: 프레이즈 수정
- Header:
  - `x-user-id` (required)
- Body:
```json
{
  "title": "A minor lick 1 - clean",
  "bpm": 95,
  "version": 3
}
```
- 규칙:
  - `version` 일치 시 수정, 응답에서 `version + 1` 반환
  - 불일치 시 `409 CONFLICT`

### DELETE `/api/v1/phrases/:id`
- 설명: 프레이즈 삭제
- Header:
  - `x-user-id` (required)

## 3.5 Progress API

### POST `/api/v1/progress/sessions`
- 설명: 연습 세션 기록
- Header:
  - `x-user-id` (required)
  - `Idempotency-Key` (required)
- Body:
```json
{
  "category": "scales",
  "targetType": "scale",
  "targetId": "01JSCALE...",
  "bpm": 110,
  "durationSec": 420,
  "result": "success"
}
```
- Response `data`:
```json
{
  "id": "01JSESSION..."
}
```

### GET `/api/v1/progress/sessions`
- 설명: 세션 목록 조회
- Header:
  - `x-user-id` (required)
- Query:
  - `from` (ISO date)
  - `to` (ISO date)
  - `category` (optional)
  - `limit`, `cursor`

### GET `/api/v1/progress/summary`
- 설명: 기간 통계 조회
- Header:
  - `x-user-id` (required)
- Query:
  - `period` (`week|month`)
  - `date` (기준일, 예: `2026-02-14`)
- Response `data`:
```json
{
  "period": "week",
  "totalPracticeSec": 5400,
  "sessionCount": 12,
  "maxStableBpmByCategory": {
    "scales": 120,
    "phrases": 105
  }
}
```

## 4) 유효성 검사 규칙
- `bpm`: 40~240
- `durationSec`: 1~14400
- `timeSignature`: `3/4`, `4/4`, `6/8`만 허용(MVP)
- `title`: 1~120자
- `loopStart < loopEnd` 필수

## 5) D1 테이블 매핑
- `chords` <- Chords API
- `scales` <- Scales API
- `metronome_presets` <- Metronome API
- `phrases` <- Phrases API
- `practice_sessions` <- Progress API
- `idempotency_keys` <- Progress API 멱등성 처리

## 6) API 수용 기준 (DoD)
- 기능별 엔드포인트가 문서와 동일한 JSON 스키마를 반환한다.
- 모든 에러는 공통 에러 포맷을 사용한다.
- 목록 API는 커서 페이지네이션을 사용한다.
- `progress/sessions`는 멱등성이 보장된다.
- `phrases` 수정 시 버전 충돌이 재현 가능하게 처리된다.

