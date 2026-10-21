# GoodLift 텔레그램 봇 — Cloudflare 무료 플랜 배포

기존 Windows Python 봇을 대신하는 서버용 JavaScript 버전입니다. 텔레그램 Webhook으로 메시지가 왔을 때 실행하므로 개인 컴퓨터를 계속 켜 둘 필요가 없습니다.

## 가능한 작업

- 운동 이름의 공백 무시, 최신 목록 자동 조회
- 운동 자체 검색: `에이비덕션 검색`, `운동검색 덕션` — 부분 일치와 공백/괄호 무시, 정확한 원본 이름 표시
- 날짜/무게/횟수/세트를 해석해 확인 버튼으로 등록
- 날짜별 운동 기록 조회: 날짜만 입력하거나 `2026-10-22 조회`, `오늘 조회`, `어제 조회` (한국 시간)
- 운동별 날짜 검색: `벤치프레스 언제 했어`, `레그프레스 기록 조회` — 날짜별로 세트 수를 합쳐 최근 10일 표시
- 세트 무게·횟수 수정, 특정 세트 제거, 운동 기록 전체 삭제
- D1에 확인 대기 내용과 처리 내역 저장, `/history`로 최근 10개 결과 조회
- 본인의 개인 대화에서만 명령 처리
- 같은 내용을 새 메시지로 보내 다시 등록하는 것을 허용 (운동 내용의 중복 검사 없음)
- Telegram이 같은 이벤트를 재전송하거나 같은 버튼을 반복 누르는 경우에는 외부 작업을 재실행하지 않음

## 입력 예

운동 이름이 기억나지 않으면 최신 운동 목록에서 검색합니다. 본인의 운동 기록 유무와 관계없이 검색할 수 있습니다. 괄호 기호와 공백을 무시해 부분 일치로 찾지만, 다른 표기의 단어를 같은 운동으로 추측하지는 않습니다. 예를 들어 `에이비덕션`과 `어브덕션`은 다른 검색어입니다. `덕션 검색`처럼 짧게 입력하면 더 넓게 찾을 수 있습니다. 결과는 최대 30개이며, 표시된 원본 이름을 등록에 사용합니다.

```text
에이비덕션 검색
운동검색 덕션
어브덕션아웃타이 검색
```

운동별 검색은 한 줄로 입력합니다. 공백을 제외한 운동 이름 전체가 일치하는 기록만 찾습니다. 벤치프레스와 인클라인 벤치프레스는 구분합니다. 같은 날짜의 기록은 합치고, 날짜를 최근 순으로 정렬해 최대 10개 날짜를 표시합니다. GoodLift API가 반환한 본인 기록을 대상으로 검색하며 별도로 기록을 변경하지 않습니다.

```text
벤치프레스 언제 했어
레그 프레스 기록 조회
```

조회는 한 줄로 입력합니다. 한국어 날짜 `2026년 10월 22일`도 가능합니다. 오늘·어제는 한국 시간 기준입니다. 조회는 GoodLift의 최신 기록을 읽으며, 대기 중인 등록·수정·삭제 확인 버튼은 유지합니다. 세트/시간/메모를 표시하고 긴 결과는 여러 메시지로 나누어 보냅니다.

```text
2026-10-22
2026-10-22 조회
오늘 조회
어제 조회
```

등록은 여러 줄로 입력합니다.

```text
2026-10-22
벤치프레스30kg10회3세트
레그 프레스 100 kg 10 회 1 세트, 이후 12개씩 3세트
```

수정·삭제는 한 줄로 입력합니다.

```text
2026-10-22 레그프레스 2~4세트 무게 120kg으로 수정
2026-10-22 레그프레스 2세트 횟수 15회로 수정
2026-10-22 레그프레스 3~4세트 삭제
2026-10-22 레그프레스 전체 삭제
```

