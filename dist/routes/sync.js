"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const mongo_1 = require("../db/mongo");
exports.router = (0, express_1.Router)();
async function authenticateSyncToken(req, res, next) {
    const authHeader = req.header("authorization") || req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing bearer token" });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
        return res.status(401).json({ error: "Invalid bearer token" });
    }
    const db = (0, mongo_1.getDb)();
    const tokens = db.collection("sync_tokens");
    const doc = await tokens.findOne({ token });
    if (!doc) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
    await tokens.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } });
    req.syncUserId = doc.userId.toHexString();
    return next();
}
exports.router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res
            .status(400)
            .json({ error: "Email and password are required" });
    }
    try {
        const db = (0, mongo_1.getDb)();
        const users = db.collection("users");
        const tokens = db.collection("sync_tokens");
        const user = await users.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(400).json({ error: "Invalid email or password" });
        }
        const ok = await bcrypt_1.default.compare(password, user.passwordHash);
        if (!ok) {
            return res.status(400).json({ error: "Invalid email or password" });
        }
        const token = node_crypto_1.default.randomBytes(32).toString("hex");
        await tokens.insertOne({
            userId: user._id,
            token,
            createdAt: new Date(),
        });
        return res.json({ token });
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        return res.status(500).json({ error: "Unexpected error" });
    }
});
exports.router.get("/pending", authenticateSyncToken, async (req, res) => {
    const userIdStr = req.syncUserId;
    const userId = new mongo_1.ObjectId(userIdStr);
    const db = (0, mongo_1.getDb)();
    const filesCol = db.collection("files");
    const pending = await filesCol
        .find({
        userId,
        $or: [{ syncedAt: { $exists: false } }, { syncedAt: null }],
    })
        .sort({ createdAt: 1 })
        .limit(100)
        .toArray();
    const items = pending.map((f) => ({
        id: f._id.toHexString(),
        batchId: f.batchId.toHexString(),
        originalName: f.originalName,
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt,
    }));
    return res.json(items);
});
exports.router.get("/files/:id", authenticateSyncToken, async (req, res) => {
    const userIdStr = req.syncUserId;
    const userId = new mongo_1.ObjectId(userIdStr);
    const fileIdStr = String(req.params.id);
    let fileId;
    try {
        fileId = new mongo_1.ObjectId(fileIdStr);
    }
    catch {
        return res.status(404).json({ error: "File not found" });
    }
    const db = (0, mongo_1.getDb)();
    const filesCol = db.collection("files");
    const file = await filesCol.findOne({
        _id: fileId,
        userId,
    });
    if (!file) {
        return res.status(404).json({ error: "File not found" });
    }
    const filePath = node_path_1.default.resolve(file.storagePath);
    if (!node_fs_1.default.existsSync(filePath)) {
        return res.status(404).json({ error: "File missing on server" });
    }
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", file.sizeBytes.toString());
    const stream = node_fs_1.default.createReadStream(filePath);
    stream.on("error", (err) => {
        // eslint-disable-next-line no-console
        console.error("Stream error", err);
        res.status(500).end();
    });
    stream.pipe(res);
});
exports.router.post("/mark-synced", authenticateSyncToken, async (req, res) => {
    const userIdStr = req.syncUserId;
    const userId = new mongo_1.ObjectId(userIdStr);
    const { fileIds } = req.body;
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: "fileIds array is required" });
    }
    const objectIds = [];
    for (const id of fileIds) {
        try {
            objectIds.push(new mongo_1.ObjectId(id));
        }
        catch {
            // skip invalid ids
        }
    }
    if (objectIds.length === 0) {
        return res.status(400).json({ error: "No valid file IDs provided" });
    }
    const db = (0, mongo_1.getDb)();
    const filesCol = db.collection("files");
    const result = await filesCol.updateMany({
        _id: { $in: objectIds },
        userId,
    }, {
        $set: {
            syncedAt: new Date(),
            syncedBy: userId,
        },
    });
    return res.json({ updatedCount: result.modifiedCount });
});
