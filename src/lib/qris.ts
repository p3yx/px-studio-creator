export function qrisCrc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function qrisBasePayloadIsValid(payload: string): boolean {
  if (!payload || payload.length > 2048 || !/6304[0-9A-Fa-f]{4}$/.test(payload)) return false;
  const body = payload.slice(0, -8);
  if (qrisCrc16(body + "6304") !== payload.slice(-4).toUpperCase()) return false;

  const fields: Record<string, string> = {};
  for (let offset = 0; offset < body.length; ) {
    if (offset + 4 > body.length) return false;
    const tag = body.slice(offset, offset + 2);
    const lenStr = body.slice(offset + 2, offset + 4);
    if (!/^\d+$/.test(lenStr)) return false;
    const fieldLength = parseInt(lenStr, 10);
    offset += 4;
    if (offset + fieldLength > body.length || fields[tag] !== undefined) return false;
    fields[tag] = body.slice(offset, offset + fieldLength);
    offset += fieldLength;
  }

  return fields["00"] === "01" && ["11", "12"].includes(fields["01"] || "") && fields["53"] === "360";
}

export function qrisPayloadMatchesAmount(payload: string, amount: number): boolean {
  if (!/6304[0-9A-Fa-f]{4}$/.test(payload)) return false;
  const body = payload.slice(0, -8);
  if (qrisCrc16(body + "6304") !== payload.slice(-4).toUpperCase()) return false;

  const fields: Record<string, string> = {};
  for (let offset = 0; offset < body.length; ) {
    if (offset + 4 > body.length) return false;
    const tag = body.slice(offset, offset + 2);
    const lenStr = body.slice(offset + 2, offset + 4);
    if (!/^\d+$/.test(lenStr)) return false;
    const fieldLength = parseInt(lenStr, 10);
    offset += 4;
    if (offset + fieldLength > body.length) return false;
    if (fields[tag] !== undefined) return false;
    fields[tag] = body.slice(offset, offset + fieldLength);
    offset += fieldLength;
  }

  return fields["01"] === "12" && fields["53"] === "360" && fields["54"] === String(amount);
}

export function getQrisConfig() {
  const basePayload = (process.env.QRIS_BASE_PAYLOAD || process.env.PXAFF_QRIS_PAYLOAD || "00020101021126610014COM.GO-JEK.WWW01189360091438052776940210G8052776940303UMI51440014ID.CO.QRIS.WWW0215ID10243369315880303UMI5204899953033605802ID5919PEYX STORE, Digital6008SUKABUMI61054314562070703A0163047719").trim();
  const apiUrl = (process.env.QRIS_API_URL || process.env.PXAFF_QRIS_API_URL || "https://api-mininxd.vercel.app/qris").trim();
  return { basePayload, apiUrl };
}

export async function generateDynamicQrisPayload(amount: number, basePayload?: string, apiUrl?: string): Promise<string> {
  const cfg = getQrisConfig();
  const base = (basePayload || cfg.basePayload || "").trim();
  const url = (apiUrl || cfg.apiUrl || "").trim();
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Nominal tidak valid");
  if (!base) throw new Error("QRIS base payload belum dikonfigurasi");
  if (!url) throw new Error("QRIS provider API belum dikonfigurasi");

  const qs = new URLSearchParams({ qris: base, nominal: String(Math.round(amount)) }).toString();
  const endpoint = url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "PX-Studio-Creator/1.0" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`QRIS provider tidak tersedia (HTTP ${res.status})`);
  }
  const data: any = await res.json().catch(() => null);
  if (!data || typeof data !== "object") throw new Error("Respons QRIS provider tidak valid");
  const payload = data.QR ?? data.qr ?? data.qris ?? "";
  if (typeof payload !== "string" || !qrisPayloadMatchesAmount(payload, Math.round(amount))) {
    throw new Error("QRIS provider mengembalikan payload tidak valid");
  }
  if (data.harga != null && Number(data.harga) !== Math.round(amount)) {
    throw new Error("Nominal QRIS tidak sesuai");
  }
  return payload;
}
