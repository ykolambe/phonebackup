export async function initDb(): Promise<void> {
  // For backward compatibility with server bootstrap, this function now
  // simply initializes the MongoDB connection and indexes.
  const { initMongo } = await import("./mongo");
  await initMongo();
}
