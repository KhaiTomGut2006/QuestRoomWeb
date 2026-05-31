import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { handleUpload } from "@vercel/blob/client";
import { authOptions } from "@/lib/auth";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v"
];

function safeSegment(value, fallback = "file") {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || fallback;
}

function getUploadPrefix(discordId) {
  return `npc-quests/${safeSegment(discordId, "player")}/`;
}

async function getDiscordId() {
  const session = await getServerSession(authOptions);
  return session?.user?.discordId ? String(session.user.discordId) : "";
}

async function saveLocalUpload(request, discordId) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "local_upload_disabled" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "unsupported_file_type" }, { status: 400 });
  }
  if (!file.size || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }

  const filename = `${randomUUID()}-${safeSegment(file.name)}`;
  const prefix = getUploadPrefix(discordId);
  const pathname = `${prefix}${filename}`;
  const uploadDirectory = path.join(process.cwd(), "public", "uploads", prefix);
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(path.join(uploadDirectory, filename), Buffer.from(await file.arrayBuffer()));

  const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const basePath = rawBasePath ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}` : "";
  const url = `${request.nextUrl.origin}${basePath}/uploads/${pathname}`;

  return NextResponse.json({
    blob: {
      url,
      pathname,
      contentType: file.type,
      size: file.size,
      originalName: file.name
    }
  });
}

export async function POST(request) {
  const discordId = await getDiscordId();
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (request.nextUrl.searchParams.get("local") === "1") {
    return saveLocalUpload(request, discordId);
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "blob_not_configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const prefix = getUploadPrefix(discordId);
        if (!pathname.startsWith(prefix)) throw new Error("invalid_upload_path");
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true
        };
      }
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: error.message || "upload_failed" }, { status: 400 });
  }
}
