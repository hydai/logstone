# Nodestone Worker

Cloudflare Workers 版本的 Nodestone - FFXIV Lodestone 解析服務。提供完整的角色、自由部隊、成就、寵物、坐騎等遊戲資料查詢 API。

## 功能特點

- 🚀 使用 Cloudflare Workers 部署，全球低延遲
- 💾 整合 KV 儲存進行智慧快取，減少對 Lodestone 的請求
- ⏱️ 分層快取策略（基本資料 24 小時，成就/收藏品 48 小時）
- 🔄 自動處理快取過期和更新
- 📄 支援分頁查詢（成就、部隊成員）
- 🎮 完整資料支援：
  - 角色基本資料（含 FreeCompany、PvPTeam 資訊）
  - 職業等級（戰鬥、製作、採集、特殊內容）
  - 成就系統（含總數、點數、分頁）
  - 自由部隊（基本資料、房產、聲望、重點活動）
  - 部隊成員列表
  - 寵物/坐騎收集

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

部署後，可以透過以下 API 查詢資料。所有 API 端點都支援 `dc` 參數指定資料中心：
- `na` (預設): 北美資料中心
- `jp`: 日本資料中心

### 1. 角色基本資料

```
GET https://your-worker.workers.dev/character/{characterId}?dc={dataCenter}
```

範例：
```bash
# 北美資料中心 (預設)
curl https://your-worker.workers.dev/character/123456

# 日本資料中心
curl https://your-worker.workers.dev/character/123456?dc=jp
```

回應格式：
```json
{
  "Character": {
    "ID": 123456,
    "Name": "Character Name",
    "Server": "Server Name",
    "Title": "Title Name",
    "NameDay": "1st Sun of the 1st Astral Moon",
    "Town": "Limsa Lominsa",
    "Tribe": "Hyur",
    "Race": "Midlander",
    "GrandCompany": {
      "Name": "Maelstrom",
      "Rank": "Storm Captain"
    }
    // ... 其他角色資料
  }
}
```

### 2. 職業等級資料

```
GET https://your-worker.workers.dev/character/{characterId}/classjob?dc={dataCenter}
```

範例：
```bash
# 北美資料中心 (預設)
curl https://your-worker.workers.dev/character/123456/classjob

# 日本資料中心
curl https://your-worker.workers.dev/character/123456/classjob?dc=jp
```

回應格式：
```json
{
  "CharacterID": 123456,
  "ClassJobs": {
    "CombatJobs": {
      "Tank": {
        "Paladin": {
          "Level": "90",
          "UnlockState": "-",
          "CurrentEXP": "0",
          "MaxEXP": "0"
        },
        "Warrior": {
          "Level": "85",
          "UnlockState": "-",
          "CurrentEXP": "1234567",
          "MaxEXP": "2345678"
        },
        "DarkKnight": {
          "Level": "80",
          "UnlockState": "-",
          "CurrentEXP": "0",
          "MaxEXP": "0"
        },
        "Gunbreaker": {
          "Level": "70",
          "UnlockState": "-",
          "CurrentEXP": "123456",
          "MaxEXP": "234567"
        }
      },
      "Healer": {
        "WhiteMage": { /* ... */ },
        "Scholar": { /* ... */ },
        "Astrologian": { /* ... */ },
        "Sage": { /* ... */ }
      },
      "MeleeDPS": {
        "Monk": { /* ... */ },
        "Dragoon": { /* ... */ },
        "Ninja": { /* ... */ },
        "Samurai": { /* ... */ },
        "Reaper": { /* ... */ }
      },
      "RangedDPS": {
        "Bard": { /* ... */ },
        "Machinist": { /* ... */ },
        "Dancer": { /* ... */ }
      },
      "MagicalDPS": {
        "BlackMage": { /* ... */ },
        "Summoner": { /* ... */ },
        "RedMage": { /* ... */ },
        "BlueMage": { /* ... */ }
      }
    },
    "CraftingJobs": {
      "Carpenter": {
        "Level": "90",
        "UnlockState": "-",
        "CurrentEXP": "0",
        "MaxEXP": "0"
      },
      "Blacksmith": { /* ... */ },
      "Armorer": { /* ... */ },
      "Goldsmith": { /* ... */ },
      "Leatherworker": { /* ... */ },
      "Weaver": { /* ... */ },
      "Alchemist": { /* ... */ },
      "Culinarian": { /* ... */ }
    },
    "GatheringJobs": {
      "Miner": {
        "Level": "90",
        "UnlockState": "-",
        "CurrentEXP": "0",
        "MaxEXP": "0"
      },
      "Botanist": { /* ... */ },
      "Fisher": { /* ... */ }
    },
    "SpecialContent": {
      "Eureka": {
        "Name": "Elemental Level",
        "Level": "60",
        "CurrentEXP": "123456",
        "MaxEXP": "234567"
      },
      "Bozja": {
        "Name": "Resistance Rank",
        "Level": "25",
        "Mettle": "1234567"
      }
    }
  }
}
```

