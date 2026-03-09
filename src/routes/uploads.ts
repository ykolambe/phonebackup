import path from "node:path";
import fs from "node:fs";
import { Router, Request, Response } from "express";
import multer from "multer";
import { getDb, ObjectId } from "../db/mongo";
import { requireAuth } from "./auth";
import QRCode from "qrcode";

export const router = Router();

const STORAGE_ROOT =
  process.env.STORAGE_ROOT || path.join(process.cwd(), "uploads");

fs.mkdirSync(STORAGE_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, STORAGE_ROOT);
  },
  filename(_req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\\-_]/g, "_");
    const timestamp = Date.now();
    cb(null, `${timestamp}_${safeName}`);
  },
});

const upload = multer({ storage });

async function getOrCreateUploadLink(userId: string): Promise<string> {
  const db = getDb();
  const uploadLinks = db.collection<{
    _id?: ObjectId;
    userId: ObjectId;
    slug: string;
    createdAt: Date;
  }>("upload_links");

  const existing = await uploadLinks.findOne({ userId: new ObjectId(userId) });
  if (existing) {
    return existing.slug;
  }

  const slug = Math.random().toString(36).slice(2, 10);
  await uploadLinks.insertOne({
    userId: new ObjectId(userId),
    slug,
    createdAt: new Date(),
  });
  return slug;
}

async function getMaxBytesForUser(userId: ObjectId): Promise<number> {
  const db = getDb();
  const usersCol = db.collection<{
    _id: ObjectId;
    planName?: string;
  }>("users");
  const plansCol = db.collection<{
    _id?: ObjectId;
    name: string;
    maxBytes: number;
  }>("plans");

  const defaultMaxBytesEnv = Number(process.env.DEFAULT_MAX_BYTES || "");
  const defaultMaxBytes =
    Number.isFinite(defaultMaxBytesEnv) && defaultMaxBytesEnv > 0
      ? defaultMaxBytesEnv
      : 2 * 1024 * 1024 * 1024; // 2GB
  const defaultPlanName = process.env.DEFAULT_PLAN_NAME || "free";

  const user = await usersCol.findOne({ _id: userId });
  const planName = user?.planName || defaultPlanName;

  const plan = await plansCol.findOne({ name: planName });
  const maxBytes = plan?.maxBytes;

  if (typeof maxBytes === "number" && Number.isFinite(maxBytes) && maxBytes > 0) {
    return maxBytes;
  }

  return defaultMaxBytes;
}

