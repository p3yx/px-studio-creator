import { NextRequest, NextResponse } from "next/server";
import { generateDynamicQrisPayload, getQrisConfig } from "@/lib/qris";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount < 1000) {
      return NextResponse.json({ ok: false, error: "Nominal minimal Rp 1.000" }, { status: 400 });
    }
    if (amount > 10000000) {
      return NextResponse.json({ ok: false, error: "Nominal terlalu besar" }, { status: 400 });
    }
    const payload = await generateDynamicQrisPayload(amount);
    const cfg = getQrisConfig();
    return NextResponse.json({ ok: true, amount, payload, providerConfigured: !!cfg.apiUrl && !!cfg.basePayload });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Gagal membuat QRIS dinamis" }, { status: 500 });
  }
}