#### 職業資料欄位說明

每個職業包含以下欄位：
- `Level`: 職業等級
- `UnlockState`: 解鎖狀態（"-" 表示已解鎖）
- `CurrentEXP`: 當前經驗值
- `MaxEXP`: 升級所需總經驗值

特殊內容額外欄位：
- `Name`: 內容名稱（如 Elemental Level、Resistance Rank）
- `Mettle`: Bozja 專屬的 Mettle 點數

### 3. 成就資料

```
GET https://your-worker.workers.dev/character/{characterId}/achievements?page={page}&dc={dataCenter}
```

範例：
```bash
# 北美資料中心 (預設)
curl https://your-worker.workers.dev/character/123456/achievements?page=1

# 日本資料中心
curl https://your-worker.workers.dev/character/123456/achievements?page=1&dc=jp
```

回應格式：
```json
{
  "CharacterID": 123456,
  "Achievements": [
    {
      "ID": "2744",
      "Name": "Tank You, Endwalker III",
      "Time": "2024-01-15T12:34:56.000Z"
    }
  ],
  "TotalAchievements": 2567,
  "AchievementPoints": "24530",
  "Pagination": {
    "Page": 1,
    "PageTotal": 52,
    "PageNext": 2,
    "PagePrev": null
  }
}
```

#### 成就資料欄位說明

- `Achievements`: 成就列表陣列
  - `ID`: 成就 ID
  - `Name`: 成就名稱
  - `Time`: 取得時間（ISO 8601 格式）
- `TotalAchievements`: 總成就數量
- `AchievementPoints`: 成就點數
- `Pagination`: 分頁資訊
  - `Page`: 當前頁碼
  - `PageTotal`: 總頁數
  - `PageNext`: 下一頁頁碼（如果有）
  - `PagePrev`: 上一頁頁碼（如果有）

### 4. 自由部隊資料

```
GET https://your-worker.workers.dev/freecompany/{freecompanyId}?dc={dataCenter}
```

範例：
```bash
# 北美資料中心 (預設)
curl https://your-worker.workers.dev/freecompany/123456789

# 日本資料中心
curl https://your-worker.workers.dev/freecompany/123456789?dc=jp
```

回應格式：
```json
{
  "FreeCompany": {
    "ID": "123456789",
    "Name": "Company Name",
    "Tag": "«TAG»",
    "Slogan": "Company slogan here",
    "CrestLayers": [
      "https://img.finalfantasyxiv.com/lds/pc/global/images/fc/layer/bottom.png",
      "https://img.finalfantasyxiv.com/lds/pc/global/images/fc/layer/middle.png",
      "https://img.finalfantasyxiv.com/lds/pc/global/images/fc/layer/top.png"
    ],
    "Server": {
      "World": "Tonberry",
      "DC": "Elemental"
    },
    "GrandCompany": {
      "Name": "Maelstrom",
      "Rank": "Rank 8"
    },
    "ActiveState": "Active",
    "Recruitment": "Open",
    "ActiveMemberCount": "512",
    "Rank": "8",
    "Ranking": {
      "Weekly": "--",
      "Monthly": "123"
    },
    "Formed": "2013-08-27T00:00:00.000Z",
    "Estate": {
      "Name": "Estate Name",
      "Greeting": "Welcome to our estate!",
      "Plot": "Plot 30, 1st Ward, Mist (Medium)"
    },
    "Reputation": {
      "Maelstrom": "Allied",
      "OrderoftheTwinAdder": "Neutral",
      "ImmortalFlames": "Neutral"
    },
    "Focus": [
      "Role-playing",
      "Leveling",
      "Casual"
    ],
    "Seeking": [
      "Tank",
      "Healer",
      "DPS",
      "Crafter",
      "Gatherer"
    ]
  }
}
```

### 5. 自由部隊成員列表

```
GET https://your-worker.workers.dev/freecompany/{freecompanyId}/members?page={page}&dc={dataCenter}
```

範例：
```bash
# 北美資料中心 (預設)
curl https://your-worker.workers.dev/freecompany/123456789/members?page=1

# 日本資料中心
curl https://your-worker.workers.dev/freecompany/123456789/members?page=1&dc=jp
```

回應格式：
```json
{
  "FreeCompanyID": "123456789",
  "Members": [
    {
      "Avatar": "https://img2.finalfantasyxiv.com/f/avatar.jpg",
      "ID": "987654321",
      "Name": "Character Name",
      "FCRank": "Master",
      "FCRankIcon": "https://img.finalfantasyxiv.com/lds/h/icon.png",
      "Rank": "Second Storm Lieutenant",
      "RankIcon": "https://img.finalfantasyxiv.com/lds/h/rank_icon.png",
      "Server": {
        "World": "Tonberry",
        "DC": "Elemental"
      }
    }
  ],
  "Pagination": {
    "Page": 1,
    "PageTotal": 11,
    "PageNext": 2,
    "PagePrev": null
  }
}
```

