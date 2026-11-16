# 首次設定：隔離 Staging 與 Dot 入口

> **2026-11-16 架構修正：預設不需要下面的 Supabase／PostgreSQL／S3。** `/dot` 現在使用 Dot 電腦的暫存檔案與瀏覽器工作台；`/studio-render` 使用同一電腦的原 CD-Booklet 引擎。以下雲端持久化章節僅供主動選用 `/dot-cloud` 的情況。網站可先以零環境變數部署為隔離 Preview；這不代表 Dot 的終端、Google 授權或完整製作已驗收。

預設操作：開啟 `/dot-guide` 複製完整首次指令；執行電腦安裝 Node 22+、Python 3.11+，在本專案執行 `npm ci`、`node scripts/install-source-providers.mjs`。Mornye 使用獨立 venv：`python -m venv .studio/tools/mornye`，再用該 venv 的 Python 安裝 `mornye==2.0.6`，執行 `scripts/mornye-external.py setup`。語音／FFmpeg 依賴以 `python -m pip install --target .studio/python -r scripts/requirements-audio-worker.txt` 安裝。Linux 使用 `python3` 及 venv 的 `bin/python`；Windows 使用 `Scripts/python.exe`。

來源任務使用 `npm run acquire -- run scripts/acquisition-stray-kids.json`，接著 `external-task JOB_ID`。Mornye 的 `execute --task TASK_FILE --source VERIFIED_URL` 產生真實音檔後，以 `ingest-external RECEIPT_FILE` 匯入，`verify JOB_ID medium` 核對；必要時一次 `recover-ending JOB_ID`，或 `offset JOB_ID MILLISECONDS` 記錄全曲校時。通過後 `package-file JOB_ID` 產生 `/dot` 的完整交接檔。網站只在本電腦讀入音檔，不傳大型檔案到 Vercel。

Dot 依完整原始提示詞直接輸出雙語 LRC，一次貼入網站或以 `submit-file JOB_ID translation.lrc` 提交；會經原網站繁體／格式校正。`package-render-file JOB_ID` 產生渲染套件，於 `/studio-render` 選取套件、WAV 與封面，輸出影片、縮圖、報告。真實翻譯、全長渲染與上傳仍需實測；不能以本機取詞／下載成功當完整驗收。

YouTube worker 使用擁有者另外配置的 Desktop OAuth client JSON（放 `.studio/private/`，不要貼給 Dot），環境變數只有 worker 的 `EME_YOUTUBE_CLIENT_FILE` 與 `EME_YOUTUBE_OWNER_EMAIL`；不放網站前端。`node --loader ./scripts/typescript-loader.mjs scripts/private-publish.ts doctor` 只回報設定是否存在。實際 publish 必須先有全長產物、權利確認及針對 videoSha256 的擁有者批准檔；目前沒有做真實上傳。Private、processed、succeeded 與縮圖均確認後，才依批准清除該任務暫存，失敗不得刪檔。

GitHub：使用 `feat/eme-studio-2`，不要 merge main。Vercel：登入後建立新的測試專案，Node 22、Vite、build `npm run build`、output `dist`；在預設暫存模式不用填下面的資料庫變數。CLI 用 `npx vercel deploy --local-config vercel.staging.json`，不要 `--prod` 或正式 domain。尚未登入時由擁有者完成 `npx vercel login`；暫時 Preview 若可建立仍須擁有者認領。現有正式站不變。

狀態：**No-Go；這是設定與整合驗證流程，並非完整製作系統驗收。** 程式已接入 PostgreSQL、S3 SDK、獨立登入與驗證關卡，但沒有替你建立、登入或部署任何第三方資源。完整歌曲大檔、供應商、ASR／獨立 worker、server-side YouTube 仍有未實作部分。請先設定環境，不要拿正式專輯反覆嘗試這些已知缺口。

## 1. GitHub：由你登入與確認

