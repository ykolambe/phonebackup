import fs from "node:fs";
import path from "node:path";
import { Router, Request, Response } from "express";
import archiver from "archiver";
import { getDb, ObjectId } from "../db/mongo";
import { requireAuth } from "./auth";

export const router = Router();

router.get("/batches", requireAuth, async (req: Request, res: Response) => {
  const userId = String((req.session as any).userId);
  const db = getDb();
  const batchesCol = db.collection<{
    _id: ObjectId;
    userId: ObjectId;
    title?: string | null;
    createdAt: Date;
  }>("upload_batches");

  const docs = await batchesCol
    .find({ userId: new ObjectId(userId) })
    .sort({ createdAt: -1 })
    .toArray();

  const batches = docs.map((b) => ({
    id: b._id.toString(),
    title: b.title ?? null,
    created_at: b.createdAt,
  }));

  res.render("batches", { batches });
});

router.get(
  "/batches/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = String((req.session as any).userId);
    const batchIdStr = String(req.params.id);
    const db = getDb();

    const batchesCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      title?: string | null;
      createdAt: Date;
    }>("upload_batches");
    const filesCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      batchId: ObjectId;
      originalName: string;
      sizeBytes: number;
      createdAt: Date;
    }>("files");

    let batchObjectId: ObjectId;
    try {
      batchObjectId = new ObjectId(batchIdStr);
    } catch {
      return res.status(404).send("Batch not found");
    }

    const batchDoc = await batchesCol.findOne({
      _id: batchObjectId,
      userId: new ObjectId(userId),
    });

    if (!batchDoc) {
      return res.status(404).send("Batch not found");
    }

    const fileDocs = await filesCol
      .find({ batchId: batchObjectId, userId: new ObjectId(userId) })
      .sort({ createdAt: 1 })
      .toArray();

    const batch = {
      id: batchDoc._id.toString(),
      title: batchDoc.title ?? null,
      created_at: batchDoc.createdAt,
    };
    const files = fileDocs.map((f) => ({
      id: f._id.toString(),
      original_name: f.originalName,
      size_bytes: f.sizeBytes,
      created_at: f.createdAt,
    }));

    return res.render("batch_files", {
      batch,
      files,
    });
  },
);

router.get(
  "/files/:id/download",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = String((req.session as any).userId);
    const fileIdStr = String(req.params.id);
    const db = getDb();
    const filesCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      originalName: string;
      storagePath: string;
    }>("files");

    let fileObjectId: ObjectId;
    try {
      fileObjectId = new ObjectId(fileIdStr);
    } catch {
      return res.status(404).send("File not found");
    }

    const fileDoc = await filesCol.findOne({
      _id: fileObjectId,
      userId: new ObjectId(userId),
    });

    if (!fileDoc) {
      return res.status(404).send("File not found");
    }

    const filePath = path.resolve(fileDoc.storagePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File missing on server");
    }

    return res.download(filePath, fileDoc.originalName);
  },
);

router.get(
  "/batches/:id/download-zip",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = String((req.session as any).userId);
    const batchIdStr = String(req.params.id);
    const db = getDb();

    const batchesCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      title?: string | null;
      createdAt: Date;
    }>("upload_batches");
    const filesCol = db.collection<{
      _id: ObjectId;
      userId: ObjectId;
      batchId: ObjectId;
      originalName: string;
      storagePath: string;
    }>("files");

    let batchObjectId: ObjectId;
    try {
      batchObjectId = new ObjectId(batchIdStr);
    } catch {
      return res.status(404).send("Batch not found");
    }

    const batchDoc = await batchesCol.findOne({
      _id: batchObjectId,
      userId: new ObjectId(userId),
    });

    if (!batchDoc) {
      return res.status(404).send("Batch not found");
    }

    const fileDocs = await filesCol
      .find({ batchId: batchObjectId, userId: new ObjectId(userId) })
      .toArray();

    if (fileDocs.length === 0) {
      return res.status(404).send("No files in this batch");
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="batch-${batchIdStr}.zip"`,
    );
    res.setHeader("Content-Type", "application/zip");

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err: Error) => {
      // eslint-disable-next-line no-console
      console.error("Archive error", err);
      res.status(500).end();
    });

    archive.pipe(res);

    for (const file of fileDocs) {
      const filePath = path.resolve(file.storagePath);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: file.originalName });
      }
    }

    archive.finalize();
  },
);


