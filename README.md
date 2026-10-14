# Camera Store OS

相機店內部營運管理平台，使用 Next.js App Router、TypeScript、Tailwind CSS 與 Supabase。

## 開發

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

所有內頁皆需 Supabase Auth 登入；未設定資料庫連線時，內頁會拒絕存取。

## Supabase

在 `.env.local` 設定 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，並依檔名順序套用 `supabase/migrations/` 內的所有 migration。登入使用 Supabase Auth 電子郵件與密碼，員工需有 `profiles` 記錄且 `active = true` 才能操作。僅使用可公開於瀏覽器的 publishable/anon key；不得設定 service role key、資料庫密碼或 JWT secret 為前端變數。

Production 環境變數請在 Vercel Project Settings 設定上述兩個公開變數，並確認只含 Supabase publishable/anon key；不要提交 `.env.local` 或設定 service role key、資料庫密碼、JWT secret。

商品 SKU 由 Supabase `create_inventory_item` RPC 使用資料庫 sequence 產生；「相機」對應 `CAM`、「鏡頭」對應 `LEN`，其他分類對應 `ACC`。舊 SKU 不會重編，SKU 建立後不可修改。商品 QR 使用固定商品 UUID，掃描時由資料庫載入最新資料；重印標籤不會建立新商品或 SKU。

SKU 產生 migration 為 `supabase/migrations/202610130003_generate_inventory_sku_by_category.sql`。在 Supabase Dashboard 的 SQL Editor 依序套用 migration 目錄內尚未執行的檔案，再部署應用程式。

商品標籤批次列印頁位於 `/inventory/labels`。型號／啟用狀態欄位及標籤搜尋 RPC 的 migration 為 `202610130004_inventory_model_and_active_status.sql` 和 `202610130005_search_inventory_label_items.sql`；請在 SKU migration 後依序套用。列印頁以資料庫分頁搜尋啟用商品，QR 沿用商品 UUID，不建立或修改商品識別資訊。

實體商品主檔／單位相容 migration 為 `supabase/migrations/202610130006_product_units_and_unit_operations.sql`。在 Supabase SQL Editor 套用前，請確認 `inventory_items.quantity` 等於各 `inventory_stocks.quantity` 加總；migration 會自動檢查，不一致時回滾。套用後，`product_units` 是唯一實體庫存來源，舊商品主檔與分店數量欄位由資料庫同步維持相容。

## 範圍

Dashboard、庫存、排班、打卡、維修、人員、角色與操作紀錄需由 Supabase 提供資料；正式使用前需建立員工 Auth 帳號與 profile、套用全部 migrations、執行 RLS 整合測試，並確認未登入請求會被導向登入頁。