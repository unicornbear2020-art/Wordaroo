# Wordaroo Offline Dictionary

可直接開啟 `index.html` 的多檔離線英語字典。資料按首兩個字元分片，
避免一次載入整個詞庫，並避開 `file://` 對 `fetch()` 的限制。

## 功能

- 英式、美式、澳洲地域標籤及獨立 IPA 欄位
- 多詞性、多義項、例句及詞形變化
- 英語裝置聲音選擇、英／美／澳口音、速度及音高設定
- 自動讀兩次、喇叭讀一次、切換詞時取消舊發音
- 所有偏好儲存在 `localStorage`
- 無 API、無雲端服務、無執行時網絡依賴
- ECDICT 未在 Wiktionary 基礎包出現的詞彙亦會直接加入
- `custom-entries.json` 內的 Wordaroo 編輯詞條會在建庫時自動合併
- `data/custom/people-names.json` 提供人名、別名、音標及粵語讀音提示
- `data/custom/disney-characters.json` 提供簡短原創的 Disney 角色索引
- `data/custom/pixar-characters.json` 收錄《反斗奇兵》及《反斗車王》系列角色
- 相機／相片英文 OCR 掃描，結果以互動段落顯示並在完成後自動朗讀
- 短按段落內文字可由該字開始朗讀；長按一秒可查看該詞解釋
- OCR 使用本機 Tesseract.js 及英文模型，圖片不會上載到伺服器

## 重新建立資料庫

需要 Node.js 18 或以上。匯入器接受 Wiktextract JSONL 或 `.jsonl.gz`：

```sh
node tools/build-dictionary.mjs \
  /path/to/dictionary.jsonl.gz \
  /path/to/Wordaroo-offline.html \
  /path/to/ecdict.csv \
  /path/to/cmn.txt \
  /path/to/dinosaurs-pbdb.json \
  /path/to/mosses-gbif.json \
  /path/to/pokemon-pokeapi.json
```

後三個參數可省略；分別用於合併舊 Wordaroo 詞條、ECDICT 英中詞義及
Tatoeba/ManyThings 中英雙語例句。建庫時會使用隨附 OpenCC 工具轉成繁體。

更新恐龍及苔蘚植物分類來源：

```sh
node tools/download-taxonomy.mjs sources
node tools/download-pokemon.mjs sources/pokemon-pokeapi.json
node tools/build-people-names.mjs
node tools/build-disney-characters.mjs
node tools/build-pixar-characters.mjs
```

正式全量英文資料可由 Kaikki.org 的 English Wiktionary raw data 頁下載。
截至 2026-06，壓縮檔約 2.6GB，解壓後約 22GB，生成後資料夾亦會相當大。
目前隨附版本使用 Simple English Wiktionary 基礎包，再合併原有 Wordaroo 詞條。

## 開啟方式

桌面瀏覽器可直接雙擊 `index.html`。若瀏覽器限制本機分片腳本，可在此資料夾執行：

```sh
python3 -m http.server 8080
```

再開啟 `http://localhost:8080`。iPhone 建議把完整資料夾放入本機檔案 App，
或經同一 Wi-Fi 的本機伺服器開啟。OCR 的 Web Worker / WebAssembly 在部分瀏覽器
會被 `file://` 安全政策封鎖，建議透過 GitHub Pages 或上述本機 HTTP 伺服器使用掃描。
