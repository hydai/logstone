# Nodestone Worker

Cloudflare Workers 版本的 Nodestone - FFXIV Lodestone 解析服務。提供完整的角色（含依名字搜尋）、自由部隊、成就、寵物、坐騎等遊戲資料查詢 API。

## 功能特點

- 🚀 使用 Cloudflare Workers 部署，全球低延遲
- 💾 整合 KV 儲存進行智慧快取，減少對 Lodestone 的請求
- ⏱️ 分層快取策略（基本資料 24 小時，成就/收藏品 48 小時；角色搜尋不快取）
- 🔄 自動處理快取過期和更新
- 🕒 每個成功的回應都有 `FetchedAt`，標明資料是什麼時候從官網抓的
- 🚦 失敗時回傳對應的狀態碼和錯誤代碼（400、403、404、502、500）
- 📄 支援分頁查詢（成就、部隊成員、角色搜尋）
- 🎮 完整資料支援：
  - 角色基本資料（含 FreeCompany、ActiveClassJob、PvPTeam 資訊）
  - 職業等級（戰鬥、製作、採集、特殊內容）
  - 成就系統（含總數、點數、分頁）
  - 自由部隊（基本資料、房產、聲望、重點活動）
  - 部隊成員列表
  - 寵物/坐騎收集（含名稱）
  - 角色搜尋（依名字和伺服器，每筆附部隊）

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

部署後，可以透過以下 API 查詢資料。所有 API 端點都支援 `dc` 參數，選擇 Worker 讀哪一種語言的官網：
- `na` (預設): 英文版官網
- `jp`: 日文版官網

兩個官網查得到的角色和自由部隊都一樣，不分資料中心，差別只在語言：職業、成就、坐騎、寵物、自由部隊等頁面上的文字（名稱）是那個官網的語言，所以 `dc=jp` 拿到的是日文。

### 1. 角色基本資料

```
GET https://your-worker.workers.dev/character/{characterId}?dc={dc}
```

範例：
```bash
# 英文版官網 (預設)
curl https://your-worker.workers.dev/character/123456

# 日文版官網
curl https://your-worker.workers.dev/character/123456?dc=jp
```

回應格式：
```json
{
  "Character": {
    "ID": 123456,
    "Name": "Character Name",
    "Server": {
      "World": "Tonberry",
      "DC": "Elemental"
    },
    "Title": "Title Name",
    "Nameday": "1st Sun of the 1st Astral Moon",
    "Town": {
      "Name": "Gridania",
      "Icon": "https://lds-img.finalfantasyxiv.com/h/u/ZHuDKgNULSbEA_VTXdjeA9MlEs.png"
    },
    "GrandCompany": {
      "Name": "Maelstrom",
      "Rank": "Storm Captain"
    },
    "FreeCompany": {
      "ID": "9230000000000000001",
      "Name": "Moonlit Garden",
      "Crest": [
        "https://img2.finalfantasyxiv.com/c/B00_00000000000000000000000000000000_00_40x40.png",
        "https://img2.finalfantasyxiv.com/c/B00_00000000000000000000000000000000_00_40x40.png",
        "https://img2.finalfantasyxiv.com/c/B00_00000000000000000000000000000000_00_40x40.png"
      ]
    },
    "ActiveClassJob": {
      "Key": "Bard",
      "Level": 100,
      "Icon": "https://lds-img.finalfantasyxiv.com/h/F/KWI-9P3RX_Ojjn_mwCS2N0-3TI.png"
    },
    "Bio": "第一行\n第二行",
    "Gear": [
      {
        "Slot": "MainHand",
        "Icon": "https://lds-img.finalfantasyxiv.com/itemicon/10/1000000000000000000000000000000000000000.png?n7.57",
        "Dyes": ["#a1b2c3"]
      },
      {
        "Slot": "Head",
        "Icon": "https://lds-img.finalfantasyxiv.com/itemicon/20/2000000000000000000000000000000000000000.png?n7.57",
        "Dyes": []
      }
    ]
    // ... 其他角色資料
  },
  "FetchedAt": "2026-11-08T02:30:00.000Z"
}
```

