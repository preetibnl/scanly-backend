import jwt from "jsonwebtoken";

const getJwtSecret = () => {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET is missing or too short. Set a random string of at least 32 characters in .env",
    );
  }
  return secret;
};

const userExpiresIn = process.env.JWT_EXPIRES_IN || "7d";
const adminExpiresIn = process.env.ADMIN_JWT_EXPIRES_IN || "12h";

export const signUserToken = (user) => {
  const id = String(user._id || user.id);
  return jwt.sign(
    {
      sub: id,
      email: String(user.email || "").toLowerCase(),
      role: "user",
    },
    getJwtSecret(),
    { expiresIn: userExpiresIn },
  );
};

export const signAdminToken = (admin) => {
  return jwt.sign(
    {
      sub: String(admin.email || "").toLowerCase(),
      role: "admin",
    },
    getJwtSecret(),
    { expiresIn: adminExpiresIn },
  );
};

export const verifyToken = (token) => jwt.verify(token, getJwtSecret());
