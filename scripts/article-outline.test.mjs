import test from "node:test";
import assert from "node:assert/strict";
import { groupArticleParagraphs } from "../lib/article-outline.mjs";

test("curated sections follow the actual text and preserve all paragraph anchors", () => {
  const paragraphs = ["開場", "補充段落", "入住後先整理空間。", "真正放鬆時，可以先休息。", "睡眠也是恢復的一部分。"];
  const chapters = groupArticleParagraphs("hotel-relaxation-before-after-guide", paragraphs);
  assert.equal(chapters.length, 4);
  const blocks = chapters.flatMap(x => x.blocks);
  assert.deepEqual(blocks.map(x => x.text), paragraphs);
  assert.deepEqual(blocks.map(x => x.id), paragraphs.map((_, i) => "article-section-" + (i + 1)));
});

test("unmatched or reordered markers use authored headings and never discard the article", () => {
  const chapters = groupArticleParagraphs("hotel-relaxation-before-after-guide", [
    "開場", "一、準備工作\r\n正文第一段。", "正文第二段。", "二、注意事項\r", "正文第三段。",
  ]);
  assert.deepEqual(chapters.map(x => x.title), ["", "一、準備工作", "二、注意事項"]);
  assert.deepEqual(chapters.flatMap(x => x.blocks).map(x => x.text), ["開場", "正文第一段。", "正文第二段。", "", "正文第三段。"]);
});

test("plain paragraphs are not mislabeled as headings; empty bodies are supported", () => {
  assert.deepEqual(groupArticleParagraphs("new", []), []);
  const chapters = groupArticleParagraphs("new", ["一般正文。", "一、這是一個含有句號的普通段落。"]);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "");
  assert.equal(chapters[0].blocks.length, 2);
});
