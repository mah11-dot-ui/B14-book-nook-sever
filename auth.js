import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { betterAuth } from "better-auth";
import { MongoClient } from "mongodb";

let authInstance;
let mongoClient;

export function getMongoClient() {
  if (mongoClient) return mongoClient;

  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    throw new Error("MONGODB_URI must be configured.");
  }

  mongoClient = new MongoClient(mongoUri);
  return mongoClient;
}

export function getAuth() {
  if (authInstance) return authInstance;

  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || !baseURL) {
    throw new Error(
      "BETTER_AUTH_SECRET and BETTER_AUTH_URL must be configured for session validation.",
    );
  }

  const googleConfigured =
    Boolean(process.env.GOOGLE_CLIENT_ID) &&
    Boolean(process.env.GOOGLE_CLIENT_SECRET);

  authInstance = betterAuth({
    appName: "BookNook",
    baseURL,
    secret,
    database: mongodbAdapter(getMongoClient().db()),
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      password: { minLength: 6, maxLength: 128 },
    },
    socialProviders: googleConfigured
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {},
  });

  return authInstance;
}
