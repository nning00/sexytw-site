// Section starts use the article's own words so moving or inserting a paragraph
// doesn't silently attach a heading to unrelated text.
const outlines = {
  "hotel-relaxation-before-after-guide": [
    ["", "預留時間與安排飲食"], ["入住後先整理空間", "整理空間與事前確認"],
    ["真正放鬆時", "放慢呼吸與結束後的恢復"], ["睡眠也是", "睡眠、回顧與重點整理"],
  ],
  "hotel-outcall-privacy-safety-checklist": [
    ["", "核對資訊來源與訪客規則"], ["個資提供", "個資與付款注意事項"],
    ["見面前可做", "見面前核對與雙方界線"], ["行程結束後", "保留紀錄與辨識仿冒"],
    ["可以在手機備忘錄", "安全檢查表"],
  ],
  "taipei-delivery-booking-process-guide": [
    ["", "整理行程與確認場地"], ["第三步是", "正式聯絡與費用核對"],
    ["約定當天", "當日確認與隱私"], ["如果發生延誤", "交通、延誤與改期"],
    ["完成一次預約後", "流程回顧"],
  ],
  "fixed-location-vs-delivery-service-guide": [
    ["", "兩種方式的場地差異"], ["時間彈性", "比較時間、費用與隱私"],
    ["第一次選擇時", "做選擇前先確認的問題"], ["若仍難以決定", "比較清單與出發前核對"],
  ],
  "healthy-relaxation-rhythm-guide": [
    ["", "從忙碌切換到放鬆"], ["四、先辨認", "辨認疲勞與調整力道"],
    ["八、結束時", "結束後的恢復節奏"], ["十、建立", "紀錄、頻率與日常習慣"],
  ],
  "online-contact-privacy-payment-safety": [
    ["", "確認聯絡入口與保留紀錄"], ["三、個資", "個資、付款與可疑連結"],
    ["六、照片", "確認身分與安全界線"], ["九、遇到", "疑似詐騙與資料外洩的處理"],
  ],
  "advance-vs-same-day-booking-strategy": [
    ["", "提前與當天詢問的差別"], ["四、第一則", "整理訊息與確認約定"],
    ["七、改期", "改期、取消與重複詢問"], ["十、預約完成", "再次確認與後續聯絡"],
  ],
  "first-time-service-selection-checklist": [
    ["", "列出必要條件並檢查資訊"], ["四、先決定", "時間、預算與聯絡方式"],
    ["七、把界線", "雙方界線與安全判斷"], ["九、出發前", "出發前核對與事後回顧"],
  ],
  "after-work-relaxation-wellness-guide": [
    ["", "從行程與飲食開始準備"], ["三、選擇", "環境、呼吸與身體感受"],
    ["五、清楚", "界線與注意力"], ["八、結束後", "結束後的整理與日常恢復"],
  ],
  "booking-privacy-payment-safety-checklist": [
    ["", "辨識付款與連結警訊"], ["四、只提供", "保護個資並核對資訊"],
    ["七、見面", "場所與同意原則"], ["九、保存", "保留紀錄及處理問題"],
  ],
  "booking-time-location-communication-guide": [
    ["", "時間區間與提早詢問"], ["三、地點", "地點、場所規範與需求"],
    ["六、一次", "確認費用並準備備案"], ["八、臨時", "臨時變更與到場前核對"],
  ],
  "first-relaxation-planning-guide": [
    ["", "先釐清需求與時間"], ["三、地點", "地點、聯絡與資料一致性"],
    ["六、先說明", "界線、付款與個資"], ["八、到場前", "到場前的最後確認"],
  ],
};

/** @param {string} paragraph */
function authoredHeading(paragraph) {
  const lineEnd = paragraph.indexOf("\n");
  const firstLine = (lineEnd < 0 ? paragraph : paragraph.slice(0, lineEnd)).trim();
  if (firstLine.length > 45 || !/^[一二三四五六七八九十]+、\s*\S/.test(firstLine) || /[。；]/.test(firstLine)) {
    return { heading: "", text: paragraph };
  }
  return { heading: firstLine, text: lineEnd < 0 ? "" : paragraph.slice(lineEnd + 1) };
}

/** @param {string} slug @param {string[]} paragraphs */
export function groupArticleParagraphs(slug, paragraphs) {
  const blocks = paragraphs.map((paragraph, index) => ({ id: "article-section-" + (index + 1), ...authoredHeading(paragraph) }));
  const curated = Object.hasOwn(outlines, slug) ? outlines[/** @type {keyof typeof outlines} */ (slug)] : null;
  if (curated && blocks.length) {
    const starts = curated.map(([prefix]) => prefix ? paragraphs.findIndex(p => p.trimStart().startsWith(prefix)) : 0);
    if (starts.every((start, index) => start >= 0 && (!index || start > starts[index - 1]))) {
      return curated.map(([, title], index) => ({
        title,
        blocks: blocks.slice(starts[index], starts[index + 1]),
      }));
    }
  }
  // If editors change the source or publish a new article, use the actual
  // authored headings, and omit the TOC when there aren't meaningful headings.
  /** @type {Array<{title:string,blocks:typeof blocks}>} */
  const groups = [];
  for (const block of blocks) {
    if (block.heading || !groups.length) groups.push({ title: block.heading, blocks: [] });
    groups.at(-1)?.blocks.push({ ...block, heading: "" });
  }
  return groups;
}
