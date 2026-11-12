import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertSyncEndpoint, verifySyncTarget } from "../lib/profile-sync-target.mjs";
import { collectCatalog } from "../lib/edc-catalog.mjs";
import { finishSnapshot } from "../lib/profile-sync-snapshot.mjs";
import { recoveryMode, syncBatchPayload, shouldFinalize } from "../lib/profile-sync-recovery.mjs";
const upsertOnly = recoveryMode(process.argv);

const projectRoot = resolve(import.meta.dirname, "..");
const localEnvPaths = [join(projectRoot, ".env.sync.local"), join(projectRoot, ".env.local")];
const sourceApi = "https://edc.com.tw/wp-json/wc/store/v1/products";
const providerUserAgent = "AuthorizedProfileSync/1.0";
const knownCities = new Set([
  "�x�_", "�s�_", "��", "���", "�s��", "�]��", "�x��", "����", "�n��", "���L",
  "�Ÿq", "�x�n", "����", "�̪F", "�y��", "�Ὤ", "�x�F", "���", "����",
]);

function loadLocalEnv() {
  for (const localEnvPath of localEnvPaths) {
    if (!existsSync(localEnvPath)) continue;
    for (const line of readFileSync(localEnvPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function decodeHtml(value = "") {
  let decoded = String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded
      .replace(/&#(\d+);?/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;|&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
    if (next === decoded) break;
    decoded = next;
  }
  return decoded.replace(/\s+/g, " ").trim();
}

function cleanSourceFact(value, min, max) {
  const decoded = decodeHtml(value);
  if (!decoded || /^(?:[?�H\-�V�X��]|����|����|�����}|�L���|null|undefined)$/i.test(decoded)) return "";
  if (min === undefined || max === undefined) return decoded;
  const match = decoded.match(/\d{2,3}/);
  const number = match ? Number(match[0]) : 0;
  return number >= min && number <= max ? String(number) : "";
}

function field(text, label, nextLabels) {
  const start = text.search(new RegExp(`${label}\\s*[�G:]\\s*`, "i"));
  if (start < 0) return "";
  const remainder = text.slice(start).replace(new RegExp(`^${label}\\s*[�G:]\\s*`, "i"), "");
  const stopPattern = nextLabels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stop = stopPattern ? remainder.search(new RegExp(`\\s(?:${stopPattern})\\s*[�G:]`, "i")) : -1;
  return (stop >= 0 ? remainder.slice(0, stop) : remainder).trim();
}

function attribute(product, name) {
  const match = product.attributes?.find((item) => item.name === name);
  return match?.terms?.map((term) => term.name).filter(Boolean).join("�B") || "";
}

function cityName(product) {
  const fromAttribute = attribute(product, "����").split(/[�B,]/)[0]?.trim();
  if (knownCities.has(fromAttribute)) return fromAttribute;
  return product.categories?.map((category) => category.name).find((name) => knownCities.has(name)) || "";
}

function priceText(prices) {
  if (!prices) return "";
  const prefix = prices.currency_prefix || prices.currency_symbol || "NT$";
  const min = prices.price_range?.min_amount || prices.price;
  const max = prices.price_range?.max_amount || prices.price;
  if (!min) return "";
  return min === max ? `${prefix}${Number(min).toLocaleString("zh-TW")}` : `${prefix}${Number(min).toLocaleString("zh-TW")}�V${Number(max).toLocaleString("zh-TW")}`;
}

function normalizeProduct(product) {
  const city = cityName(product);
  const text = decodeHtml(product.description || "");
  const age = cleanSourceFact(field(text, "�~��", ["����", "�魫", "�n�M", "����"]), 18, 99);
  const serviceMethod = attribute(product, "�A�Ȥ覡") || field(text, "����", ["�a��", "�Ҧ�", "�i�t�X"]);
  const displayName = decodeHtml(product.name || "").replace(/^.*?[-�V�X]\s*/, "").trim();
  if (!product.id || !product.permalink || !displayName || !city) return null;
  return {
    sourceKey: String(product.id),
    sourceUrl: product.permalink,
    displayName,
    cityName: city,
    nationality: attribute(product, "���y") || field(text, "��a", ["�~��"]),
    age,
    height: cleanSourceFact(attribute(product, "����") || field(text, "����", ["�魫", "�n�M"]), 120, 220),
    weight: cleanSourceFact(field(text, "�魫", ["�n�M", "����"]), 30, 200),
    cup: cleanSourceFact(attribute(product, "�n�M") || field(text, "�n�M", ["����", "�a��"])).replace(/�n�M/gi, "").trim(),
    environment: field(text, "�Ҧ�", ["�i�t�X", "������"]),
    serviceMethod,
    price: priceText(product.prices),
    serviceArea: attribute(product, "�A�Ȧa��") || field(text, "�a��", ["�Ҧ�", "�i�t�X"]),
    compatible: attribute(product, "�A�Ȥ��e") || field(text, "�i�t�X", ["������", "�[����", "�u�f���"]),
    notAccepted: field(text, "������", ["�[����", "�u�f���"]),
    surcharge: field(text, "�[����", ["�u�f���"]),
    promotion: field(text, "�u�f���", []),
    images: (product.images || []).slice(0, 3).map((image) => ({
      url: image.thumbnail || image.src,
      alt: decodeHtml(image.alt || image.name || `${city}${serviceMethod} ${displayName}`),
    })),
  };
}

function isVerifiedAdult(profile) {
  const match = String(profile.age || "").match(/\d{2}/);
  return Boolean(match && Number(match[0]) >= 18);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": providerUserAgent } });
  if (!response.ok) throw new Error(`�ӷ� API ${response.status}: ${url}`);
  return { data: await response.json(), headers: response.headers };
}

async function collectProfiles(selectedCity, limit) {
  return collectCatalog({ selectedCity, limit, normalizeProduct,
    fetchPage: async (page) => {
      const url = new URL(sourceApi);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      // Stable identity ordering avoids duplicates when products are edited.
      url.searchParams.set("orderby", "id");
      url.searchParams.set("order", "asc");
      return fetchJson(url);
    },
    onPage: (page, totalPages, count) => console.log(`�ӷ��� ${page}/${totalPages}�A�w��z ${count} ��`),
  });
}

async function postPayload(payload) {
  const endpoint = process.env.PROFILE_SYNC_ENDPOINT;
  const secret = process.env.PROFILE_SYNC_SECRET;
  if (!endpoint || !secret) return null;
  assertSyncEndpoint(endpoint);
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(120000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok && response.status !== 207) throw new Error(JSON.stringify(result));
  return result;
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    try { return JSON.stringify(error); } catch { return "object-error"; }
  }
  return String(error || "unknown-error");
}

loadLocalEnv();
const commit = process.argv.includes("--commit");
const verifyOnly = process.argv.includes("--verify-only");
if (commit || verifyOnly || process.env.PROFILE_SYNC_ENDPOINT || process.env.PROFILE_SYNC_SECRET) {
  await verifySyncTarget(process.env.PROFILE_SYNC_ENDPOINT, process.env.PROFILE_SYNC_SECRET);
  console.log("Sync target verified: sexytw.cc / lsxrpubpbnshlqnnddgu / public / sexytw (read-only preflight).");
}
if (verifyOnly) {
  console.log("Verification completed; no source crawl, profile write or snapshot cleanup was performed.");
  process.exit(0);
}
const selectedCity = argValue("--city") || "";
const limit = Math.max(Number(argValue("--limit") || "0"), 0);
if (selectedCity && !knownCities.has(selectedCity)) throw new Error(`���䴩�������G${selectedCity}`);

const capturedAt = new Date().toISOString();
const catalogue = await collectProfiles(selectedCity, limit);
const { profiles } = catalogue;
const syncableProfiles = profiles.filter(isVerifiedAdult);
const pendingReviewProfiles = profiles.filter((profile) => !isVerifiedAdult(profile));
const outputPath = join(projectRoot, "outputs", `edc-sync-${capturedAt.replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify({ capturedAt, candidateCount: profiles.length, verifiedAdultCount: syncableProfiles.length, pendingAdultReviewCount: pendingReviewProfiles.length, snapshotProof: catalogue.snapshotProof, profiles }, null, 2));
console.log(`�w����ơG${outputPath}`);
console.log(`�Կ� ${profiles.length} ���F�i�T�{���~ ${syncableProfiles.length} ���F�ݫ�x�T�{���~ ${pendingReviewProfiles.length} ���F${[...new Set(profiles.map((profile) => profile.cityName))].length} �ӫ���`);

if (process.env.PROFILE_SYNC_ENDPOINT && process.env.PROFILE_SYNC_SECRET) {
  const chunks = [];
  // Keep each request small because a batch also downloads several remote images.
  // This avoids cPanel/Cloudflare request timeouts during a full catalogue sync.
  const batchSize = 3;
  for (let index = 0; index < profiles.length; index += batchSize) {
    chunks.push(profiles.slice(index, index + batchSize));
  }
  const totals = { create: 0, update: 0, unchanged: 0, pendingReview: 0, skippedCity: 0, warnings: 0, errors: 0 };
  async function syncChunk(chunk, index) {
    let response;
    let succeeded = false;
    let terminalHttpError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        response = await postPayload(syncBatchPayload({commit,capturedAt,profiles:chunk,upsertOnly}));
        if (!response || !response.summary || !response.result && commit) throw new Error("Invalid sync batch response.");
        const attemptErrors = response?.result?.errors || [];
        const blockingErrors = attemptErrors.filter((item) => item?.message !== "image-download-404");
        if (!blockingErrors.length) { succeeded = true; break; }
        console.error(`�妸 ${index + 1}/${chunks.length} �� ${attempt} �����ե��ѡG${JSON.stringify(blockingErrors)}`);
      } catch (error) {
        terminalHttpError = errorMessage(error);
        console.error(`�妸 ${index + 1}/${chunks.length} �� ${attempt} �� HTTP ���ե��ѡG${terminalHttpError}`);
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
    if (!response || !succeeded) {
      console.error(`�妸 ${index + 1}/${chunks.length} �w���L���~������ơG${terminalHttpError}`);
      return { create: 0, update: 0, unchanged: 0, pendingReview: 0, skippedCity: 0, warnings: 0, errors: chunk.length };
    }
    const responseErrors = response?.result?.errors || [];
    const warningErrors = responseErrors.filter((item) => item?.message === "image-download-404");
    const blockingErrors = responseErrors.filter((item) => item?.message !== "image-download-404");
    console.log(`�妸 ${index + 1}/${chunks.length}�G${JSON.stringify(response?.summary || response)}`);
    if (warningErrors.length) {
      console.warn(`�妸ĵ�i�]�ӷ��Ϥ����s�b�A�w���L�^�G${JSON.stringify(warningErrors)}`);
    }
    if (blockingErrors.length) {
      console.error(`�妸���~�G${JSON.stringify(blockingErrors)}`);
    }
    return {
      create: response?.summary?.create || 0,
      update: response?.summary?.update || 0,
      unchanged: response?.summary?.unchanged || 0,
      pendingReview: response?.summary?.pendingReview || 0,
      skippedCity: response?.summary?.skippedCity || 0,
      warnings: warningErrors.length,
      errors: blockingErrors.length,
    };
  }
  // Three small requests in parallel keep each Worker invocation lightweight
  // while finishing the full catalogue comfortably within the Actions limit.
  const concurrency = upsertOnly ? 1 : 3;
  for (let index = 0; index < chunks.length; index += concurrency) {
    const wave = chunks.slice(index, index + concurrency);
    const results = await Promise.all(wave.map((chunk, offset) => syncChunk(chunk, index + offset)));
    for (const result of results) {
      for (const key of Object.keys(totals)) totals[key] += result[key] || 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (shouldFinalize({commit,selectedCity,limit,errors:totals.errors,warnings:totals.warnings,upsertOnly})) {
    const cleanupTotals = await finishSnapshot(postPayload,
      { mode: "commit", capturedAt, profiles: [], finalizeSnapshot: true, snapshotSourceKeys: catalogue.sourceKeys, snapshotProof: catalogue.snapshotProof },
      { pause: () => new Promise((resolve) => setTimeout(resolve, 350)),
        onPage: (pass, page) => console.log(`Cleanup pass ${pass}: ${JSON.stringify(page)}`) });
    console.log(`Cleanup totals: ${JSON.stringify(cleanupTotals)}`);
  }
  if (upsertOnly) console.log("RECOVERY CREATE-ONLY: no absence deletion, no finalizer/media queue; three-day lifecycle NOT enabled.");
  console.log(JSON.stringify(totals, null, 2));
  if (totals.errors) throw new Error(`�P�B�������� ${totals.errors} �����~�F�w�O�d�J����ƨò��L�R���A�U���Ƶ{�|���աC`);
  if (totals.warnings) throw new Error("Source image warnings were present; permanent cleanup was skipped for safety.");
} else {
  console.log("�|���]�w PROFILE_SYNC_ENDPOINT / PROFILE_SYNC_SECRET�A�]���u�إߥ����w���A���|�ק勵�������C ");
}
