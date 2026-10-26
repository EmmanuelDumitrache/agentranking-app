import { NextResponse } from "next/server";
import { readPublicLaunchesSnapshot } from "@/lib/public-launch/my-launches.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await readPublicLaunchesSnapshot();
  if (!snapshot.ok) {
    return NextResponse.json(snapshot, { status: 401 });
  }
  return NextResponse.json(snapshot);
}
