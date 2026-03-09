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
exports.router.get("/folders", auth_1.requireAuth, async (req, res) => {
    const userIdStr = req.session.userId;
    const userId = new mongo_1.ObjectId(userIdStr);
    const db = (0, mongo_1.getDb)();
    const foldersCol = db.collection("folders");
    const filesCol = db.collection("files");
    const folders = await foldersCol
        .find({ userId })
        .sort({ createdAt: 1 })
        .toArray();
    const foldersWithCounts = await Promise.all(folders.map(async (folder) => {
        const count = await filesCol.countDocuments({
            userId,
            folderId: folder._id,
        });
        const agg = await filesCol
            .aggregate([
            { $match: { userId, folderId: folder._id } },
            { $group: { _id: null, totalBytes: { $sum: "$sizeBytes" } } },
        ])
            .toArray();
        const totalBytes = agg[0]?.totalBytes || 0;
        return {
            id: folder._id.toHexString(),
            name: folder.name,
            created_at: folder.createdAt,
            file_count: count,
            total_bytes: totalBytes,
        };
    }));
    return res.render("folders", { folders: foldersWithCounts });
});
exports.router.post("/folders/:id/clear", auth_1.requireAuth, async (req, res) => {
    const userIdStr = req.session.userId;
    const userId = new mongo_1.ObjectId(userIdStr);
    const folderIdStr = String(req.params.id);
    let folderId;
    try {
        folderId = new mongo_1.ObjectId(folderIdStr);
    }
    catch {
        return res.status(400).send("Invalid folder id");
    }
    const db = (0, mongo_1.getDb)();
    const filesCol = db.collection("files");
    const files = await filesCol.find({ userId, folderId }).toArray();
    for (const file of files) {
        try {
            const filePath = node_path_1.default.resolve(file.storagePath);
            if (node_fs_1.default.existsSync(filePath)) {
                node_fs_1.default.unlinkSync(filePath);
            }
        }
        catch {
            // ignore individual delete errors
        }
    }
    await filesCol.deleteMany({ userId, folderId });
    return res.redirect("/folders");
});
exports.router.post("/folders/:id/delete", auth_1.requireAuth, async (req, res) => {
    const userIdStr = req.session.userId;
    const userId = new mongo_1.ObjectId(userIdStr);
    const folderIdStr = String(req.params.id);
    let folderId;
    try {
        folderId = new mongo_1.ObjectId(folderIdStr);
    }
    catch {
        return res.status(400).send("Invalid folder id");
    }
    const db = (0, mongo_1.getDb)();
    const filesCol = db.collection("files");
    const foldersCol = db.collection("folders");
    const files = await filesCol.find({ userId, folderId }).toArray();
    for (const file of files) {
        try {
            const filePath = node_path_1.default.resolve(file.storagePath);
            if (node_fs_1.default.existsSync(filePath)) {
                node_fs_1.default.unlinkSync(filePath);
            }
        }
        catch {
            // ignore individual delete errors
        }
    }
    await filesCol.deleteMany({ userId, folderId });
    await foldersCol.deleteOne({ _id: folderId, userId });
    return res.redirect("/folders");
});
exports.router.post("/folders", auth_1.requireAuth, async (req, res) => {
    const userIdStr = req.session.userId;
    const userId = new mongo_1.ObjectId(userIdStr);
    const { name } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).send("Folder name is required");
    }
    const db = (0, mongo_1.getDb)();
    const foldersCol = db.collection("folders");
    try {
        await foldersCol.insertOne({
            userId,
            name: name.trim(),
            createdAt: new Date(),
        });
    }
    catch (err) {
        if (err.code === 11000) {
            return res
                .status(400)
                .send("A folder with this name already exists for your account.");
        }
        // eslint-disable-next-line no-console
        console.error("Error creating folder", err);
        return res.status(500).send("Error creating folder");
    }
    return res.redirect("/folders");
});
exports.router.get("/folders/:id/download-all", auth_1.requireAuth, async (req, res) => {
    const userIdStr = req.session.userId;
    const userId = new mongo_1.ObjectId(userIdStr);
    const folderIdStr = String(req.params.id);
    let folderId;
    try {
        folderId = new mongo_1.ObjectId(folderIdStr);
    }
    catch {
        return res.status(404).send("Folder not found");
    }
    const db = (0, mongo_1.getDb)();
    const foldersCol = db.collection("folders");
    const filesCol = db.collection("files");
    const folder = await foldersCol.findOne({ _id: folderId, userId });
    if (!folder) {
        return res.status(404).send("Folder not found");
    }
    const files = await filesCol
        .find({
        userId,
        folderId,
    })
        .toArray();
    if (files.length === 0) {
        return res.status(404).send("No files available to download for this folder");
    }
    const safeName = folder.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="folder-${safeName || folderIdStr}.zip"`);
    res.setHeader("Content-Type", "application/zip");
    const archive = (0, archiver_1.default)("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
        // eslint-disable-next-line no-console
        console.error("Archive error", err);
        res.status(500).end();
    });
    archive.pipe(res);
    for (const file of files) {
        const filePath = node_path_1.default.resolve(file.storagePath);
        if (node_fs_1.default.existsSync(filePath)) {
            archive.file(filePath, { name: file.originalName });
        }
    }
    const dbAfter = (0, mongo_1.getDb)();
    const filesColAfter = dbAfter.collection("files");
    archive.finalize();
});
