import fs from "node:fs";
import path from "node:path";
import { getDb, ObjectId } from "./mongo";

interface DeleteUserDataOptions {
  deleteUser: boolean;
}

export async function deleteUserData(
  userId: ObjectId,
  opts: DeleteUserDataOptions,
): Promise<void> {
  const db = getDb();

  const filesCol = db.collection<{
    _id: ObjectId;
    userId: ObjectId;
    storagePath: string;
  }>("files");
  const batchesCol = db.collection("upload_batches");
  const linksCol = db.collection("upload_links");
  const foldersCol = db.collection("folders");
  const usersCol = db.collection("users");

  const files = await filesCol.find({ userId }).toArray();
  for (const file of files) {
    try {
      const filePath = path.resolve(file.storagePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore individual delete errors
    }
  }

  await Promise.all([
    filesCol.deleteMany({ userId }),
    batchesCol.deleteMany({ userId }),
    linksCol.deleteMany({ userId }),
    foldersCol.deleteMany({ userId }),
  ]);

  if (opts.deleteUser) {
    await usersCol.deleteOne({ _id: userId });
  }
}

