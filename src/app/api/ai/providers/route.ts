import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ error: "Provider management is disabled. 9Router is configured via server .env." }, { status: 410 }); }
export async function POST() { return NextResponse.json({ error: "Provider management is disabled. 9Router is configured via server .env." }, { status: 410 }); }
