# 배포

Turso(데이터베이스) + Vercel(호스팅) + Google OAuth(로그인) 조합입니다.
셋 다 무료 티어로 충분합니다.

> **비밀값은 어디에도 붙여넣지 마세요.**
> 아래 표에 나오는 것은 **환경변수 이름뿐**이고, 값은 Vercel 대시보드에서만
> 입력합니다. 코드에는 하드코딩된 자격증명이 없습니다 — next-auth v5가
> `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`을 환경에서 알아서 읽습니다.

Vercel 도메인이 나와야 Google redirect URI를 확정할 수 있어서,
**4번에서 먼저 배포하고 5번에서 OAuth를 마무리**하는 순서입니다.

> **윈도우 사용자**: 아래 명령은 macOS/Linux 기준입니다. 각 단계에 PowerShell
> 대안을 함께 적어 두었습니다 — `VAR=값 명령` 문법과 `curl | bash`, `openssl`은
> 윈도우에서 그대로 동작하지 않습니다.

---

## 1. Turso 데이터베이스 생성

```bash
curl -sSfL https://get.tur.so/installall.sh | bash   # CLI 설치
turso auth login
turso db create moneybook

turso db show moneybook --url        # → libsql://moneybook-<org>.turso.io
turso db tokens create moneybook     # → 토큰 문자열
```

