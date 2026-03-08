import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const HASH_COST = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(String(password), salt, HASH_COST)
    .toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  const normalized = String(storedHash || "");
  const [salt, hash] = normalized.split(":");
  if (!salt || !hash) {
    return false;
  }

  const candidateHash = crypto
    .scryptSync(String(password), salt, HASH_COST)
    .toString("hex");

  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(candidateHash, "hex");

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

export function signAuthToken(user, config) {
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      email: user.email,
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn,
    },
  );
}

export function verifyAuthToken(token, config) {
  return jwt.verify(token, config.jwtSecret);
}
