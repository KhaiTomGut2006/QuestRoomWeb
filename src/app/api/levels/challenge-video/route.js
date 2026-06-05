import { Readable } from "node:stream";
import crypto from "node:crypto";
import path from "node:path";
import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { connectDb } from "@/lib/db";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const GRIDFS_MAX_UPLOAD_BYTES = Math.min(
  MAX_UPLOAD_BYTES,
  Math.max(1, Number(process.env.GRIDFS_MAX_UPLOAD_MB || 8)) * 1024 * 1024
);
const GRIDFS_UPLOADS_ENABLED = process.env.ALLOW_GRIDFS_UPLOADS === "true"
  || process.env.NODE_ENV !== "production";
const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
  "video/ogg"
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Game-Api-Token",
};

let r2Client = null;

function getAuthStatus(request) {
  const expectedToken = process.env.GAME_API_TOKEN || process.env.ADMIN_API_TOKEN || "";
  if (!expectedToken) {
    return {
      ok: process.env.NODE_ENV !== "production",
      error: "server_game_api_token_not_configured"
    };
  }
  const bearer = request.headers.get("authorization") || "";
  const headerToken = request.headers.get("x-game-api-token") || "";
  const hasSubmittedToken = Boolean(bearer || headerToken);
  return {
    ok: bearer === `Bearer ${expectedToken}` || headerToken === expectedToken,
    error: hasSubmittedToken ? "invalid_game_api_token" : "missing_game_api_token"
  };
}

function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID
    && process.env.R2_ACCESS_KEY_ID
    && process.env.R2_SECRET_ACCESS_KEY
    && process.env.R2_BUCKET
    && process.env.R2_PUBLIC_BASE_URL
  );
}

function getR2Client() {
  if (r2Client) return r2Client;
  r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return r2Client;
}

function safeSegment(value, fallback = "file") {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || fallback;
}

function buildR2Key(stageId, fileName) {
  const ext = path.extname(fileName || "").toLowerCase();
  const base = safeSegment(path.basename(fileName || "challenge-video", ext), "challenge-video");
  const safeStage = safeSegment(stageId, "stage");
  const stamp = new Date().toISOString().slice(0, 10);
  const nonce = crypto.randomBytes(6).toString("hex");
  return `npc-quests/challenge-videos/${safeStage}/${stamp}/${base}-${nonce}${ext}`;
}

function r2PublicUrl(key) {
  const base = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return `${base}/${encodeURI(key).replace(/%2F/g, "/")}`;
}

function getGridFsBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "challengeVideos"
  });
}

async function saveToGridFs(request, file, stageId) {
  if (!GRIDFS_UPLOADS_ENABLED) {
    return NextResponse.json({ success: false, error: "direct_upload_required" }, { status: 503, headers: CORS });
  }
  if (file.size > GRIDFS_MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { success: false, error: "file_too_large", maximumSizeInBytes: GRIDFS_MAX_UPLOAD_BYTES },
      { status: 413, headers: CORS }
    );
  }

  await connectDb();
  const fileId = new mongoose.Types.ObjectId();
  const filename = safeSegment(file.name, "challenge-video");
  const uploadStream = getGridFsBucket().openUploadStreamWithId(fileId, filename, {
    contentType: file.type,
    metadata: {
      stageId,
      originalName: file.name,
      size: file.size,
      kind: "challenge-video"
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

  return NextResponse.json({
    success: true,
    url: `${publicOrigin}${basePath}/api/levels/challenge-video?file=${fileId}`,
    pathname: `gridfs/challenge-videos/${fileId}`,
    contentType: file.type,
    storage: "gridfs"
  }, { headers: CORS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request) {
  const rawId = request.nextUrl.searchParams.get("file");
  if (!rawId || !mongoose.Types.ObjectId.isValid(rawId)) {
    return NextResponse.json({ success: false, error: "file_not_found" }, { status: 404, headers: CORS });
  }

  await connectDb();
  const fileId = new mongoose.Types.ObjectId(rawId);
  const bucket = getGridFsBucket();
  const file = await bucket.find({ _id: fileId }).next();
  if (!file) return NextResponse.json({ success: false, error: "file_not_found" }, { status: 404, headers: CORS });

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": file.contentType || "application/octet-stream",
    "Content-Disposition": `inline; filename="${safeSegment(file.filename)}"`
  });
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416, headers });
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), file.length - 1) : file.length - 1;
    if (start > end || start >= file.length) return new Response(null, { status: 416, headers });
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
  const authStatus = getAuthStatus(request);
  if (!authStatus.ok) {
    return NextResponse.json(
      { success: false, error: authStatus.error },
      { status: 401, headers: CORS }
    );
  }

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: "file_too_large", maximumSizeInBytes: MAX_UPLOAD_BYTES },
        { status: 413, headers: CORS }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const stageId = safeSegment(formData.get("stageId"), "stage");

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "file_required" }, { status: 400, headers: CORS });
    }
    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
      return NextResponse.json({ success: false, error: "unsupported_file_type" }, { status: 400, headers: CORS });
    }
    if (!file.size || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { success: false, error: "file_too_large", maximumSizeInBytes: MAX_UPLOAD_BYTES },
        { status: 413, headers: CORS }
      );
    }

    if (!isR2Configured()) return saveToGridFs(request, file, stageId);

    const key = buildR2Key(stageId, file.name);
    const bytes = Buffer.from(await file.arrayBuffer());
    await getR2Client().send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: file.type,
    }));

    return NextResponse.json({
      success: true,
      url: r2PublicUrl(key),
      pathname: `r2/${key}`,
      contentType: file.type,
      storage: "r2",
      key
    }, { headers: CORS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "upload_failed" },
      { status: 500, headers: CORS }
    );
  }
}