같은 날 같은 운동 기록이 여러 개면 자동으로 선택하지 않습니다. 시간 운동과 자유로운 자연어는 현재 지원하지 않습니다. 남는 세트의 ID/완료 상태를 보존하고 부분 삭제 후 세트 번호를 다시 매깁니다. 확인 버튼은 15분 뒤 만료되며 새 명령을 보내면 이전 버튼은 무효화됩니다.

## 요금 확인

2026-10-21 공식 문서 원본 확인 기준:

- Workers Free: 하루 요청 100,000회, 요청당 CPU 10ms.
- D1 Free: 하루 읽기 500만 행, 쓰기 10만 행, 총 저장 공간 5GB.
- 네트워크 대기 시간은 Workers CPU 시간에 포함되지 않습니다.
- 무료 한도 안에서 사용해야 하며, 유료 플랜 업그레이드를 선택하지 않습니다. 다른 프로젝트와 계정 한도를 공유합니다. 무료 플랜에서 실제 CPU 사용량은 배포 후 확인해야 합니다.

공식 문서: https://developers.cloudflare.com/workers/platform/pricing/ 및 https://developers.cloudflare.com/d1/platform/pricing/

## Windows에서 배포 준비

1. Cloudflare 계정에 가입하고 Workers Free를 사용합니다. 개인 도메인 구매는 필요 없습니다.
2. Node.js 공식 사이트 https://nodejs.org/ 에서 LTS를 설치합니다. PowerShell을 다시 열고 `node --version`, `npm.cmd --version`으로 확인합니다.
3. 이 프로젝트를 압축 해제한 폴더로 이동합니다. 기존 Python 폴더와는 다른 폴더를 사용합니다.
4. 설치 및 로그인:

```powershell
npm.cmd ci
npm.cmd test
npx.cmd wrangler login
```

로그인 명령은 브라우저를 열어 본인의 Cloudflare 계정 승인을 받습니다. 비밀번호/API 토큰을 채팅에 보내지 않습니다.

## 데이터베이스 생성

```powershell
npx.cmd wrangler d1 create workout-bot
```

출력의 `database_id`를 복사해 `wrangler.jsonc`의 `REPLACE_WITH_YOUR_D1_DATABASE_ID`만 교체합니다. 파일의 DB binding 이름은 `DB`로 유지합니다.

```powershell
npm.cmd run db:remote
```

## 비밀 정보 설정

각 명령 뒤 나오는 비밀 입력창에서 값을 입력합니다. 코드, GitHub, 채팅에 값을 붙이지 않습니다.

```powershell
npx.cmd wrangler secret put TELEGRAM_BOT_TOKEN
npx.cmd wrangler secret put TELEGRAM_USER_ID
npx.cmd wrangler secret put TELEGRAM_CHAT_ID
npx.cmd wrangler secret put GOODLIFT_USERNAME
npx.cmd wrangler secret put GOODLIFT_PASSWORD
npx.cmd wrangler secret put WEBHOOK_SECRET
```

처음 명령에서 Worker가 없어서 만들겠냐고 물으면 `goodlift-telegram-bot` 생성에 동의합니다. WEBHOOK_SECRET은 본인이 생성한 임의의 영문/숫자 32자 이상으로 설정합니다. Telegram은 영문/숫자/밑줄/하이픈만 허용합니다. PowerShell에서 `[guid]::NewGuid().ToString('N')`으로 만들 수 있습니다. 이 값은 이후 Postman의 Webhook 연결에도 동일하게 사용합니다.

이 설정으로 서버가 실행될 때마다 직접 비밀번호를 입력할 필요가 없습니다. 앱은 요청을 처리할 때 GoodLift에 로그인하고 계정 ID를 확인합니다. 로그인 실패는 처리 결과로 알려줍니다. 토큰/비밀번호는 D1 처리 내역에 저장하지 않습니다. 운동 내용은 개인 정보이므로 D1 접근 권한은 본인만 유지합니다.