1. 用瀏覽器登入 GitHub，開啟 `Chancecmh1019/EME-Shoulder`，選擇 **feat/eme-studio-2**。
2. 保留 main，不按 Merge、不將開發分支設定成現有正式專案的 Production Branch。
3. 本次已獲准推送此開發分支；實際推送結果請看 TEST_REPORT 最新紀錄。若登入或權限不足，需你完成 GitHub 登入／repository write 權限，不要把 PAT、SSH 私鑰貼在聊天。
4. 這個分支的 `vercel.json` 已設 `git.deploymentEnabled=false`，防止 Git push 自動觸發部署。這不代表有修改 main 或 Vercel 控制台。

## 2. Supabase：由你建立專用測試專案

1. 登入 [Supabase Dashboard](https://supabase.com/dashboard)，建立新專案，例如 `eme-studio-staging`。選擇你核可的方案與區域；任何費用／條款由你決定。不要連到正式資料庫。
2. 保存專案 database password 到自己的密碼管理工具。不要提供給 Dot。
3. 在 SQL Editor，依序開啟並執行 repository 中兩份檔案的**完整內容**：
   - `supabase/migrations/202611140001_studio.sql`
   - `supabase/migrations/202611150002_pair_gate.sql`
4. 這是**你手動執行的 Staging migration**。應用程式不會在登入或 API 請求中執行 migrations。若 SQL 報錯，保留錯誤訊息（遮掉任何密碼）交由工程處理，不要刪庫重建或不斷重跑。
5. 另外建立低權限連線帳號。下面密碼佔位文字必須由你在 SQL Editor 改成新的長隨機密碼，不能用範例文字：

```sql
CREATE ROLE eme_staging_login LOGIN PASSWORD 'REPLACE_IN_YOUR_SQL_EDITOR_ONLY';
GRANT eme_app TO eme_staging_login;
```

6. 點 **Connect**，選擇 **Transaction pooler**，記下連線參數。使用 `eme_staging_login` 這個角色；若 pooler username 需要專案識別，格式為 `eme_staging_login.PROJECT_REF`。將密碼正確 URL encode；不要把原本 `postgres` 管理者連線當 runtime credential。不要設定關閉 TLS 驗證。若需要 CA，從 Supabase 取得 CA certificate，放入 DATABASE_CA_CERT。
7. `eme` schema 不要加入 Data API exposed schemas。migration 已啟用 RLS，僅 backend group 有權限；anon／authenticated 不直接存取 Studio 資料。

## 3. Supabase Auth：只允許擁有者登入

1. Authentication → Users，手動建立／邀請你自己的擁有者 email，完成信箱確認；與 STUDIO_OWNER_EMAIL 完全相同。應用不會自動幫新 email 建帳號。
2. Authentication → Email Templates → Magic Link，在內容中加入 `{{ .Token }}`，讓信件顯示一次性數字驗證碼，而不是只給登入連結。例如：`你的 EME 驗證碼：{{ .Token }}`。
3. Email provider 的 OTP expiration 建議 600 秒。平台可能有寄信頻率／收件者限制；若需要 SMTP，必須由你建立並核可郵件服務。程式每分鐘最多請求一次寄信，驗證 challenge 最多五次。
4. 記下 Supabase URL 與 publishable key。這裡仍全部放在 Vercel server environment；沒有要求在前端使用它們。無需 Google OAuth／YouTube 授權即可登入新 Studio。

## 4. Supabase Storage：私人桶與 S3 金鑰

1. Storage 建立一個新 bucket，例如 `eme-staging-private`；**Public 必須關閉**。不要建立 public policy。
2. Storage S3 設定中啟用 S3 connection，建立 S3 Access Key ID／Secret Access Key，記下 endpoint 與 region。使用該專案的 `https://PROJECT_REF.storage.supabase.co/storage/v1/s3`，不要任意填其他網址。
3. 在 project API keys 取得 legacy `service_role` key，用於伺服器確認 bucket 確實不是 public。S3 金鑰與 service_role 都有高權限，只能放 server environment；不能給 Dot、貼 prompt、放 GitHub 或使用 VITE_ 前綴。
4. 目前可用的小檔上傳路徑上限 **3 MiB／檔、100 MiB／owner**。音訊 PCM 16-bit WAV 可完整檢查；其他壓縮格式只有 metadata，必須等待獨立解碼 worker，不能放行翻譯。大型完整歌曲／MP4 分段傳輸尚未可用，請勿嘗試大檔重傳。

## 5. Vercel：建立全新的隔離專案

1. 由你登入 Vercel，建立新專案 `eme-studio-staging`；不要選既有正式 EME 專案，不加入正式網域，不重新指定 main。
2. 安裝／使用官方 CLI，由你完成登入：`npx vercel login`。在 repository 根目錄用 `npx vercel link`，仔細選擇剛建立的 staging 專案；`.vercel` 僅本機保存且不提交。這一步是 owner 登入／建立資源，不是已代辦完成。
3. Node.js 設為 **22.x**。Framework Vite，Build `npm run build`，Output `dist`。首次手動 Preview 部署使用 `vercel.staging.json`。
4. 為這個 Preview 選一個**新的專用固定 alias**，例如你自己決定的 `UNIQUE_STAGING_ALIAS.vercel.app`。不可使用現有正式 domain。STUDIO_ORIGIN 必須是這個固定 alias 的 HTTPS origin，沒有斜線或路徑；不要每次填變動的 deployment URL，否則 CSRF 檢查會拒絕。
5. 在新 staging project 的 Environment Variables 建立下表，**只選 Preview**。不要複製正式 Google secrets。敏感欄位使用 Vercel 的敏感值設定，不在截圖或 log 展示。

| 變數 | 要填什麼 |
| --- | --- |
| EME_DEPLOYMENT | `staging` |
| STUDIO_ORIGIN | 上一步新 alias 的完整 HTTPS origin |
| STUDIO_OWNER_EMAIL | 你在 Supabase Auth 已確認的擁有者 email |
| DATABASE_URL | 低權限 `eme_staging_login` 的 pooler PostgreSQL URL |
| DATABASE_CA_CERT | 若平台 TLS 需要，填取得的 CA PEM；可用真實換行或 `\n` |
| SUPABASE_URL | 專案的 HTTPS API origin |
| SUPABASE_PUBLISHABLE_KEY | 專案 publishable／anon API key（仍只放 server） |
| SUPABASE_SERVICE_ROLE_KEY | 此 staging 專案 legacy service_role key |
| S3_ENDPOINT | 同專案 S3 endpoint，結尾 `/storage/v1/s3` |
| S3_REGION | S3 設定顯示的 region |
| S3_BUCKET | 私人 bucket 名稱 |
| S3_ACCESS_KEY_ID | 此 staging 專案 S3 access key |
| S3_SECRET_ACCESS_KEY | 對應 S3 secret |

6. 你確認專案與環境後，手動執行 **Preview** 部署：

```powershell
npx vercel deploy --local-config vercel.staging.json
```

7. CLI 顯示 Preview URL 後，由你將新的專用 alias 指向它：

```powershell
npx vercel alias set PREVIEW_DEPLOYMENT_URL UNIQUE_STAGING_ALIAS.vercel.app
```

不要使用 `--prod`、Promote、Production Deploy 或現有正式網域。程式在 `VERCEL_ENV=production` 會拒絕新 Studio API。若 alias 名稱不可用，換新名稱，同步更新 STUDIO_ORIGIN 並再做 Preview 部署。

8. 若 Vercel Deployment Protection 擋住 Dot，先由你評估並在 Dot 瀏覽器完成 Vercel 合法登入。若選擇讓這個**隔離 staging** 公開到登入頁，僅由你核准其 Protection 設定；應用自身仍強制 OTP／配對。不要把 Vercel bypass secret 放 Dot prompt，不能改既有正式專案的保護設定。

## 6. 首次 owner／Dot 整合測試

1. 你在自己的瀏覽器開固定 alias 的 `/studio-access`。點寄送驗證碼，親自從信箱取得並輸入；確認畫面是擁有者。收不到信時先檢查 Supabase email template、收件限制與 SMTP，不要連續點擊。
2. 讓 Dot 開同一 origin 的 `/dot`，點「產生 Dot 配對碼」。Dot 可告知十碼配對碼；那不是登入密碼，也不能單獨取得存取權。
3. 你在 `/studio-access` 親自核對並核准該碼。讓 Dot 按「確認授權」。授權兩小時，只能處理該次 grant 建立的任務，沒有 Google、S3 或 DB 金鑰。
4. Dot 建立一首你已獲權使用、含兩句原文 LRC 的小測試任務。此時必須是 AUDIO_PENDING，取得翻譯套件必須被阻擋；不能用 mock 動作繞過 gate。
5. 你在自己的 `/dot` 開該任務，進入「擁有者音訊歌詞對照」，上傳符合小檔限制、確實含該兩句人聲的 PCM WAV。完整聆聽後填逐句實際原文、開始／結束毫秒及版本依據。不要對純音或不含歌詞音檔填假證據。
6. 若檢查指出錯音檔／錯歌詞，依診斷更換；若是全曲 offset／局部 drift，使用保存的證據建立校時版本，**重新驗證**。證據不足時停止該曲，不能硬標 pass。ASR 自動查證尚未接入。
7. 僅 TRANSLATION_READY 時，Dot 才可讀完整原始 EME 指令與 hashes，提交一首測試翻譯。檢查雙語 LRC、sentinel、QA 和 history。這是實際 Dot 操作才可標記；Codex fixtures 不算。
8. 關閉 owner／Dot 頁面，重開仍應見同一任務、版本與結果。重新做一次 Preview 部署（同 DB、同 alias），再檢查同一資料，證明不是單一 request 或瀏覽器記憶體。
9. Owner 撤銷 grant，Dot 下一次 API 請求應 401；另一個未配對瀏覽器不得讀任務或素材。Owner 音檔不應有 public URL。

可選的 server-side 儲存測試：在自己的本機 `.env.staging.local` 填入同組 server 設定，增加 `EME_RUN_STAGING_CHECK=1`，執行下列指令兩次，確認 IDs 相同。此測試會寫一個小的 owner-created 文字任務／素材，不會上傳 YouTube：

```powershell
node --env-file=.env.staging.local --loader ./scripts/typescript-loader.mjs scripts/staging-check.ts
```

這不能代替 real Dot、歌詞供應商、完整歌曲渲染與 Private upload 驗收。若失敗，保留無秘密的錯誤代碼，勿關閉 TLS／改成 public bucket。

## 7. 目前不要進行的驗收

尚不可宣稱：自動 QQ／Apple 已可靠取詞、音訊人聲自動辨識、完整歌曲 large-file worker pipeline、真正 Dot cloud render、YouTube server-side Private delivery。不要用舊版 Google token API 在 staging 測試上傳；該 API 已封鎖。完整製作 E2E 與小專輯故障恢復仍是後續 Go／No-Go 門檻。

官方設定依據：[PostgreSQL 連線](https://supabase.com/docs/guides/database/connecting-to-postgres)、[S3 server keys](https://supabase.com/docs/guides/storage/s3/authentication)、[S3 相容限制](https://supabase.com/docs/guides/storage/s3/compatibility)、[Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[Vercel Preview](https://vercel.com/docs/deployments/environments)、[CLI local config](https://vercel.com/docs/cli/global-options)。Supabase S3 不支援版本還原；本系統以內容雜湊與不可變更 DB revisions 保存版本，尚未實作自動 retention cleanup。
