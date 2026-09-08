import dns from "node:dns";

import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Optional override for the resolvers used by the `mongodb+srv://` SRV lookup.
 * Set MONGODB_DNS_SERVERS (e.g. "8.8.8.8,1.1.1.1") when the local network
 * resolver refuses SRV queries (`querySrv ECONNREFUSED` / ` ENOTFOUND`).
 */
if (process.env.MONGODB_DNS_SERVERS) {
  dns.setServers(
    process.env.MONGODB_DNS_SERVERS.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

/**
 * Reuse a single Mongoose connection across requests.
 *
 * In development the module is re-evaluated on every hot reload, and in a
 * serverless production environment each function invocation can spin up a new
 * module scope. Stashing the connection (and the in-flight connection promise)
 * on `globalThis` keeps us from opening a new socket every time.
 */
let cached = globalThis._mongoose;

if (!cached) {
  cached = globalThis._mongoose = { conn: null, promise: null };
}

export async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!MONGODB_URI) {
    throw new Error(
      "Missing MONGODB_URI environment variable. Copy .env.example to .env.local and set it."
    );
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      // Fail fast instead of buffering queries while disconnected.
      bufferCommands: false,
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    // Allow a later call to retry instead of caching a rejected promise.
    cached.promise = null;
    throw error;
  }

  return cached.conn;
}

export default connectToDatabase;