## 배포 및 Telegram 연결

```powershell
npm.cmd run deploy
```

출력에 실제 `https://goodlift-telegram-bot.<본인계정>.workers.dev` 주소가 나옵니다. 이를 Postman Collection 변수 `worker_url`에 저장합니다 (끝의 `/` 제외).

**기존 Windows Python 봇은 Ctrl+C로 종료합니다. Webhook 연결 후에는 Postman getUpdates도 사용하지 않습니다.** 기존 확인 버튼은 새 서버에서 인식되지 않으므로 필요한 명령은 새로 보냅니다.

Postman에 기존 `telegram_bot_token`을 유지하고, `telegram_webhook_secret`에 위 WEBHOOK_SECRET을 로컬 비밀 값으로 보관합니다. 실제 키가 들어간 URL이나 Console은 공유하지 않습니다.

새 POST 요청:

```text
https://api.telegram.org/bot{{telegram_bot_token}}/setWebhook
```

Body → raw → JSON:

```json
{
  "url": "{{worker_url}}/webhook",
  "secret_token": "{{telegram_webhook_secret}}",
  "allowed_updates": ["message", "callback_query"],
  "max_connections": 1,
  "drop_pending_updates": false
}
```

`max_connections: 1`로 명령과 버튼 처리가 겹치지 않도록 합니다. `ok: true`를 확인한 다음 GET 요청으로 연결 상태를 봅니다.

```text
https://api.telegram.org/bot{{telegram_bot_token}}/getWebhookInfo
```

`url`이 실제 Worker `/webhook` 주소이고, 새 테스트 메시지를 보냈을 때 `pending_update_count`가 줄고 새로운 `last_error_message`가 없는지 확인합니다. 과거 오류 항목이 남을 수 있으므로 오류 발생 시간도 봅니다.

## 최종 확인

1. 텔레그램에서 `/help`를 보내 답장을 받습니다.
2. 운동 기록을 보내 [취소] 동작부터 확인합니다.
3. 실제로 추가할 기록 하나를 등록하고 GoodLift에서 확인합니다.
4. 그 기록의 세트 수정/부분 삭제/전체 삭제를 확인합니다.
5. `/history`로 처리 내역을 확인합니다. 시간은 한국 시간입니다.
6. 컴퓨터를 끄고 휴대폰 텔레그램에서 `/help`와 실제 명령을 확인합니다.

배포 전 테스트는 가짜 GoodLift/Telegram 응답을 사용합니다. 실제 계정, Cloudflare 네트워크에서 GoodLift 접속, 무료 CPU 한도 충족, 컴퓨터 종료 후 동작은 위 절차로 별도 검증해야 합니다. GoodLift 무료 서버가 잠들어 있으면 첫 요청이 느리거나 실패할 수 있습니다. 쓰기 요청 결과가 불명확하면 자동 재시도하지 않으므로 사이트에서 먼저 확인합니다. `시작(결과 미확인)` 내역은 실행이 중단됐을 수 있으니 확인이 필요합니다.

## 처리 내역 관리

D1 `history` 테이블에 작업 종류, 상태, 등록 예정 내용 또는 변경 전후 내용을 저장합니다. 자동 삭제는 하지 않습니다. Cloudflare D1 Console에서 조회/내보내기/삭제할 수 있습니다. `pending`에는 확인 대기 내용이 남으며 만료된 버튼은 사용할 수 없습니다. 필요하면 오래된 pending/deliveries/history 행을 D1 Console에서 정리합니다.

## 로컬 개발

Node 22.13 이상(검증 Node 24), `npm ci`, `npm test`를 사용합니다. `npm run db:local`, `npm run dev`로 로컬 Worker를 실행합니다. 실제 비밀 값이 필요한 로컬 설정은 Git에서 제외된 `.dev.vars`에만 둡니다. `npm run deploy -- --dry-run`은 업로드 없이 번들만 검증합니다.
