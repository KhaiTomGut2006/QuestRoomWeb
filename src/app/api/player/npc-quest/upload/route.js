import { Readable } from "node:stream";
import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { handleUpload } from "@vercel/blob/client";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";

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

function getGridFsBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "npcQuestEvidence"
  });
}

async function saveGridFsUpload(request, discordId) {
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

  await connectDb();
  const filename = safeSegment(file.name);
  const bucket = getGridFsBucket();
  const fileId = new mongoose.Types.ObjectId();
  const uploadStream = bucket.openUploadStreamWithId(fileId, filename, {
    contentType: file.type,
    metadata: {
      discordId,
      originalName: file.name,
      size: file.size
    }
  });
  await new Promise(async (resolve, reject) => {
    uploadStream.on("finish", resolve);
    uploadStream.on("error", reject);
    Readable.from(Buffer.from(await file.arrayBuffer())).pipe(uploadStream);
  });

  const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const basePath = rawBasePath ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}` : "";
  const publicOrigin = process.env.NEXTAUTH_URL
    ? new URL(process.env.NEXTAUTH_URL).origin
    : request.nextUrl.origin;
  const url = `${publicOrigin}${basePath}/api/player/npc-quest/upload?file=${fileId}`;

  return NextResponse.json({
    blob: {
      url,
      pathname: `gridfs/${safeSegment(discordId, "player")}/${fileId}`,
      contentType: file.type,
      size: file.size,
      originalName: file.name
    }
  });
}

export async function GET(request) {
  if (request.nextUrl.searchParams.get("config") === "1") {
    return NextResponse.json({
      storage: process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "gridfs",
      maximumSizeInBytes: MAX_UPLOAD_BYTES
    });
  }

  const rawId = request.nextUrl.searchParams.get("file");
  if (!rawId || !mongoose.Types.ObjectId.isValid(rawId)) {
    return NextResponse.json({ error: "file_not_found" }, { status: 404 });
  }

  await connectDb();
  const bucket = getGridFsBucket();
  const fileId = new mongoose.Types.ObjectId(rawId);
  const file = await bucket.find({ _id: fileId }).next();
  if (!file) return NextResponse.json({ error: "file_not_found" }, { status: 404 });

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": file.contentType || "application/octet-stream",
    "Content-Disposition": `inline; filename="${safeSegment(file.filename)}"`
  });
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416 });
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), file.length - 1) : file.length - 1;
    if (start > end || start >= file.length) return new Response(null, { status: 416 });
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Content-Range", `bytes ${start}-${end}/${file.length}`);
    return new Response(Readable.toWeb(bucket.openDownloadStream(fileId, { start, end: end + 1 })), {
      status: 206,
      headers
    });
  }

  headers.set("Content-Length", String(file.length));
  return new Response(Readable.toWeb(bucket.openDownloadStream(fileId)), { headers });
}

export async function POST(request) {
  const discordId = await getDiscordId();
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (request.nextUrl.searchParams.get("storage") === "gridfs") {
    return saveGridFsUpload(request, discordId);
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
