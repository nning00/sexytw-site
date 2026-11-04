export const profileDetailKeys = [
  "nationality", "age", "height", "weight", "cup", "environment",
  "serviceMethod", "price", "serviceArea", "compatible", "notAccepted", "surcharge", "promotion",
] as const;

export type ProfileDetailKey = typeof profileDetailKeys[number];
export type ProfileDetails = Record<ProfileDetailKey, string>;

export const emptyProfileDetails: ProfileDetails = {
  nationality: "", age: "", height: "", weight: "", cup: "", environment: "",
  serviceMethod: "", price: "", serviceArea: "", compatible: "", notAccepted: "", surcharge: "", promotion: "",
};

const emptyMarkers = new Set([
  "", "?", "？", "-", "–", "—", "－", "不詳", "未知", "未公開", "無資料", "null", "undefined",
]);

export function decodeProfileText(value: unknown) {
  let decoded = String(value ?? "");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded
      .replace(/&#(\d+);?/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);?/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;|&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
    if (next === decoded) break;
    decoded = next;
  }
  return decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanDetail(value: unknown) {
  const decoded = decodeProfileText(value);
  return emptyMarkers.has(decoded.toLowerCase()) ? "" : decoded;
}

function plausibleNumber(value: unknown, min: number, max: number) {
  const cleaned = cleanDetail(value).replace(/,/g, "");
  const match = cleaned.match(/\d{2,3}/);
  if (!match) return "";
  const number = Number(match[0]);
  return number >= min && number <= max ? String(number) : "";
}

export function normalizeProfileDetails(details: Partial<ProfileDetails>): ProfileDetails {
  const normalized = Object.fromEntries(
    profileDetailKeys.map((key) => [key, cleanDetail(details[key])]),
  ) as ProfileDetails;
  normalized.age = plausibleNumber(normalized.age, 18, 99);
  normalized.height = plausibleNumber(normalized.height, 120, 220);
  normalized.weight = plausibleNumber(normalized.weight, 30, 200);
  normalized.cup = normalized.cup.replace(/罩杯/gi, "").trim();
  return normalized;
}

export function profileSeoFacts(details: Partial<ProfileDetails>) {
  const normalized = normalizeProfileDetails(details);
  return [
    normalized.age ? `${normalized.age}歲` : "",
    normalized.height ? `${normalized.height}cm` : "",
    normalized.cup ? `${normalized.cup}罩杯` : "",
  ].filter(Boolean).join("、");
}

export function buildProfileSeoDescription(cityName: string, displayName: string, details: Partial<ProfileDetails>) {
  const normalized = normalizeProfileDetails(details);
  const facts = profileSeoFacts(normalized);
  return `${cleanDetail(cityName)}${normalized.serviceMethod || "成人形象"}資訊｜${cleanDetail(displayName)}${facts ? `，${facts}` : ""}。查看公開照片、基本資料、服務地區與聯絡前注意事項；實際安排請以正式聯絡及安全確認為準。`;
}

export function parseProfileDetails(value: string | null | undefined, legacyStyle = "", legacyInterest = ""): ProfileDetails {
  try {
    const parsed = JSON.parse(value || "") as Partial<ProfileDetails>;
    if (parsed && typeof parsed === "object") {
      return normalizeProfileDetails(parsed);
    }
  } catch { /* Existing plain-text introductions are handled below. */ }
  return normalizeProfileDetails({ ...emptyProfileDetails, cup: legacyStyle || "", serviceArea: legacyInterest || "", compatible: value || "" });
}

export function serializeProfileDetails(details: ProfileDetails) {
  return JSON.stringify(details);
}
