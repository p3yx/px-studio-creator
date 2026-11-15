import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ routes: {}, tasks: [], disabled: true }); }
export async function POST() { return NextResponse.json({ error: "Task-based routing is disabled." }, { status: 410 }); }