#### 角色資料欄位說明

只列出有變動或要注意的欄位：

- `Server`: 角色所在的伺服器，`World` 是伺服器、`DC` 是資料中心
- `Nameday`: 角色的生日（遊戲裡的日期寫法）
- `Town`、`GuardianDeity`: 開始城市和守護神，各有 `Name` 和 `Icon`
- `GrandCompany`: 所屬的大國防聯軍，有 `Name` 和 `Rank`
- 種族和部族（`Race`、`Tribe`）目前讀不到，回應裡沒有這兩個欄位
- `FreeCompany`: 角色加入的自由部隊；沒有加入時是 `null`
  - `ID`: 部隊 ID（字串，19 位數，超過數字能精確表示的範圍）
  - `Name`: 部隊名稱
  - `Crest`: 部隊徽章的圖片網址（陣列）。實際的回應是同一張最底層的圖重複三次（三層的選擇器都讀到第一張圖），所以要畫部隊徽章請用 `/freecompany/{ID}` 的 `CrestLayers`，ff14.tw 也是這樣做
- `ActiveClassJob`: 角色目前使用的職業
  - `Key`: 職業鍵，與職業等級資料（`/classjob`）用的鍵相同，例如 `Bard`、`DarkKnight`；基本職業用基本職業的鍵（例如 `Pugilist`）。對不到時（例如之後新增的職業）是 `null`
  - `Level`: 目前等級（數字），讀不到時是 `null`
  - `Icon`: 官網的職業圖示網址，沒有時是 `null`
- `Bio`: 個人簡介，官網的換行保留成 `\n`
- `Gear`: 每一格裝備的圖示與染色（陣列）。官網的角色頁沒有裝備名稱和物品等級（要滑過去才從另一個網址載入），所以回應裡也沒有。沒有圖示的格子不列，什麼都沒穿是空陣列
  - `Slot`: 格子，陣列照這個順序排（不是官網頁面上的順序）：`MainHand`（主手）、`OffHand`（副手）、`Head`（頭部）、`Body`（身體）、`Hands`（手部）、`Legs`（腿部）、`Feet`（腳部）、`Earrings`（耳飾）、`Necklace`（頸飾）、`Bracelets`（腕飾）、`Ring1`、`Ring2`（戒指）、`SoulCrystal`（靈魂水晶）、`Facewear`（臉部）
  - `Icon`: 物品圖示的網址
  - `Dyes`: 染色的顏色（`#rrggbb`），照第一道、第二道的順序，只放有染的；沒染或不能染的不列，所以是 0 到 2 個
- `ActiveClassjob`、`ActiveClassjobLevel`: 舊的欄位（圖示網址和 `{ "Level": "100" }`），照舊保留

### 2. 職業等級資料

```
GET https://your-worker.workers.dev/character/{characterId}/classjob?dc={dc}
```

範例：
```bash
# 英文版官網 (預設)
curl https://your-worker.workers.dev/character/123456/classjob

# 日文版官網
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
          "Level": "100",
          "UnlockState": "Paladin",
          "CurrentEXP": "--",
          "MaxEXP": "--"
        },
        "Warrior": {
          "Level": "85",
          "UnlockState": "Warrior",
          "CurrentEXP": "1,234,567",
          "MaxEXP": "2,345,678"
        },
        "DarkKnight": {
          "Level": "80",
          "UnlockState": "Dark Knight",
          "CurrentEXP": "0",
          "MaxEXP": "5,992,000"
        },
        "Gunbreaker": {
          "Level": "-",
          "UnlockState": "Gunbreaker",
          "CurrentEXP": "-",
          "MaxEXP": "-"
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
        "Reaper": { /* ... */ },
        "Viper": { /* ... */ },
        "Beastmaster": { /* ... */ }
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
        "Pictomancer": { /* ... */ },
        "BlueMage": { /* ... */ }
      }
    },
    "CraftingJobs": {
      "Carpenter": {
        "Level": "90",
        "UnlockState": "Carpenter",
        "CurrentEXP": "12,345",
        "MaxEXP": "3,456,789"
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
        "Level": "91",
        "UnlockState": "Miner",
        "CurrentEXP": "1,234",
        "MaxEXP": "13,659,000"
      },
      "Botanist": { /* ... */ },
      "Fisher": { /* ... */ }
    },
    "SpecialContent": {
      "Bozja": {
        "Name": "Knowledge Level",
        "Level": "3",
        "Mettle": "1234"
      }
    }
  },
  "FetchedAt": "2026-11-08T02:30:00.000Z"
}
```