두 값이 각각 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`이 됩니다.

**윈도우**: 설치 스크립트는 bash 전용이고 Turso CLI는 WSL을 요구합니다. CLI 없이
<https://app.turso.tech> 에서 **Create Database** → 상세 화면의 **Database URL**
복사 → **Create Token** 으로 같은 두 값을 얻을 수 있습니다.

## 2. 프로덕션 DB에 스키마 만들기

**이 단계를 건너뛰면 로그인이 실패합니다** — 어댑터의 첫 쿼리가 없는
`auth_account` 테이블을 읽으려다 죽고, 화면에는 "로그인에 실패했습니다
(Configuration)"만 뜹니다. 화면만 봐서는 원인을 알 수 없으니 여기서 확실히
해 두세요.

`docs/schema.sql` 전체를 Turso 대시보드의 SQL 콘솔에 붙여넣고 실행합니다.
자격증명도 CLI도 필요 없고, 한 문장씩 나눠 실행해도 순서가 맞도록 정렬해
두었습니다. **한 번만** 실행하세요 — 두 번 돌리면 이미 있는 테이블에서
에러납니다.

CLI 쪽을 쓰신다면 환경변수를 주고 drizzle로 적용해도 됩니다:

```bash
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." npx drizzle-kit migrate
```

**윈도우**에는 `VAR=값 명령` 문법이 없습니다. `drizzle-kit`이 `.env`를 직접
읽으므로 그쪽이 간단합니다:

```powershell
Copy-Item .env.example .env    # TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 만 채우기
npm run db:migrate
```

끝나면 **`.env`의 Turso 값을 지우세요.** 남겨 두면 로컬 `npm run dev`가
프로덕션 데이터베이스를 직접 건드립니다.

> Vercel 환경변수를 **Sensitive**로 저장했다면 그 값은 대시보드로도 CLI로도
> 다시 읽을 수 없습니다. 배포 런타임만 볼 수 있어서, 위의 `.env` 방식을 쓰려면
> 토큰을 Turso에서 따로 가져와야 합니다. `docs/schema.sql` 쪽은 자격증명이
> 아예 필요 없습니다.

### 적용됐는지 확인

Turso 대시보드의 SQL 콘솔에서:

```sql
select name from sqlite_master where type = 'table';
```

`sections` `accounts` `transactions` `transaction_lines` `exchange_rates`
`budgets` `auth_user` `auth_account` `auth_session` `auth_verification_token`
10개가 보이면 정상입니다.

## 3. AUTH_SECRET 생성

```bash
npx auth secret        # 또는: openssl rand -base64 32
```

**윈도우**: `openssl`이 기본 설치되어 있지 않습니다. `npx auth secret`을 쓰거나,
PowerShell 내장 암호학적 난수를 쓰세요 (`Get-Random`은 암호학적으로 안전하지
않으니 쓰지 마세요):

```powershell
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)
```

## 4. Vercel 배포

1. <https://vercel.com> → **Add New → Project** → `penghouse/moneybook` import
2. Framework는 Next.js로 자동 감지됩니다. Build/Output 설정은 **기본값 그대로** 두세요.
3. **Environment Variables** (Production·Preview 모두에 추가):

   | 이름                 | 값                                    |
   | -------------------- | ------------------------------------- |
   | `TURSO_DATABASE_URL` | 1번의 URL                             |
   | `TURSO_AUTH_TOKEN`   | 1번의 토큰                            |
   | `AUTH_SECRET`        | 3번의 값                              |
   | `AUTH_GOOGLE_ID`     | 5번에서 발급 (먼저 배포 후 채워도 됨) |
   | `AUTH_GOOGLE_SECRET` | 5번에서 발급                          |
   | `ALLOWED_EMAILS`     | 본인 이메일 (쉼표로 여러 개 가능)     |

   `AUTH_NAVER_ID` / `AUTH_NAVER_SECRET`은 선택입니다. 설정하지 않으면
   **네이버 로그인 버튼 자체가 나오지 않습니다** (`auth.ts`가 `AUTH_NAVER_ID`
   유무로 프로바이더를 켭니다).

4. **Deploy** → 배포 URL 확인 (예: `moneybook-xxxx.vercel.app`)

> `AUTH_URL`은 넣지 않아도 됩니다. next-auth v5가 Vercel이 자동 주입하는
> `VERCEL` 환경변수를 감지해 `trustHost`를 켭니다
> (`@auth/core/lib/utils/env.js`에서 확인). Vercel이 아닌 곳에 올린다면
> `AUTH_URL` 또는 `AUTH_TRUST_HOST=true`가 필요합니다.

## 5. Google OAuth 클라이언트 생성

1. <https://console.cloud.google.com> → 프로젝트 생성 (예: `moneybook`)
2. **APIs & Services → OAuth consent screen**
   - User Type: **External**
   - 앱 이름 `moneybook`, 지원 이메일 본인
   - 스코프는 기본(email, profile)만
   - **Test users에 본인 이메일을 추가하고 "게시"하지 마세요.** 테스트 모드로
     두면 등록한 사람만 로그인할 수 있어, 개인용에는 이쪽이 오히려 안전합니다
     (앱의 `ALLOWED_EMAILS` 허용목록과 이중 방어).
3. **Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://<4번의 도메인>`
   - Authorized redirect URIs: `https://<4번의 도메인>/api/auth/callback/google`
   - 로컬 개발도 쓰려면 `http://localhost:3000` 과
     `http://localhost:3000/api/auth/callback/google` 도 추가
4. 발급된 Client ID / Secret을 **Vercel 환경변수**에 넣고 재배포

## 배포가 안 될 때 — 자가진단

로그인이 **"로그인에 실패했습니다 (Configuration)"**로 끝나면 원인이 화면에
안 나옵니다. 없는 테이블, 안 채운 환경변수, 잘못된 토큰이 전부 같은 문구로
보입니다. 앱에 물어보세요.

Vercel 환경변수에 `DIAGNOSTICS=1`을 임시로 추가하고 재배포한 뒤:

```
https://<도메인>/api/health
```

이런 답이 옵니다:

```json
{
  "database": {
    "host": "moneybook-xxx.turso.io",
    "reachable": true,
    "missingTables": ["auth_account"]
  },
  "environment": { "TURSO_DATABASE_URL": true, "AUTH_SECRET": true, "ALLOWED_EMAILS": 1 },
  "verdict": "Schema is missing 1 table(s)."
}
```

