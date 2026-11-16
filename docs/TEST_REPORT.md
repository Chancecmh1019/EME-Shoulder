# 實測報告・2026-11-14

## 2026-11-16 最新進度（以下舊報告保留為歷史）

完整系統仍為 **No-Go**。已實際用獨立 Mornye-Python 2.0.6、官方 utilities／TIDAL 插件及正常驗證工作階段，下載 Stray Kids — November 11th：25,063,494 bytes，SHA-256 `e92e8a9d0be2fdcef5b60eada9bdc7cd874a52c99e9178c93eeef2a30e34d333`。FFmpeg 全長解碼成功，186 秒、44.1 kHz、stereo、16-bit FLAC-in-MP4。重啟後驗雜湊重用，不重新下載。QQ 真實回應取得 67 行原文，去除四行標題／製作名單。

依擁有者最新最低驗收政策，medium 全曲加一次結尾短段恢復，首句、末句辨識文字相符；全曲 offset -360 ms 後首末殘差 -73／+68 ms，原始 LRC 未覆寫。中間 38 行保留辨識不確定警示，不宣稱全曲完美對時。原始提示詞完整保留，promptHash `0a8755caa6aca7303531807f3d8a8742597e729a759ac52e4267eacb696404d7`。

實際 PCM 衍生 WAV 32,810,478 bytes，原始與衍生音訊解碼 PCM SHA 完全一致。本機瀏覽器實際載入歌曲交接套件與 WAV，雜湊相符、duration=186；重新載入後可接續，沒有要求 DB／S3。證據在 ignored `.studio/acquisition/jobs/e060cefc00b424696ae8/` 與 `.studio/evidence/dot-local-real-audio.jpg`，不提交歌曲或秘密。

已完成的既有檢查曾通過 29 tests、TypeScript 與隔離 build；後續新增的 YouTube transport／清理測試屬合成協定測試，不能當真實上傳。依擁有者最後指示不再重跑檢查。新預設為 Dot 電腦暫存模式；PostgreSQL/S3 為選用。原網站 correctLyrics 已接到翻譯提交，原文／時間維持不變。尚未驗收：真正 Dot 雲端執行、完整歌曲翻譯／全長影片與縮圖、Google OAuth／Private upload、小專輯及完整清理 E2E。沒有真實 YouTube upload、main merge 或正式部署。

供應商錯誤：YouTube 插件 Cobalt 404、yt1d 400；Qobuz store 403。TIDAL 正常工作階段完成後取得完整音檔。YouTube Music 搜尋／專輯辨識已實測；它的原生下載功能存在，但本機上述備援未成功，不能宣稱手機及所有環境相同。

## 範圍與結論

工作目錄 `D:/Projects Studio/EME Shoulder`，branch `feat/eme-studio-2`，baseline `9f34162`。僅修改 EME application；四份 upstream ZIP 直接唯讀檢視，未解壓或匯入。正式站／main／遠端服務未修改。

**本機翻譯交接核心已實作並驗證；完整 Studio 2.0 尚未完成，release No-Go。** 新 Studio 沒有呼叫外部翻譯模型、音訊下載或真實 YouTube upload。測試中的「外部翻譯提交」是手寫 synthetic fixture，不能當成 Dot 實測。

## 指令與結果

| 指令／測試 | 實際結果 |
| --- | --- |
| git status / branch / log / remote | baseline tracked tree 無修改，原先有 owner 文件和 ZIP 未追蹤；main 為文件指定 production branch |
| git switch -c feat/eme-studio-2 | 初次受 .git 權限限制；授權的本機操作經提升後成功，沒有 push |
| npm ci --prefer-offline --no-audit --no-fund | **失敗**：EPERM rmdir node_modules/.cache；現有依賴仍可執行。另有 EBADENGINE：本機 Node v26.13.0，專案目標 22.x |
| npm run check（baseline） | 通過 |
| npm run build（baseline） | **失敗**：既有 dist/apple-touch-icon.png EPERM，沒有刪除該目錄 |
| npm test | 16 tests 通過；最初 1 個錯誤訊息斷言失敗，修正為檢查 typed code 後通過 |
| npm run check（新增程式後） | 通過 |
| npm run build -- --outDir .studio/build | 通過；現有大型 bundle 警告仍存在 |
| npm run dev -- --port 3001 | 首次因 node_modules/.vite/deps EPERM 失敗；cacheDir 改用 .studio/vite 後成功 |
| node scripts/inspect-render.mjs .studio/evidence/render-30s.mp4 30 .studio/evidence/render-30s-inspection.json | 通過：1920×1080、AVC、AAC、1800 frames、60 fps、30.016 s |
| git diff --check | 通過；有 Git LF→CRLF 提示，原提示詞 bytes 驗證通過 |

沒有新增 dependency；沿用 lockfile 與已安裝的 TypeScript、OpenCC、Mediabunny。測試 loader 使用本專案編譯器並有 Node experimental-loader 警告；Node 22 CI、全新 clean npm ci 與 production dependency install 仍待驗證。沒有現成 lint/format command，未捏造已跑 lint。

## 自動化涵蓋