#### 職業資料欄位說明

每個職業包含以下欄位：
- `Level`: 職業等級（字串），還沒解鎖的職業是 `-`
- `UnlockState`: 官網在這一列寫的職業名稱，語言跟著 `dc`（例如英文版的 `Warrior`、日文版的 `戦士`）；還沒轉職的職業，這一列寫的是它的基本職業（例如 Paladin 這一列寫 `Gladiator`）
- `CurrentEXP`: 當前經驗值
- `MaxEXP`: 升級所需總經驗值

經驗值是官網寫的字串，不是數字：數字有千分位逗號（例如 `1,234,567`），已經沒有下一級的職業兩個都是 `--`，還沒解鎖的職業兩個都是 `-`。

特殊內容（`SpecialContent`）額外欄位：
- `Name`: 官網在那個區塊寫的名稱，照原文（英文版的 `Knowledge Level`、日文版的 `ナレッジレベル`）
- `Mettle`: Mettle 點數

`SpecialContent` 的鍵沿用上游選擇器的名稱，內容則是官網職業頁上對應位置的區塊：現在 `Bozja` 讀到的是 Occult Crescent 的 Knowledge Level，不是 Bozja 的 Resistance Rank，所以要顯示時請用 `Name`，不要用鍵名。有哪些鍵要看官網職業頁有沒有對應位置的區塊；實際抓過的頁面只讀得到 `Bozja`。

### 3. 成就資料

```
GET https://your-worker.workers.dev/character/{characterId}/achievements?page={page}&dc={dc}
```

範例：
```bash
# 英文版官網 (預設)
curl https://your-worker.workers.dev/character/123456/achievements?page=1

# 日文版官網
curl https://your-worker.workers.dev/character/123456/achievements?page=1&dc=jp
```

`page` 是 1 以上的整數（沒給就是 1），其他值回 400。角色沒有公開成就時，官網拒絕顯示這一頁，Worker 回 403 `private`。

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
  },
  "FetchedAt": "2026-11-08T02:30:00.000Z"
}
```

#### 成就資料欄位說明

- `Achievements`: 成就列表陣列
  - `ID`: 成就 ID
  - `Name`: 成就名稱
  - `Time`: 取得時間（ISO 8601 格式）；官網沒有給日期的成就是空字串
- `TotalAchievements`: 總成就數量
- `AchievementPoints`: 成就點數
- `Pagination`: 分頁資訊
  - `Page`: 當前頁碼
  - `PageTotal`: 總頁數
  - `PageNext`: 下一頁頁碼（如果有）
  - `PagePrev`: 上一頁頁碼（如果有）

### 4. 自由部隊資料

```
GET https://your-worker.workers.dev/freecompany/{freecompanyId}?dc={dc}
```

範例：
```bash
# 英文版官網 (預設)
curl https://your-worker.workers.dev/freecompany/123456789

