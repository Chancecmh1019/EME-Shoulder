# Staging 與遷移 Runbook

**目前 No-Go：不可部署為完整 Studio 2.0。沒有 push、deploy、production DB migration 或 main merge。**

本機可執行：`npm test`、`npm run check`、`npm run dev`。原 dist 若因 Windows 權限無法清空，可用 `npm run build -- --outDir .studio/build`；此為隔離本機輸出，不會改寫正式網站。Vite cache 已移至 `.studio/vite`，避免寫入既有 node_modules cache。

`.env.example` 僅包含名稱、空值與說明。OAuth 與 session 設定由擁有者放在本機 `.env.local`；EME_STUDIO_LOCAL_DB 指向專用 `.studio` SQLite 檔，不要指向 production 資料。API 在 VERCEL 或 NODE_ENV=production 時禁止使用這個 adapter。靜態 preview 不代表 API 已可用。

真正 staging 上線之前：

1. 實作並測試 PostgreSQL repository 與可重複 migrations，獨立 owner scopes、leases、unique receipts；不能將 SQLite 複製進 Vercel ephemeral filesystem 冒充 durable cloud。
2. 實作 S3 相容物件儲存、owner namespace、hash 去重、短效 signed URL、大小/MIME/實際解碼驗證、quota/retention/cleanup。未完成前媒體仍在舊版 browser storage。
3. 配置獨立 OAuth client、origin、callback、DB、bucket 與伺服器 secret vault。保留 PKCE/state/nonce；移除 browser access-token 依賴後才將 Dot 授權與 Google consent 分離。
4. 完成 rendering worker／output QC、Private-only upload、ambiguous-success reconciliation。預設 preview 無上傳能力。請擁有者批准後才進行真實 Private 測試。
5. 執行 Android/tablet/desktop UI、舊 Booklet/MV/Threads、跨 session、worker crash、Dot 實機及完整 song E2E。

現有 IndexedDB 尚未遷移。不能清除網站資料；保留原素材與 master。日後 migration 需 owner export manifest（版本、hash、assets、lyrics、offset、review、video ID），server hash 去重匯入並比對，再標記完成；現版沒有可用的自動 migration 按鈕。

Rollback：本次未動 production；放棄 feature branch 即維持 baseline。若日後 preview 發生問題，停用新 Studio endpoint，保留 DB/objects 與 immutable history，再回舊 UI；不能透過清空 DB 回復。尚無 production migration 或正式 rollback 實測。沒有採購，沒有捏造成本報價；真正成本取決於測得的儲存量、流量與渲染耗時。
