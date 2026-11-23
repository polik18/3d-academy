# 小黃老師 3D 自學館

https://polik18.github.io/3d-academy/

把小黃老師 YouTube 頻道（@polikjames）的 Blender 建模與 3D 列印教學影片，整理成 M0–M9 由淺入深的自學課程。純靜態網站，無框架、無後端。

## 功能
- 課程地圖（主線 M0→M1→M2→M3→M5→M7→M9，選修 M4／M6／M8）、單元頁、影片課頁
- YouTube 點擊才載入（youtube-nocookie），章節時間軸可點擊跳轉、記住看到哪裡
- 學習紀錄只存在使用者瀏覽器（localStorage `pk3d.v1`）：狀態、筆記、練習檢核、過關自評、作品紀錄、每日觀看時間
- 匯出／匯入 JSON 備份（合併時保留較新內容）、列印學習歷程

## 更新內容
課程資料來源是私有的課程計畫 JSON（不放在 repo）。更新後執行：

```bash
python3 -I tools/build_course.py --src <課程資料夾>
```

腳本只輸出白名單欄位，只收公開影片（`visibility=public`，或 `tools/oembed-check.json` 驗證過的影片），並檢查輸出不含 YouTube Studio 私有資訊；檢查失敗會中止。
