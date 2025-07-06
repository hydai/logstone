# Nodestone Worker

Cloudflare Workers 版本的 Nodestone - FFXIV Lodestone 解析服務。

## 功能特點

- 使用 Cloudflare Workers 部署，全球低延遲
- 整合 KV 儲存進行快取，減少對 Lodestone 的請求
- 快取時間可設定（預設 24 小時）
- 自動處理快取過期和更新

## 部署步驟

### 1. 安裝依賴

```bash
yarn install
```

### 2. 建立 KV Namespace

```bash
wrangler kv:namespace create "LOGSTONE"
```

將輸出的 ID 更新到 `wrangler.toml` 中的 `YOUR_KV_NAMESPACE_ID`。

### 3. 部署到 Cloudflare Workers

```bash
yarn deploy
```

## 使用方式

部署後，可以透過以下 API 查詢角色資料：

```
GET https://your-worker.workers.dev/character/{characterId}
```

範例：
```bash
curl https://your-worker.workers.dev/character/123456
```

回應格式：
```json
{
  "Character": {
    "ID": 123456,
    "Name": "Character Name",
    "Server": "Server Name",
    // ... 其他角色資料
  }
}
```

## 回應標頭

- `X-Cache-Status`: `HIT` (快取命中) 或 `MISS` (快取未命中)
- `Access-Control-Allow-Origin`: 僅允許來自 ff14.tw 的請求

## 環境變數

在 `wrangler.toml` 中可設定：

- `CACHE_TTL`: 快取存活時間（秒），預設 86400（24小時）

## 本地開發

```bash
yarn dev
```

這會啟動本地開發伺服器，可在 `http://localhost:8787` 測試。

## 限制

- 目前只支援查詢角色基本資料
- HTML 解析使用簡化版本，部分複雜欄位可能無法正確解析
- 僅支援北美資料中心的角色查詢
- CORS 限制：只允許來自 `https://ff14.tw`、`https://www.ff14.tw` 和 `http://localhost:3000`（開發用）的請求

## CSS Selectors 來源

本專案使用的 CSS selectors 來自：https://github.com/xivapi/lodestone-css-selectors