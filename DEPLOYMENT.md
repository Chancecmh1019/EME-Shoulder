# EME-Shoulder：GitHub 與 Vercel 部署

原始碼：https://github.com/Chancecmh1019/EME-Shoulder

## 準備項目

- GitHub 帳號與此倉庫的存取權。
- Vercel 帳號，可使用 GitHub 登入。
- 一個 Google Cloud 專案，以及實際用於 YouTube 頻道的 Google 帳號。
- Google OAuth 的 Web application Client ID 與 Client Secret。
- 32 bytes 隨機產生的 SESSION_SECRET，採 Base64 格式。
- 固定的正式網站網址。Vercel 提供的正式網域即可，不必先購買自訂網域。

Git 提交姓名與 Email 只用於標示作者，不等於 GitHub 或 Google 登入授權。

## 1. 匯入 GitHub 倉庫

在 https://vercel.com/new 登入後，選擇 Import Git Repository → Chancecmh1019/EME-Shoulder。
若看不到倉庫，調整 GitHub integration 的倉庫存取範圍，允許存取 EME-Shoulder。

建置設定：

| 項目 | 設定 |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | 倉庫根目錄 |
| Install Command | npm ci |
| Build Command | npm run build |
| Output Directory | dist |
| Production Branch | main |
| Node.js Version | 22.x |

先按 Deploy，取得專案的固定正式網址。尚未設定 OAuth 時，網站仍可整理歌詞及本機匯出影片；Google／YouTube 連線功能會顯示設定提示。
請使用專案正式網域，不要將每次變動的 commit preview URL 當成 APP_ORIGIN。

## 2. 設定 Google Cloud

1. 開啟 https://console.cloud.google.com/ ，建立或選擇專案。
2. 到 APIs & Services → Library，啟用 YouTube Data API v3。
3. 在 Google Auth Platform 設定 Branding（應用名稱、支援 Email 等）、Audience 與 Data Access。個人 Gmail 使用 External audience；處於 Testing 時，將實際頻道的 Google Email 加入 Test users。
4. 本專案請求 openid、email、youtube.upload 與 youtube.readonly；授權時允許上傳與讀取頻道兩項 YouTube 權限。
5. 到 Clients 建立 OAuth Client ID，Application type 選 Web application。
6. Authorized JavaScript origins 填正式網站的 origin，例如 https://你的專案.vercel.app（不加結尾斜線、不含路徑）。
7. Authorized redirect URIs 填 https://你的專案.vercel.app/api/auth?action=callback 。完整網址、query、大小寫與正式網域必須一致。
8. 保存 Client ID 與 Client Secret，後續填入 Vercel，不要寫進 GitHub。

Google 授權請使用一般 Chrome／Edge 視窗；嵌入式瀏覽器可能受到 Google 登入限制。若 Google 顯示測試模式授權到期，重新連接；公開使用前依 Google 要求完成應用驗證。

## 3. 設定 Vercel 環境變數

到 Project → Settings → Environment Variables，新增下列五項，套用到 Production。

| 名称 | 值 |
| --- | --- |
| APP_ORIGIN | 正式網址的 origin，例如 https://你的專案.vercel.app |
| GOOGLE_CLIENT_ID | Google OAuth Web client 的 Client ID |
| GOOGLE_CLIENT_SECRET | 同一個 Web client 的 Client Secret |
| OWNER_EMAIL | 實際登入 YouTube 頻道的 Google Email；若是 chance5234972@gmail.com 就填此值 |
| SESSION_SECRET | 32 bytes 隨機資料的 Base64 字串 |

在本機終端執行以下指令即可產生 SESSION_SECRET；將結果貼到 Vercel 後保存在自己的密碼管理工具中：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

不要加 VITE_ 前綴：這些設定屬於伺服器端，不能公開到前端。Client Secret 與 SESSION_SECRET 可標示為 Sensitive。不要將金鑰、OAuth credentials JSON 或 .env 檔提交到 GitHub。

設定後到 Deployments → 最新的 Production deployment → Redeploy。環境變數變更需要新的部署才會生效。
若日後改用自訂網域，同時更新 APP_ORIGIN 與 Google 的 authorized origin／redirect URI，再重新部署與授權。

## 4. 連接頻道與確認產出

開啟正式網站 → Settings → 登入 Google 並連接 YouTube，使用 OWNER_EMAIL 對應的 Google 帳號登入，允許權限，確認顯示正確的頻道。
先匯入一首自己的音訊與 LRC，確認預覽，再以 Private 隱私執行 Approve, Render & Upload。
完成後到 YouTube Studio 確認影片、聲音、歌詞、標題、說明與縮圖。自訂縮圖需要頻道具備對應資格。

音訊、影片及專案資料保存在瀏覽器，影片在本機以 1080p／60 FPS 編碼，再直接上傳 Google；Vercel 不替你渲染整首影片。
localhost 與正式網站的 IndexedDB 是不同空間，本機已匯入的歌曲不會自動出現在正式網站，請重新匯入原始素材。

## 後續更新

修改後提交並推送到 main，Vercel 的 Git integration 會建立新的正式部署。環境變數留在 Vercel，不隨 Git 推送。

## 官方文件

- Vite on Vercel：https://vercel.com/docs/frameworks/frontend/vite
- Vercel 環境變數：https://vercel.com/docs/environment-variables
- Google Web server OAuth：https://developers.google.com/identity/protocols/oauth2/web-server
- YouTube OAuth：https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