### 6. 寵物收集

```
GET https://your-worker.workers.dev/character/{characterId}/minions?dc={dataCenter}
```

範例：
```bash
# 北美資料中心 (預設)
curl https://your-worker.workers.dev/character/123456/minions

# 日本資料中心
curl https://your-worker.workers.dev/character/123456/minions?dc=jp
```

回應格式：
```json
{
  "CharacterID": 123456,
  "Minions": [
    {
      "Name": "Minion-07bdde521e18e58ce3629e0266ad946df929a7e6",
      "Icon": "https://lds-img.finalfantasyxiv.com/itemicon/6c/6c0932ba8e21c47200b7d65d3c88714fe33ed8d2.png"
    }
  ],
  "Total": 425
}
```

#### 寵物資料欄位說明

- `Minions`: 寵物列表陣列
  - `Name`: 寵物識別碼（從 tooltip URL 提取）
  - `Icon`: 寵物圖標 URL
- `Total`: 擁有的寵物總數

### 7. 坐騎收集

```
GET https://your-worker.workers.dev/character/{characterId}/mounts?dc={dataCenter}
```

範例：
```bash
# 北美資料中心 (預設)
curl https://your-worker.workers.dev/character/123456/mounts

# 日本資料中心
curl https://your-worker.workers.dev/character/123456/mounts?dc=jp
```

回應格式：
```json
{
  "CharacterID": 123456,
  "Mounts": [
    {
      "Name": "Mount-9045c5c5d5d181ee495f0e76af07d6d93c9f0f13",
      "Icon": "https://lds-img.finalfantasyxiv.com/itemicon/e6/e6cd1b44f2e625546c0a4c4ee9dff3de07b02082.png"
    }
  ],
  "Total": 218
}
```

#### 坐騎資料欄位說明

- `Mounts`: 坐騎列表陣列
  - `Name`: 坐騎識別碼（從 tooltip URL 提取）
  - `Icon`: 坐騎圖標 URL
- `Total`: 擁有的坐騎總數

## 回應標頭

- `X-Cache-Status`: `HIT` (快取命中) 或 `MISS` (快取未命中)
- `Access-Control-Allow-Origin`: 允許來自 ff14.tw 網域

## 環境變數

在 `wrangler.toml` 中可設定：

- `CACHE_TTL`: 快取存活時間（秒），預設 86400（24小時）

## 本地開發

```bash
yarn dev
```

這會啟動本地開發伺服器，可在 `http://localhost:8787` 測試。

## 測試

專案包含完整的測試頁面 `test.html`，可測試所有 API 端點：

```bash
npm run dev
open test.html
```

測試頁面功能：
- 分頁式介面（角色、自由部隊、收藏品）
- 快速測試按鈕
- 結果複製功能
- 快取狀態顯示

## 限制

- 支援北美（NA）和日本（JP）資料中心的查詢
- CORS 限制：只允許來自 ff14.tw 網域的請求
- 部分功能尚未實作（搜尋、CWLS、Linkshell、PvP小隊）
- 坐騎/寵物名稱目前顯示為識別碼（從 tooltip URL 提取）

## 專案架構

```
├── src/
│   ├── index.ts              # 主程式進入點，路由處理
│   ├── parsers/              # HTML 解析器
│   │   ├── character-parser.ts     # 角色資料解析
│   │   ├── classjob-parser.ts      # 職業等級解析
│   │   ├── achievements-parser.ts   # 成就資料解析
│   │   ├── freecompany-parser.ts    # 自由部隊解析
│   │   ├── freecompany-members-parser.ts # 部隊成員解析
│   │   ├── minion-parser.ts        # 寵物收集解析
│   │   └── mount-parser.ts          # 坐騎收集解析
│   └── lib/
│       └── lodestone-css-selectors/ # CSS 選擇器定義
├── wrangler.toml             # Cloudflare Workers 設定
├── test.html                 # API 測試頁面
└── FEATURE_COMPARISON.md     # 功能對比文件
```

## 未來規劃

- [ ] 角色搜尋功能
- [ ] 自由部隊搜尋功能
- [ ] 跨界聯絡貝（CWLS）支援
- [ ] 聯絡貝（Linkshell）支援
- [ ] PvP 小隊詳細資訊
- [ ] 角色屬性數值
- [ ] 角色裝備資訊

## CSS Selectors 來源

本專案使用的 CSS selectors 來自：https://github.com/xivapi/lodestone-css-selectors

## 授權

MIT License
