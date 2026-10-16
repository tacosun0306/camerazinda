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

在 `.env.local` 設定 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，並依檔名順序套用 `supabase/migrations/` 內的所有 migration。登入使用 Supabase Auth 電子郵件與密碼；只有 `profiles.active = true` 且 `account_status = 'active'` 的員工可操作。

帳號管理 API 另外需要 server-only 的 `SUPABASE_SERVICE_ROLE_KEY`（或 Supabase 新版 `SUPABASE_SECRET_KEY`），只能設在 Vercel server 環境及 `.env.local`，不可使用 `NEXT_PUBLIC_` 前綴、提交到 Git、送進瀏覽器或記錄在 log。設定 `NEXT_PUBLIC_SITE_URL` 為正式網站 origin，並在 Supabase Auth URL Configuration 加入 `/auth/callback` redirect allowlist。

Supabase Auth 必須關閉「Allow new users to sign up」，只由管理員透過 Auth Admin 邀請建立帳號；同時啟用 email invitations／password recovery 並設定寄信 SMTP。將 invite 與 recovery OTP 有效期限設為不超過 15 分鐘。管理員不輸入、不讀取使用者密碼；首次設定及重設完成前 profile 保持停用，RLS 與 middleware 都會拒絕存取；停用及待重設會撤銷 Auth refresh sessions。

Production 環境變數請在 Vercel Project Settings 設定公開 URL/key、`NEXT_PUBLIC_SITE_URL` 及 server-only Supabase Admin key。不要提交 `.env.local`、service role/secret key、資料庫密碼或 JWT secret。

商品 SKU 由 Supabase `create_inventory_item` RPC 使用資料庫 sequence 產生；「相機」、「攝影機」、「拍立得」對應 `CAM`，「鏡頭」對應 `LEN`，其他分類對應 `ACC`。舊 SKU 不會重編，SKU 建立後不可修改。

SKU 產生 migration 為 `supabase/migrations/202610130003_generate_inventory_sku_by_category.sql`。在 Supabase Dashboard 的 SQL Editor 依序套用 migration 目錄內尚未執行的檔案，再部署應用程式。

商品標籤批次列印頁位於 `/inventory/labels`。型號／啟用狀態欄位及標籤搜尋 RPC 的 migration 為 `202610130004_inventory_model_and_active_status.sql` 和 `202610130005_search_inventory_label_items.sql`；請在 SKU migration 後依序套用。列印頁以資料庫分頁搜尋啟用商品，QR 沿用商品 UUID，不建立或修改商品識別資訊。

實體商品主檔／單位相容 migration 為 `supabase/migrations/202610130006_product_units_and_unit_operations.sql`。在 Supabase SQL Editor 套用前，請確認 `inventory_items.quantity` 等於各 `inventory_stocks.quantity` 加總；migration 會自動檢查，不一致時回滾。套用後，`product_units` 是唯一實體庫存來源，舊商品主檔與分店數量欄位由資料庫同步維持相容。

品牌及新增商品流程 migration 為 `supabase/migrations/202610150001_inventory_brand.sql`。它新增可為空的 `inventory_items.brand`，並提供品牌版新增／編輯 RPC；套用後再部署應用程式，既有 SKU、UUID、庫存與歷史異動不會重建。此 migration 已於 2026-10-15 套用至 Production；本次前端變更仍在 `feature/inventory-product-creation`，尚未部署。

## 範圍

Dashboard、庫存、排班、打卡、維修、人員、角色與操作紀錄需由 Supabase 提供資料；正式使用前需建立員工 Auth 帳號與 profile、套用全部 migrations、執行 RLS 整合測試，並確認未登入請求會被導向登入頁。