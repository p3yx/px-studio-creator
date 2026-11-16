import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({ error: "Provider management is disabled." }, { status: 410 }); }