router.get("/settings", requireAuth, async (req: Request, res: Response) => {
  const userId = (req.session as any).userId as string;
  const slug = await getOrCreateUploadLink(userId);

  const db = getDb();
  const filesCol = db.collection<{
    _id: ObjectId;
    userId: ObjectId;
    sizeBytes: number;
  }>("files");

  const agg = await filesCol
    .aggregate<{ _id: null; totalBytes: number; fileCount: number }>([
      { $match: { userId: new ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalBytes: { $sum: "$sizeBytes" },
          fileCount: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const usage = agg[0] || { totalBytes: 0, fileCount: 0 };
  const totalBytes = usage.totalBytes || 0;
  const fileCount = usage.fileCount || 0;
  const maxBytes = await getMaxBytesForUser(new ObjectId(userId));

  const portalBaseUrl =
    process.env.BASE_URL || `${req.protocol}://${req.headers.host}`;
  const uploadUrl = `${portalBaseUrl}/u/${slug}`;

  let uploadQrDataUrl: string | null = null;
  try {
    uploadQrDataUrl = await QRCode.toDataURL(uploadUrl);
  } catch {
    uploadQrDataUrl = null;
  }

  res.render("settings", {
    uploadUrl,
    portalBaseUrl,
    totalBytes,
    fileCount,
    maxBytes,
    uploadQrDataUrl,
  });
});

router.get("/u/:slug", async (req: Request, res: Response) => {
  const { slug } = req.params;
  const db = getDb();
  const uploadLinks = db.collection<{
    _id: ObjectId;
    userId: ObjectId;
    slug: string;
  }>("upload_links");
  const users = db.collection<{ _id: ObjectId; email: string }>("users");
  const foldersCol = db.collection<{
    _id: ObjectId;
    userId: ObjectId;
    name: string;
    createdAt: Date;
  }>("folders");

  const link = await uploadLinks.findOne({ slug });
  if (!link) {
    return res.status(404).send("Invalid upload link");
  }

  const sessionUserId = (req.session as any).userId as string | undefined;
  const linkUserId = link.userId.toHexString();

  if (!sessionUserId || sessionUserId !== linkUserId) {
    const next = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?next=${next}`);
  }

  const owner = await users.findOne({ _id: link.userId });
  if (!owner) {
    return res.status(404).send("Invalid upload link");
  }

  const folders = await foldersCol
    .find({ userId: link.userId })
    .sort({ createdAt: 1 })
    .toArray();

  const ownerEmail = owner.email;
  return res.render("upload", { ownerEmail, slug, folders });
});

router.post(
  "/u/:slug/upload",
  upload.array("files", 50),
  async (req: Request, res: Response) => {
    const { slug } = req.params;
    const files = (req.files || []) as Express.Multer.File[];

    const db = getDb();
    const uploadLinks = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      slug: string;
    }>("upload_links");
    const foldersCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      name: string;
      createdAt: Date;
    }>("folders");
    const filesCol = db.collection<{
      _id?: ObjectId;
      userId: ObjectId;
      batchId: ObjectId;
      folderId: ObjectId;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      storagePath: string;
      createdAt: Date;
    }>("files");

    const link = await uploadLinks.findOne({ slug });
    if (!link) {
      return res.status(404).send("Invalid upload link");
    }

    const sessionUserId = (req.session as any).userId as string | undefined;
    const linkUserId = link.userId.toHexString();
    if (!sessionUserId || sessionUserId !== linkUserId) {
      const next = encodeURIComponent(req.originalUrl);
      return res.redirect(`/login?next=${next}`);
    }

    const userId = link.userId;

    const { folderId } = req.body as { folderId?: string };
    if (!folderId) {
      return res.status(400).send("A folder must be selected.");
    }

    let folderObjectId: ObjectId;
    try {
      folderObjectId = new ObjectId(folderId);
    } catch {
      return res.status(400).send("Invalid folder.");
    }

    const folder = await foldersCol.findOne({
      _id: folderObjectId,
      userId,
    });
    if (!folder) {
      return res.status(400).send("Folder not found for this account.");
    }

    if (files.length === 0) {
      return res
        .status(400)
        .send("No files uploaded. Please choose at least one file.");
    }

    const existingUsage = await filesCol
      .aggregate<{ _id: null; totalBytes: number }>([
        { $match: { userId } },
        { $group: { _id: null, totalBytes: { $sum: "$sizeBytes" } } },
      ])
      .toArray();
    const alreadyUsedBytes = existingUsage[0]?.totalBytes || 0;
    const newBytes = files.reduce((sum, f) => sum + f.size, 0);
    const maxBytes = await getMaxBytesForUser(userId);

    if (alreadyUsedBytes + newBytes > maxBytes) {
      for (const file of files) {
        try {
          if (file.path && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch {
          // ignore
        }
      }

      return res
        .status(400)
        .send(
          "Storage limit reached (2GB). Please delete existing files from the server before uploading more.",
        );
    }

    try {
      const batches = db.collection<{
        _id?: ObjectId;
        userId: ObjectId;
        folderId: ObjectId;
        title: string | null;
        createdAt: Date;
      }>("upload_batches");

      const now = new Date();
      const batchInsert = await batches.insertOne({
        userId,
        folderId: folderObjectId,
        title: null,
        createdAt: now,
      });
      const batchId = batchInsert.insertedId;

      if (files.length > 0) {
        await filesCol.insertMany(
          files.map((file) => ({
            userId,
            batchId,
            folderId: folderObjectId,
            originalName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            storagePath: file.path,
            createdAt: now,
          })),
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      return res.status(500).send("Error saving uploaded files");
    }

    return res.render("upload_success");
  },
);

