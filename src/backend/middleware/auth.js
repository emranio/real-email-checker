import { verifyAuthToken } from "../services/authSecurity.js";

export function requireAuth(config) {
  return (req, res, next) => {
    const authorization = String(req.headers.authorization || "");
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({
        ok: false,
        error: "missing_bearer_token",
      });
    }

    try {
      const payload = verifyAuthToken(match[1], config);
      req.auth = {
        userId: Number(payload.sub),
      };
      return next();
    } catch {
      return res.status(401).json({
        ok: false,
        error: "invalid_or_expired_token",
      });
    }
  };
}