# 日文版官網
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
      "Rank": "Allied"
    },
    "ActiveState": "Active",
    "Recruitment": "Open",
    "ActiveMemberCount": "512",
    "Rank": "8",
    "Ranking": {
      "Weekly": "45",
      "Monthly": "123"
    },
    "Estate": {
      "Name": "Estate Name",
      "Greeting": "Welcome to our estate!",
      "Plot": "Plot 30, 1st Ward, Mist (Medium)"
    },
    "Reputation": {
      "ADDERS": {
        "NAME": "Order of the Twin Adder",
        "PROGRESS": { "Progress": "20" },
        "RANK": "Neutral"
      },
      "FLAMES": {
        "NAME": "Immortal Flames",
        "PROGRESS": { "Progress": "0" },
        "RANK": "Neutral"
      },
      "MAELSTROM": {
        "NAME": "Maelstrom",
        "PROGRESS": { "Progress": "100" },
        "RANK": "Allied"
      }
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
  },
  "FetchedAt": "2026-11-08T02:30:00.000Z"
}
```

#### 自由部隊資料欄位說明

只列出要注意的欄位：

- `GrandCompany`: 部隊所屬的大國防聯軍；`Rank` 是部隊和它的友好度（例如 `Allied`），不是軍階。語言跟著 `dc`（日文版是 `黒渦団`、`盟友` 這樣的寫法）
- `Ranking`: 上週（`Weekly`）和上個月（`Monthly`）的排名（字串）；日文版寫在名次後面的「位」不算在內，所以英文版和日文版讀到的一樣
- `Reputation`: 部隊和三個大國防聯軍的友好度，鍵是 `ADDERS`（雙蛇黨）、`FLAMES`（不滅隊）、`MAELSTROM`（黑渦團）
  - `NAME`: 大國防聯軍的名稱，語言跟著 `dc`
  - `RANK`: 友好度，例如 `Neutral`、`Allied`
  - `PROGRESS.Progress`: 友好度進度條的百分比（字串）
- 成立日期目前讀不到，回應裡沒有 `Formed`

### 5. 自由部隊成員列表

```
GET https://your-worker.workers.dev/freecompany/{freecompanyId}/members?page={page}&dc={dc}
```

範例：
```bash
# 英文版官網 (預設)
curl https://your-worker.workers.dev/freecompany/123456789/members?page=1

# 日文版官網
curl https://your-worker.workers.dev/freecompany/123456789/members?page=1&dc=jp
```

`page` 是 1 以上的整數（沒給就是 1），其他值回 400。

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
  },
  "FetchedAt": "2026-11-08T02:30:00.000Z"
}
```

### 6. 寵物收集

```
GET https://your-worker.workers.dev/character/{characterId}/minions?dc={dc}
```

範例：
```bash
# 英文版官網 (預設)
curl https://your-worker.workers.dev/character/123456/minions

# 日文版官網
curl https://your-worker.workers.dev/character/123456/minions?dc=jp
```

回應格式：
```json
{
  "CharacterID": 123456,
  "Minions": [
    {
      "Name": "Wayward Hatchling",
      "Icon": "https://lds-img.finalfantasyxiv.com/itemicon/82/828a8ce3af34af8c5bdb41b1f14f9b7e94435193.png?n7.57"
    }
  ],
  "Total": 425,
  "FetchedAt": "2026-11-08T02:30:00.000Z"
}
```

#### 寵物資料欄位說明

- `Minions`: 寵物列表陣列
  - `Name`: 寵物名稱（`dc=na` 是英文、`dc=jp` 是日文）
  - `Icon`: 寵物圖標 URL
- `Total`: 擁有的寵物總數

Worker 讀的是官網的手機版頁面（用 iPhone 的 User-Agent 去要），因為只有手機版會把每一隻的名稱寫出來。

### 7. 坐騎收集

```
GET https://your-worker.workers.dev/character/{characterId}/mounts?dc={dc}
```

範例：
```bash
# 英文版官網 (預設)
curl https://your-worker.workers.dev/character/123456/mounts

# 日文版官網
curl https://your-worker.workers.dev/character/123456/mounts?dc=jp
```

