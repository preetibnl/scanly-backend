import { verifyToken } from "../utils/jwt.js";

const getBearerToken = (req) => {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
};

export const authenticateUser = (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const payload = verifyToken(token);
    if (payload.role !== "user" || !payload.sub) {
      return res.status(401).json({ message: "Invalid authentication token" });
    }
    req.userId = payload.sub;
    req.auth = { role: "user", userId: payload.sub, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

export const authenticateAdmin = (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: "Admin authentication required" });
  }

  try {
    const payload = verifyToken(token);
    if (payload.role !== "admin" || !payload.sub) {
      return res.status(401).json({ message: "Invalid admin token" });
    }
    req.adminEmail = payload.sub;
    req.auth = { role: "admin", email: payload.sub };
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired admin token" });
  }
};

/** Ensures route :id matches the authenticated user (for profile, allergies, delete). */
export const requireSelfUserId =
  (paramName = "id") =>
  (req, res, next) => {
    const routeId = String(req.params[paramName] || "");
    if (!routeId || routeId !== String(req.userId)) {
      return res.status(403).json({ message: "You can only access your own account" });
    }
    return next();
  };
