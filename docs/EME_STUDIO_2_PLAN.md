# EME Studio 2.0 實作計畫

> 2026-11-16 最新擁有者決策優先：EME 協調、Dot 電腦執行及暫存、專用工具原生運行；Private 上傳處理成功後清理本次素材。PostgreSQL／S3 改為選用模式，不是預設前提。最低校對為錄音身分、完整音檔與首末句對應，可有紀錄地全曲加減毫秒；不要求完美全曲 ASR。以下早期雲端持久化計畫為歷史，不得用來覆蓋此決策。

## 起點與來源

2026-11-14，`D:/Projects Studio/EME Shoulder`，remote `Chancecmh1019/EME-Shoulder`，起點 `9f34162`。原始 tracked working tree 無修改；兩份需求文件、handoff ZIP 與四份參考 ZIP 原本未追蹤。已完整閱讀 Master Prompt 與 Engineering Blueprint，執行順序採 Master 的 Phase 0–6（Blueprint 的階段粒度不同）。`DEPLOYMENT.md` 明列 production branch 為 main；未查詢或變更遠端 Vercel。

四份 ZIP 直接以唯讀 ZIP reader 檢視，不解壓、不複製來源：Lyrico-Plugins 的 qq/apple source、lib、manifest；Mornye-Extension 的 ytmusic-spotiflac/soundcloud；Lyrico Android repository/plugin lifecycle；Mornye Flutter/Rust 宿主。QQ helper 使用 Platform.http/cache；Apple 依賴 Platform XML、developer token 與 media user token／第三方服務。Mornye 使用 http/file/宿主權限與特定 runtime features，不能直接當 Node 模組使用。未採用其下載、token 或 challenge 處理。Mornye archives 為 LGPL-3.0-only；Lyrico host Apache-2.0；Lyrico plugin ZIP 未發現根目錄 LICENSE，禁止複製至應用。

## 已觀察的差距與保留映射

| 原始模組 | 決策 |
| --- | --- |
| scene.ts / background.ts / Preview.tsx | 保留 BookletScene 與確定性時間；不另造字幕模板 |
| renderEngine.ts | 保留 1920×1080/60fps AVC/AAC；能力探針先於 worker 遷移 |
| storage.ts / library.ts | 舊版 IndexedDB 保留；新 Studio 服務端資料庫獨立，禁止冒稱已遷移 |
| queue.ts pump | visibilityState 限制只屬舊流程；新工作租約必須服務端原子操作 |
| parsers.ts / lyricCorrection.ts | 修正零秒 sentinel，SRT 分支保留；新 source normalizer 不把同時間原文誤當翻譯 |
| translationPrompts.ts | 原始 bytes 不改，直接 import 精確 lrc literal 並 SHA-256 |
| auth.ts / youtube.ts | 舊 token 路徑為待移轉風險；新 Studio 僅取 owner identity，沒有 token action 或上傳捷徑 |
| Workspace / LrcLab / ThreadsClip / Protection | 保留舊版能力，新增隔離 /dot，整體改版待新垂直流程驗證 |

## 架構與依賴圖

Phase 0 audit/probes → Phase 1 server repository + secure translation handshake → Phase 2 identities/providers/media → Phase 3 immutable package + identical-scene executor → Phase 4 private upload/reconciliation → Phase 5 album/mobile/migration → Phase 6 live gates。

React/Vite 延用。先實作可測的純 LRC domain、SQL repository、owner-scoped API、Dot 語意化 UI。SQLite（Node 22.13+）與雜湊檔案儲存僅本機驗證，需設定路徑，serverless 一律 fail closed。PostgreSQL 與 S3 為 staging 正式權威來源，未配置前不得宣稱跨裝置可用或啟用伺服器部署。此選擇讓目前無帳號／無 DB 環境可驗證 transaction、restart、lease、idempotency；不能取代雲端里程碑。

資料逐步加入：albums/jobs、tracks、source revisions、translation revisions、events、action receipts、leases；assets 使用 owner/hash 去重。未有實作需求前不加空的 YouTube/renderer 表。未執行任何 production migration。

安全：現有加密 HttpOnly owner session；新 endpoint 不返回任何 Google token。每項資料 SQL owner 篩選，mutation origin/header 檢查、大小限制、schema validation、交易、唯一鍵、immutable events。歌詞一律資料；不 fetch 任意輸入網址。測試使用注入的身份依賴，正式 handler 不提供測試登入。

## 階段門檻與目前狀態

- Phase 0：來源與分支已確認；本機 Node 26.13.0（目標仍 22.x）。baseline check 通過；npm ci 因 node_modules/.cache EPERM 失敗；baseline build 因既有 dist/apple-touch-icon.png EPERM 失敗。改以隔離 build output 驗證，不刪使用者檔案。Dot 實機探針待執行。
- Phase 1：本機 SQL／owner-scoped HTTP／Dot Control／版本鎖交接切片已實作；16 tests、TypeScript、隔離 build 通過。雲端 PostgreSQL/S3、正式登入、scoped capability 與 Dot 實測仍為未完成門檻。完整證據見 TEST_REPORT.md。
- Phase 2–6：未通過前序完整門檻；不可標記完成。只可進行不依賴外部帳號的測試／介面工作。

## 尚待外部條件

需要獨立 staging DB、S3 相容 bucket、owner OAuth、Dot 實際雲端環境、合法完整音檔與歌詞，以及另行授權的 Private 測試。不得請使用者在聊天貼 secret。無採購、無 remote push、無 deploy、無 main merge。

本機 30 秒渲染實驗：既有 BookletScene/encoder 實際輸出，MP4 30.016 s、1920×1080、AVC/AAC、1800 frames / 60 fps，約 29.271 s 完成。此為 Phase 0 技術探針，不表示 Phase 3 worker 或 Dot 通過。Android 入口 412 px 無水平溢出；登入後流程待真 OAuth E2E。