回應格式：
```json
{
  "CharacterID": 123456,
  "Mounts": [
    {
      "Name": "Company Chocobo",
      "Icon": "https://lds-img.finalfantasyxiv.com/itemicon/e6/e6cd1b44f2e625546c0a4c4ee9dff3de07b02082.png?n7.57"
    }
  ],
  "Total": 218,
  "FetchedAt": "2026-11-08T02:30:00.000Z"
}
```

#### 坐騎資料欄位說明

- `Mounts`: 坐騎列表陣列
  - `Name`: 坐騎名稱（`dc=na` 是英文、`dc=jp` 是日文）
  - `Icon`: 坐騎圖標 URL
- `Total`: 擁有的坐騎總數

和寵物一樣，Worker 讀的是官網的手機版頁面。

### 8. 角色搜尋

```
GET https://your-worker.workers.dev/search/character?name={name}&world={world}&page={page}&dc={dc}
```

參數：
- `name`（必填）：角色名字。去掉前後空白後要有 1～40 個字（以字元計，一個表情符號算一個字），否則回 400
- `world`（選填）：沒給或是空的，就搜尋全部伺服器；也可以是資料中心（`_dc_` 加名稱，例如 `_dc_Elemental`）或伺服器名稱（例如 `Tiamat`）。除了開頭的 `_dc_`，只能是英文字母，否則回 400
- `page`（選填）：1～20 的整數，預設 1，否則回 400。官網一頁 50 筆，最多只顯示 1000 筆（20 頁）
- `dc`（選填）：和其他端點一樣，`na`（預設）或 `jp`
- 只收這四個參數，帶了其他參數（例如官網自己的 `worldname`，或拼錯的 `world`）回 400，不會略過它而變成搜尋全部伺服器

範例：
```bash
# 搜尋全部伺服器 (英文版官網，預設)
curl "https://your-worker.workers.dev/search/character?name=Aoi%20Mizuno"

# 只搜尋 Gaia 資料中心的第 2 頁 (日文版官網)
curl "https://your-worker.workers.dev/search/character?name=Aoi%20Mizuno&world=_dc_Gaia&page=2&dc=jp"

# 只搜尋 Tiamat 伺服器
curl "https://your-worker.workers.dev/search/character?name=Aoi%20Mizuno&world=Tiamat"
```

回應格式：
```json
{
  "Results": [
    {
      "ID": 12345678,
      "Name": "Aoi Mizuno",
      "World": "Tiamat",
      "DC": "Gaia",
      "Avatar": "https://img2.finalfantasyxiv.com/f/00000000000000000000000000000001_00000000000000000000000000000001fc0.jpg?1700000001",
      "FreeCompany": {
        "ID": "9230000000000000001",
        "Name": "Moonlit Garden"
      }
    },
    {
      "ID": 23456789,
      "Name": "Kaede Aizawa",
      "World": "Cactuar",
      "DC": "Aether",
      "Avatar": "https://img2.finalfantasyxiv.com/f/00000000000000000000000000000002_00000000000000000000000000000002fc0.jpg?1700000002",
      "FreeCompany": null
    }
  ],
  "Pagination": {
    "Page": 1,
    "PageTotal": 20,
    "Total": 1000
  },
  "FetchedAt": "2026-11-08T02:30:00.000Z"
}
```

#### 搜尋資料欄位說明

- `Results`: 符合的角色陣列，順序照官網
  - `ID`: 角色 ID，可以拿去查 `/character/{ID}`
  - `Name`: 角色名字
  - `World`、`DC`: 角色所在的伺服器和資料中心
  - `Avatar`: 頭像圖片網址
  - `FreeCompany`: 角色加入的自由部隊（`ID` 是字串）；沒有加入時是 `null`
- `Pagination`: 分頁資訊
  - `Page`: 當前頁碼
  - `PageTotal`: 總頁數（最多 20）
  - `Total`: 符合的角色總數（官網最多數到 1000）

