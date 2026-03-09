"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const archiver_1 = __importDefault(require("archiver"));
const mongo_1 = require("../db/mongo");
const auth_1 = require("./auth");
exports.router = (0, express_1.Router)();
exports.router.get("/batches", auth_1.requireAuth, async (req, res) => {
    const userId = String(req.session.userId);
    const db = (0, mongo_1.getDb)();
    const batchesCol = db.collection("upload_batches");
    const docs = await batchesCol
        .find({ userId: new mongo_1.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .toArray();
    const batches = docs.map((b) => ({
        id: b._id.toString(),
        title: b.title ?? null,
        created_at: b.createdAt,
    }));
    res.render("batches", { batches });
});
exports.router.get("/batches/:id", auth_1.requireAuth, async (req, res) => {
    const userId = String(req.session.userId);
    const batchIdStr = String(req.params.id);
    const db = (0, mongo_1.getDb)();
    const batchesCol = db.collection("upload_batches");
    const filesCol = db.collection("files");
    let batchObjectId;
    try {
        batchObjectId = new mongo_1.ObjectId(batchIdStr);
    }
    catch {
        return res.status(404).send("Batch not found");
    }
    const batchDoc = await batchesCol.findOne({
        _id: batchObjectId,
        userId: new mongo_1.ObjectId(userId),
    });
    if (!batchDoc) {
        return res.status(404).send("Batch not found");
    }
    const fileDocs = await filesCol
        .find({ batchId: batchObjectId, userId: new mongo_1.ObjectId(userId) })
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
});
exports.router.get("/files/:id/download", auth_1.requireAuth, async (req, res) => {
    const userId = String(req.session.userId);
    const fileIdStr = String(req.params.id);
    const db = (0, mongo_1.getDb)();
    const filesCol = db.collection("files");
    let fileObjectId;
    try {
        fileObjectId = new mongo_1.ObjectId(fileIdStr);
    }
    catch {
        return res.status(404).send("File not found");
    }
    const fileDoc = await filesCol.findOne({
        _id: fileObjectId,
        userId: new mongo_1.ObjectId(userId),
    });
    if (!fileDoc) {
        return res.status(404).send("File not found");
    }
    const filePath = node_path_1.default.resolve(fileDoc.storagePath);
    if (!node_fs_1.default.existsSync(filePath)) {
        return res.status(404).send("File missing on server");
    }
    return res.download(filePath, fileDoc.originalName);
});
exports.router.get("/batches/:id/download-zip", auth_1.requireAuth, async (req, res) => {
    const userId = String(req.session.userId);
    const batchIdStr = String(req.params.id);
    const db = (0, mongo_1.getDb)();
    const batchesCol = db.collection("upload_batches");
    const filesCol = db.collection("files");
    let batchObjectId;
    try {
        batchObjectId = new mongo_1.ObjectId(batchIdStr);
    }
    catch {
        return res.status(404).send("Batch not found");
    }
    const batchDoc = await batchesCol.findOne({
        _id: batchObjectId,
        userId: new mongo_1.ObjectId(userId),
    });
    if (!batchDoc) {
        return res.status(404).send("Batch not found");
    }
    const fileDocs = await filesCol
        .find({ batchId: batchObjectId, userId: new mongo_1.ObjectId(userId) })
        .toArray();
    if (fileDocs.length === 0) {
        return res.status(404).send("No files in this batch");
    }
    res.setHeader("Content-Disposition", `attachment; filename="batch-${batchIdStr}.zip"`);
    res.setHeader("Content-Type", "application/zip");
    const archive = (0, archiver_1.default)("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
        // eslint-disable-next-line no-console
        console.error("Archive error", err);
        res.status(500).end();
    });
    archive.pipe(res);
    for (const file of fileDocs) {
        const filePath = node_path_1.default.resolve(file.storagePath);
        if (node_fs_1.default.existsSync(filePath)) {
            archive.file(filePath, { name: file.originalName });
        }
    }
    archive.finalize();
});