읽는 법:

- **`host`** — 앱이 실제로 보고 있는 데이터베이스입니다. 여기가 `local file`이면
  `TURSO_DATABASE_URL`이 그 환경에 안 들어갔다는 뜻입니다.
- **`missingTables`** — 비어 있어야 정상입니다. 뭔가 있으면 마이그레이션이
  **이 데이터베이스에는** 적용되지 않은 겁니다.
- **`reachable: false`** — URL은 맞는데 닿지 못하는 상태입니다. 토큰을
  의심하세요.
- **`environment`** — 값이 아니라 **설정 여부만** 나옵니다
  (`ALLOWED_EMAILS`는 개수).

**확인이 끝나면 `DIAGNOSTICS`를 지우고 다시 배포하세요.** 값은 안 나가지만
설정 상태를 공개 URL이 알려줄 이유는 없습니다.

로그를 볼 수 있다면 Vercel → Logs에서 `[moneybook auth]`로 찾으면 됩니다 —
드라이버가 낸 원래 문장까지 단계별로 찍힙니다.

## 6. 배포 후 점검

- [ ] `/` 접속 → `/login`으로 리다이렉트
- [ ] 허용목록 이메일로 Google 로그인 → 통과
- [ ] 허용목록 **밖** 계정으로 시도 → 차단되는지 (한 번은 확인해 볼 가치가 있습니다)
- [ ] 거래 1건 입력 → `/assets`에 반영
- [ ] `/settings` → CSV 4종 내보내기 다운로드
- [ ] 홈화면에 추가 → 주소창 없이 뜨는지 (PWA)
- [ ] **외래키 강제 확인** — 거래가 있는 계정을 `/accounts`에서 삭제해 보고
      "거래가 있는 계정은 삭제할 수 없습니다"가 뜨는지. 앱은 `onDelete: restrict`를
      데이터베이스가 막아 주는 데 의존하는데, 원격에서는 이게 서버 설정이라
      클라이언트에서 켤 수 없습니다 (`db/client.ts` 참고). 삭제가 그냥 되면
      분개선이 고아가 되므로 한 번은 실제로 확인할 값어치가 있습니다.
- [ ] **하단 바와 iOS 홈 인디케이터가 겹치지 않는지** —
      `env(safe-area-inset-bottom)`은 실기기에서만 값이 잡혀 자동 테스트가
      확인하지 못하는 부분입니다.
- [ ] **환율 자동 조회** — 외화 계정을 만들고 환율이 자동으로 채워지는지.
      개발 샌드박스에서는 frankfurter.app이 프록시에 막혀 있어 **모의 테스트로만
      검증된 부분**입니다. 실제 네트워크에서 처음 확인되는 지점입니다.

---

## 이후 운영

- **스키마 변경**: `npm run db:generate` → 커밋 → 프로덕션에
  `TURSO_... npx drizzle-kit migrate`. `docs/schema.sql`은 첫 설치용이라
  이후 변경분은 반영되지 않습니다 — 새 마이그레이션은 drizzle로 적용하세요.
- **재배포**: 기본 브랜치(`master`)에 push하면 Vercel이 자동으로 빌드합니다
- **타임존**: Vercel은 UTC가 기본이라 별도 설정이 필요 없습니다
  (앱이 UTC 저장 + 섹션 타임존 표시 전제)
- **백업**: `/settings`에서 CSV 4종을 주기적으로 내려받으세요
- **복원 용량**: Vercel은 요청 본문 4.5MB 하드 리밋이 있어 약 3만 건이
  상한입니다. `next.config.ts`의 `serverActions.bodySizeLimit`은 32MB로
  올려 두었지만 **Vercel의 리밋은 이 설정으로 올릴 수 없습니다.** 그 이상은
  파일을 나눠서 가져오거나 자체 호스팅하시면 됩니다.