沒有符合的角色不是錯誤：回 200，`Results` 是空陣列，`Pagination` 一律是 `{ "Page": 1, "PageTotal": 0, "Total": 0 }`。官網沒有符合時會在頁面上寫出「沒有符合」，總數也寫 0，Worker 看到其中一個就回空陣列；讀不到任何一列、頁面沒有這一句、總數又不是 0 或找不到總數（官網改了版面）時是 502 `upstream`。

搜尋結果不快取：每次都直接問官網，不寫 KV，回應也沒有 `X-Cache-Status` 標頭；`FetchedAt` 就是這次抓的時間。

## 資料時間（FetchedAt）

每個成功的回應最外層都有 `FetchedAt`（ISO 8601 格式的字串，例如 `"2026-11-08T02:30:00.000Z"`），是 Worker 從官網抓到這份資料的時間。快取命中時是當初抓的時間，不是這次請求的時間，可以拿它判斷資料有多舊。

## 錯誤格式

失敗時回傳對應的 HTTP 狀態碼，內容是 JSON `{ "error": "<代碼>" }`：

| 狀態碼 | `error` | 意思 |
|---|---|---|
| 400 | `bad_request` | 參數不對：`dc` 不是 `na` 或 `jp`、`page` 不是 1 以上的整數；角色搜尋另外還有名字、伺服器、頁數（1～20）不合規則，或帶了這四個以外的參數 |
| 403 | `private` | 官網拒絕顯示這一頁，因為玩家沒有公開（例如成就） |
| 404 | `not_found` | 官網沒有這個角色或自由部隊 |
| 500 | `internal` | Worker 自己的程式錯誤 |
| 502 | `upstream` | 連不上官網、官網回了其他錯誤（例如維修中），或頁面裡找不到應有的內容（官網改了版面） |

- 失敗的結果不會寫進 KV
- 錯誤回應也帶 `Access-Control-Allow-Origin`，網站讀得到
- 「找不到應有的內容」不會當成空的資料回傳，也不會寫進 KV，因為那會讓人以為真的沒有資料（官網改了版面時就會這樣）。下面這些都是 502：
  - 角色頁讀不到角色名字
  - 職業頁一個職業都讀不到
  - 成就頁讀不到角色名字或成就的區塊（例如官網回了角色頁），或寫了總數卻讀不到任何一筆成就（成就的區塊裡總數是 0 或沒寫總數時，是真的沒有成就，照常回傳）
  - 自由部隊頁讀不到部隊名稱
  - 部隊成員頁一個成員都讀不到（部隊至少有會長）
  - 寵物或坐騎的頁面寫了總數卻讀不到任何一列，或讀不到任何一列而且不是官網的手機版頁面（空白頁、別人的頁面，或官網不理會手機版 User-Agent 而回的電腦版頁面；就算一隻都沒有，手機版頁面也有它的版面）
  - 搜尋頁讀不到任何一列、頁面沒有寫「沒有符合」、總數也不是 0
- 角色搜尋不會有 404 和 403：官網的搜尋頁沒有符合時也是 200，所以搜尋遇到官網回 404 或 403，一律是 502
- 例外：請求來源不是 ff14.tw 時回純文字 `Forbidden`（403），路徑不存在時回純文字 `Not Found`（404），這兩種不是 JSON

## 回應標頭

- `X-Cache-Status`: `HIT` (快取命中) 或 `MISS` (快取未命中)；角色搜尋沒有快取，也就沒有這個標頭
- `Access-Control-Allow-Origin`: 允許來自 ff14.tw 網域

## 快取

資料存在 KV（綁定名稱 `LOGSTONE`），鍵的格式是：

```
v2:<端點>:<dc>:<ID>
v2:<端點>:<dc>:<ID>:page<頁碼>    # 有分頁的端點（成就、部隊成員）
```

例如 `v2:character:na:123456`、`v2:achievements:jp:123456:page2`、`v2:members:na:123456789:page1`。端點名稱是 `character`、`classjob`、`achievements`、`minions`、`mounts`、`freecompany`、`members`。

