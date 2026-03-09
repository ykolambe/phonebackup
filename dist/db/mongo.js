"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectId = void 0;
exports.initMongo = initMongo;
exports.getDb = getDb;
const mongodb_1 = require("mongodb");
Object.defineProperty(exports, "ObjectId", { enumerable: true, get: function () { return mongodb_1.ObjectId; } });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
let client = null;
let db = null;
async function initMongo() {
    const uri = process.env.MONGO_URL || process.env.MONGODB_URI;
    if (!uri) {
        throw new Error("MONGO_URL or MONGODB_URI env var is required");
    }
    const dbName = process.env.MONGO_DB_NAME || "phonebackup";
    client = new mongodb_1.MongoClient(uri);
    await client.connect();
    db = client.db(dbName);
    // Basic indexes for uniqueness and query performance
    const users = db.collection("users");
    const uploadLinks = db.collection("upload_links");
    const batches = db.collection("upload_batches");
    const files = db.collection("files");
    const folders = db.collection("folders");
    const plans = db.collection("plans");
    await users.createIndex({ email: 1 }, { unique: true });
    await uploadLinks.createIndex({ slug: 1 }, { unique: true });
    await uploadLinks.createIndex({ userId: 1 });
    await batches.createIndex({ userId: 1, createdAt: -1 });
    await files.createIndex({ batchId: 1, userId: 1 });
    await files.createIndex({ userId: 1, folderId: 1, createdAt: -1 });
    await files.createIndex({ userId: 1 });
    await folders.createIndex({ userId: 1 });
    await folders.createIndex({ userId: 1, name: 1 }, { unique: true });
    const defaultMaxBytesEnv = Number(process.env.DEFAULT_MAX_BYTES || "");
    const defaultMaxBytes = Number.isFinite(defaultMaxBytesEnv) && defaultMaxBytesEnv > 0
        ? defaultMaxBytesEnv
        : 2 * 1024 * 1024 * 1024; // 2GB
    const defaultPlanName = process.env.DEFAULT_PLAN_NAME || "free";
    await plans.updateOne({ name: defaultPlanName }, {
        $setOnInsert: {
            name: defaultPlanName,
            maxBytes: defaultMaxBytes,
            createdAt: new Date(),
        },
    }, { upsert: true });
}
function getDb() {
    if (!db) {
        throw new Error("MongoDB has not been initialized. Call initMongo() first.");
    }
    return db;
}
