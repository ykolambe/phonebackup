import { MongoClient, Db, ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

let client: MongoClient | null = null;
let db: Db | null = null;

export async function initMongo(): Promise<void> {
  const uri = process.env.MONGO_URL || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGO_URL or MONGODB_URI env var is required");
  }

  const dbName = process.env.MONGO_DB_NAME || "phonebackup";

  client = new MongoClient(uri);
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
  const defaultMaxBytes =
    Number.isFinite(defaultMaxBytesEnv) && defaultMaxBytesEnv > 0
      ? defaultMaxBytesEnv
      : 2 * 1024 * 1024 * 1024; // 2GB
  const defaultPlanName = process.env.DEFAULT_PLAN_NAME || "free";

  await plans.updateOne(
    { name: defaultPlanName },
    {
      $setOnInsert: {
        name: defaultPlanName,
        maxBytes: defaultMaxBytes,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export function getDb(): Db {
  if (!db) {
    throw new Error("MongoDB has not been initialized. Call initMongo() first.");
  }
  return db;
}

export { ObjectId };

