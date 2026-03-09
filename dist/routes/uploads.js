"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const mongo_1 = require("../db/mongo");
const auth_1 = require("./auth");
const qrcode_1 = __importDefault(require("qrcode"));
exports.router = (0, express_1.Router)();
const STORAGE_ROOT = process.env.STORAGE_ROOT || node_path_1.default.join(process.cwd(), "uploads");
node_fs_1.default.mkdirSync(STORAGE_ROOT, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination(_req, _file, cb) {
        cb(null, STORAGE_ROOT);
    },
    filename(_req, file, cb) {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\\-_]/g, "_");
        const timestamp = Date.now();
        cb(null, `${timestamp}_${safeName}`);
    },
});
const upload = (0, multer_1.default)({ storage });
async function getOrCreateUploadLink(userId) {
    const db = (0, mongo_1.getDb)();
    const uploadLinks = db.collection("upload_links");
    const existing = await uploadLinks.findOne({ userId: new mongo_1.ObjectId(userId) });
    if (existing) {
        return existing.slug;
    }
    const slug = Math.random().toString(36).slice(2, 10);
    await uploadLinks.insertOne({
        userId: new mongo_1.ObjectId(userId),
        slug,
        createdAt: new Date(),
    });
    return slug;
}
async function getMaxBytesForUser(userId) {
    const db = (0, mongo_1.getDb)();
    const usersCol = db.collection("users");
    const plansCol = db.collection("plans");
    const defaultMaxBytesEnv = Number(process.env.DEFAULT_MAX_BYTES || "");
    const defaultMaxBytes = Number.isFinite(defaultMaxBytesEnv) && defaultMaxBytesEnv > 0
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
exports.router.get("/settings", auth_1.requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const slug = await getOrCreateUploadLink(userId);
    const db = (0, mongo_1.getDb)();
    const filesCol = db.collection("files");
    const agg = await filesCol
        .aggregate([
        { $match: { userId: new mongo_1.ObjectId(userId) } },
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
    const maxBytes = await getMaxBytesForUser(new mongo_1.ObjectId(userId));
    const portalBaseUrl = process.env.BASE_URL || `${req.protocol}://${req.headers.host}`;
    const uploadUrl = `${portalBaseUrl}/u/${slug}`;
    let uploadQrDataUrl = null;
    try {
        uploadQrDataUrl = await qrcode_1.default.toDataURL(uploadUrl);
    }
    catch {
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
exports.router.get("/u/:slug", async (req, res) => {
    const { slug } = req.params;
    const db = (0, mongo_1.getDb)();
    const uploadLinks = db.collection("upload_links");
    const users = db.collection("users");
    const foldersCol = db.collection("folders");
    const link = await uploadLinks.findOne({ slug });
    if (!link) {
        return res.status(404).send("Invalid upload link");
    }
    const sessionUserId = req.session.userId;
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
    // #region agent log
    fetch("http://127.0.0.1:7243/ingest/cec716d8-6347-4395-8650-453b78f130af", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "23c470",
        },
        body: JSON.stringify({
            sessionId: "23c470",
            runId: "mobile-upload",
            hypothesisId: "H1",
            location: "src/routes/uploads.ts:/u/:slug",
            message: "Render upload page",
            data: {
                userAgent: req.headers["user-agent"] || "",
            },
            timestamp: Date.now(),
        }),
    }).catch(() => { });
    // #endregion
    const ownerEmail = owner.email;
    return res.render("upload", { ownerEmail, slug, folders });
});
exports.router.post("/u/:slug/upload", upload.array("files", 50), async (req, res) => {
    const { slug } = req.params;
    const files = (req.files || []);
    const db = (0, mongo_1.getDb)();
    const uploadLinks = db.collection("upload_links");
    const foldersCol = db.collection("folders");
    const filesCol = db.collection("files");
    const link = await uploadLinks.findOne({ slug });
    if (!link) {
        return res.status(404).send("Invalid upload link");
    }
    const sessionUserId = req.session.userId;
    const linkUserId = link.userId.toHexString();
    if (!sessionUserId || sessionUserId !== linkUserId) {
        const next = encodeURIComponent(req.originalUrl);
        return res.redirect(`/login?next=${next}`);
    }
    const userId = link.userId;
    const { folderId } = req.body;
    if (!folderId) {
        return res.status(400).send("A folder must be selected.");
    }
    let folderObjectId;
    try {
        folderObjectId = new mongo_1.ObjectId(folderId);
    }
    catch {
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
        .aggregate([
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
                if (file.path && node_fs_1.default.existsSync(file.path)) {
                    node_fs_1.default.unlinkSync(file.path);
                }
            }
            catch {
                // ignore
            }
        }
        return res
            .status(400)
            .send("Storage limit reached (2GB). Please delete existing files from the server before uploading more.");
    }
    try {
        const batches = db.collection("upload_batches");
        const now = new Date();
        const batchInsert = await batches.insertOne({
            userId,
            folderId: folderObjectId,
            title: null,
            createdAt: now,
        });
        const batchId = batchInsert.insertedId;
        if (files.length > 0) {
            await filesCol.insertMany(files.map((file) => ({
                userId,
                batchId,
                folderId: folderObjectId,
                originalName: file.originalname,
                mimeType: file.mimetype,
                sizeBytes: file.size,
                storagePath: file.path,
                createdAt: now,
            })));
        }
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        return res.status(500).send("Error saving uploaded files");
    }
    return res.render("upload_success");
});