- 提示詞整檔 bytes 與 baseline 完全相同，套件 literal 與 SHA-256 相符。
- 原文來源版本、prompt 真正更新造成 conflict；不靜默覆寫。
- BOM/CRLF、zero-timestamp 原文、sentinel 多次 round-trip、contextual credit cleaning audit、同時戳原文、CJK、多語文字、拒絕 offset/word timing/亂序。
- 原文／時間／行數／ID 不變；逗號修正 audit；缺繁中與重複行變化 warning。繁中檢查以 OpenCC 異體差異作複核旗標，不宣稱語意正確。
- SQL restart、immutable revision/events、idempotency replay、不同 payload conflict、專輯一首取消另一首繼續。
- 重啟後由獨立 owner-scoped result endpoint 取回已保存雙語 LRC；Dot UI 可讀回結果並明確建立新版本重譯，不覆寫舊 revision。
- transaction 無 partial album、兩個 SQLite connections 競爭 claim、120 秒租約、heartbeat、過期與最多 3 次、舊 worker fencing、接受後 receipt replay。
- HTTP 未登入 401、跨 owner 404、CSRF 403、不支援 method 405、過大 413、不存在 token action、持久化 rate limit。
- 舊 parser sentinel 與獨立 SRT round-trip。尚沒有完整舊 MV／Threads browser E2E，也沒有代表性 artwork 的 pixel regression。

## 真實本機瀏覽器／媒體證據

Chrome 157 / Windows，本機 `http://127.0.0.1:3001/render-probe`：secure context、WebGL、H.264、AAC、IndexedDB write/read 全數可用。實際呼叫既有 `renderTrack` + `BookletScene`，產生程式自製 440 Hz WAV 與雙語測試字句。

30 秒 MP4：8,505,175 bytes，耗時 29.271 秒；從已下載檔案用 Mediabunny 另行重讀，1920×1080、AVC、AAC mono/48kHz、1800 frames、平均 60 fps、duration 30.016 秒。這是 container/packet 檢查，非 ffprobe、全片 decode、loudness 或 black-frame scan。畫面觀察到 26 秒處的 CD-Booklet 封面／曲名／雙語滾動，非全片視覺 parity。沒有真正歌曲的音源版本／音訊校時驗證。

本機檔案（全部位於 ignored `.studio/evidence/`，不提交大檔）：

- `render-30s.mp4`：實際影片。
- `render-30s.json`：瀏覽器能力及 runtime report。
- `render-30s-inspection.json`：另行讀取 MP4 的檢查。
- `render-30s.jpg`：實際渲染報告與影片畫面。
- `dot-android.jpg`（412×915）、`dot-tablet.jpg`（820×1180）、`dot-desktop.jpg`（1440×900）：未登入入口狀態。

Android 尺寸 read-only DOM measurement：innerWidth=412、scrollWidth=412；重新檢查按鈕 height=48。未登入時確實阻擋資料存取。登入後表單未在真實 OAuth session 內做 browser E2E；不能將入口 screenshot 當成完整 Android workflow 驗收。瀏覽器 blob helper 不支援直接擷取；點擊正常下載後檔案實際位於 Downloads，再複製到 evidence。工具等待下載事件逾時，但檔案後續確認存在且 inspection 通過。

## 階段與未完成項目

| 階段 | 狀態 |
| --- | --- |
| Phase 0 | 本機 audit、isolated branch、tests、能力探針、30 秒真 render 已驗證；Dot 環境、Node 22、clean install、180 秒／合法 full-track 尚未驗證 |
| Phase 1 | 本機 SQL／owner-scoped HTTP／translation handoff 已驗證；HTTP auth 使用注入 test identity；真正 OAuth／Dot、PostgreSQL、S3、scoped capability 未完成 |
| Phase 2 | 來源 ZIP 已研究；身份解析、QQ/Apple live adapters、合法音訊驗證尚未實作 |
| Phase 3 | 現有 scene 的本機 30 秒輸出通過；immutable production package、獨立 worker/fallback、full media QA 尚未實作 |
| Phase 4 | 新 server-side credential vault、resumable upload、Private enforcement/reconciliation 尚未實作；新 Studio 上傳停用。舊版 token path 尚待遷移 |
| Phase 5 | album domain 單曲隔離測試通過；手機入口實測；完整 automation、migration、新 human studio 尚未實作 |
| Phase 6 | No-Go；沒有真 Dot → 雲端儲存 → 合法音檔 → worker → owner-approved Private upload 的完整示範 |

特別限制：新 source model 保留多個相同 timestamp 的原文，但舊 `parseLRC` 仍以相同 timestamp group 表示一個 bilingual block。多個完整 bilingual pairs 同時開始的跨舊工作區匯入，仍需要明確 migration/regression 設計。沒有擅自改寫舊多行 translation 的既有語義。

下一個實作里程碑：PostgreSQL/S3 與新 owner/Dot scope，測試真 OAuth 和資料庫重啟；再做 identity/provider/audio 與 immutable render package。應先實作 adapter 與測試，再由擁有者在獨立 staging 配置服務；不得因需要帳號就把未實作模組標成完成。真 Dot cloud 與 Private upload 都需要實機和另行授權。