- `character`、`classjob`、`freecompany`、`members` 保留 `CACHE_TTL`（預設 24 小時）；`achievements`、`minions`、`mounts` 變動比較慢，保留兩倍（48 小時）
- 每個項目寫入時都設了和它的保留時間一樣長的過期時間（KV 最短接受 60 秒），過期後 KV 會自己刪掉
- 開頭的 `v2` 是快取版本。解析器回傳的內容改變時就加一號，舊版本的項目不會再被讀到，過期後也就從 KV 消失；v2 以前的 Worker 寫的項目沒有設過期時間，會一直留在 KV 裡
- 寫入 KV 失敗（例如免費方案一天 1,000 次的寫入用完）時照樣回 200，只是這次的結果沒有存起來，下一次請求會再問官網
- 角色搜尋不經過 KV

## 環境變數

在 `wrangler.toml` 中可設定：

- `CACHE_TTL`: 快取存活時間（秒），預設 86400（24小時）

## 本地開發

```bash
yarn dev
```

這會啟動本地開發伺服器，可在 `http://localhost:8787` 測試。

## 測試

單元測試用 vitest，不連網路：官網的頁面換成照真實結構手寫的假頁面（放在 `test/fixtures/`，名字都是假的）。vitest 5.1.0 需要 Node ^22.12、^24 或 26 以上，測試是在 Node 24 上跑的：

```bash
npm test
npx tsc --noEmit   # 型別檢查
```

另外有測試頁面 `test.html`，可對跑起來的 Worker 測試各個 API 端點（角色搜尋不在裡面，請直接用 `curl`）：

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

- `dc` 只能選英文版（`na`）或日文版（`jp`）官網；兩個官網查得到的角色一樣，不分資料中心
- CORS 限制：只允許來自 ff14.tw 網域的請求
- 部分功能尚未實作（自由部隊搜尋、CWLS、Linkshell、PvP小隊）
- 角色搜尋最多只能看到官網顯示的 1000 筆（20 頁）

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
│   │   ├── mount-parser.ts          # 坐騎收集解析
│   │   └── search-parser.ts         # 角色搜尋結果解析
│   └── lib/
│       ├── http.ts           # 錯誤類別與狀態碼、快取鍵、FetchedAt、dc 與 page 參數
│       ├── job-icons.ts      # 職業圖示檔名對應職業鍵（ActiveClassJob.Key）
│       └── lodestone-css-selectors/ # CSS 選擇器定義
├── test/                     # vitest 測試與手寫的假頁面（fixtures）
├── wrangler.toml             # Cloudflare Workers 設定
├── test.html                 # API 測試頁面
└── FEATURE_COMPARISON.md     # 功能對比文件
```

## 未來規劃

- [x] 角色搜尋功能
- [ ] 自由部隊搜尋功能
- [ ] 跨界聯絡貝（CWLS）支援
- [ ] 聯絡貝（Linkshell）支援
- [ ] PvP 小隊詳細資訊
- [ ] 裝備名稱與物品等級

## CSS Selectors 來源

本專案使用的 CSS selectors 來自：https://github.com/xivapi/lodestone-css-selectors

以上游的檔案為底，只改必要的地方：
- `profile/classjob.json` 和 `search/character.json` 取自上游的 commit `245db29`；`search/character.json` 另外加上 `ENTRY.FREE_COMPANY`（部隊的 ID 和名稱）與 `TOTAL`（符合的總數）
- `profile/mount.json`、`profile/minion.json` 改成讀官網的手機版頁面
- `freecompany/freecompany.json` 的 `GRAND_COMPANY` 和 `RANKING` 也讀得懂日文版的頁面，大國防聯軍的名稱也不會帶著後面的空白
- `profile/gearset.json` 拿掉了：它讀的是以前直接寫在頁面上的裝備提示框，官網現在改成滑過去才另外載入，一個欄位都對不到。裝備的圖示與染色改由 `character-parser.ts` 直接讀每一格

## 授權

MIT License
