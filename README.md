# Nodestone Worker

Cloudflare Workers 版本的 Nodestone - FFXIV Lodestone 解析服務。

## 功能特點

- 使用 Cloudflare Workers 部署，全球低延遲
- 整合 KV 儲存進行快取，減少對 Lodestone 的請求
- 快取時間可設定（預設 24 小時）
- 自動處理快取過期和更新
- 支援角色基本資料和職業等級查詢

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

部署後，可以透過以下 API 查詢資料：

### 1. 角色基本資料

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
GET https://your-worker.workers.dev/character/{characterId}/classjob
```

範例：
```bash
curl https://your-worker.workers.dev/character/123456/classjob
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
GET https://your-worker.workers.dev/character/{characterId}/achievements?page={page}
```

範例：
```bash
curl https://your-worker.workers.dev/character/123456/achievements?page=1
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
GET https://your-worker.workers.dev/freecompany/{freecompanyId}
```

範例：
```bash
curl https://your-worker.workers.dev/freecompany/123456789
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
GET https://your-worker.workers.dev/freecompany/{freecompanyId}/members?page={page}
```

範例：
```bash
curl https://your-worker.workers.dev/freecompany/123456789/members?page=1
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

- HTML 解析使用簡化版本，部分複雜欄位可能無法正確解析
- 僅支援北美資料中心的角色查詢
- CORS 限制：只允許來自 `https://ff14.tw` 和 `https://www.ff14.tw` 的請求

## CSS Selectors 來源

本專案使用的 CSS selectors 來自：https://github.com/xivapi/lodestone-css-selectors