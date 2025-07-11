# 功能對比：Nodestone vs Nodestone-Worker

## 已實作功能 ✅

### 角色相關
- [x] 角色基本資料 (`/character/{id}`)
  - 包含 FreeCompany 和 PvPTeam 資訊
- [x] 職業等級資料 (`/character/{id}/classjob`)
- [x] 成就資料 (`/character/{id}/achievements`)
  - 支援分頁功能
- [x] 寵物收集 (`/character/{id}/minions`)
- [x] 坐騎收集 (`/character/{id}/mounts`)

### 自由部隊相關
- [x] 部隊基本資料 (`/freecompany/{id}`)
  - 包含房產、聲望、重點活動、招募資訊
- [x] 成員列表 (`/freecompany/{id}/members`)
  - 支援分頁功能

## 未實作功能 ❌

### 搜尋功能
- [ ] 角色搜尋 (`/character/search`)
- [ ] 自由部隊搜尋 (`/freecompany/search`)

### 社群功能
- [ ] 跨界聯絡貝 (CWLS)
  - [ ] CWLS 基本資料
  - [ ] CWLS 成員列表
- [ ] 聯絡貝 (Linkshell)
  - [ ] Linkshell 基本資料
  - [ ] Linkshell 成員列表
- [ ] PvP 小隊
  - [ ] PvP 小隊基本資料
  - [ ] PvP 小隊成員列表

### 其他
- [ ] 伺服器元資料 (Meta)

## 可從 Nodestone 取得的完整資料

### 角色資料 (Character)
```json
{
  "ActiveClassJob": {},
  "Avatar": "https://...",
  "Bio": "角色簡介",
  "DC": "資料中心",
  "FreeCompanyId": "123456",
  "FreeCompanyName": "部隊名稱",
  "GrandCompany": {},
  "GuardianDeity": {},
  "ID": "角色ID",
  "Lang": "語言",
  "Name": "角色名稱",
  "Nameday": "生日",
  "ParseDate": "解析時間",
  "Portrait": "https://...",
  "PvPTeamId": "PvP小隊ID",
  "Race": {},
  "Server": "伺服器",
  "Title": {},
  "Town": {},
  "Tribe": {}
}
```

### 屬性資料 (Attributes)
- 力量 (STR)
- 敏捷 (DEX)
- 耐力 (VIT)
- 智力 (INT)
- 精神 (MND)
- 其他各種屬性值

### 裝備資料 (Gearset)
- 主手武器
- 副手
- 頭部、身體、手部、腿部、腳部
- 耳環、項鍊、手鐲、戒指

### 職業資料 (ClassJobs)
- 所有戰鬥職業等級
- 所有製作職業等級
- 所有採集職業等級
- 特殊內容等級（元素等級、抵抗等級）

### 成就資料 (Achievements)
- 成就ID、名稱、取得時間
- 總成就數
- 成就點數
- 分頁資訊

### 自由部隊資料 (Free Company)
- 基本資訊（名稱、標籤、口號）
- 部隊徽章
- 成立時間
- 活躍狀態、招募狀態
- 成員數量
- 排名資訊
- 房產資訊
- 聲望等級
- 重點活動
- 招募職業

### 寵物/坐騎資料
- 擁有的寵物/坐騎列表
- 總數量

## 測試頁面覆蓋狀況

### 已覆蓋 ✅
- 角色基本資料
- 職業等級
- 成就（含分頁）
- 自由部隊資料
- 部隊成員（含分頁）
- 寵物收集
- 坐騎收集

### 未覆蓋 ❌
- 搜尋功能（未實作）
- CWLS 相關（未實作）
- Linkshell 相關（未實作）
- PvP 小隊相關（未實作）

## 建議優先實作順序

1. **搜尋功能**（高優先級）
   - 讓使用者能搜尋角色和自由部隊
   - 提升系統可用性

2. **CWLS 支援**（中優先級）
   - 跨伺服器社群功能
   - 增強社交功能

3. **Linkshell 支援**（中優先級）
   - 伺服器內社群功能

4. **PvP 小隊支援**（低優先級）
   - 除非 PvP 內容很重要

5. **元資料解析**（低優先級）
   - 伺服器狀態等資訊