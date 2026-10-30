# sexytw.cc

獨立新網站的前台、後台、Cloudflare Worker 部署設定與人物資料同步程式。

## 結構

- `app/`：網站前台、後台與 API
- `components/`：共用版面及後台表單
- `lib/`：Supabase、SEO、圖片與同步共用邏輯
- `scripts/edc-profile-sync.mjs`：公開資料同步程式
- `.github/workflows/profile-sync.yml`：每 6 小時自動同步，亦可手動執行
- `.github/workflows/deploy-worker.yml`：手動部署 Cloudflare Worker
- `wrangler.jsonc`：獨立 Cloudflare Worker 設定

## 本機建置

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

## 環境設定

公開設定請參考 `.env.example`。以下資料必須使用 Cloudflare Secrets 與 GitHub Actions Secrets，禁止寫進原始碼：

- `SUPABASE_SERVICE_ROLE_KEY`
- `PROFILE_SYNC_SECRET`
- `INDEXNOW_KEY`

正式網域為 `https://sexytw.cc`。使用獨立東京 Supabase 專案 `lsxrpubpbnshlqnnddgu`，不得設定原站資料庫或同步密鑰。
