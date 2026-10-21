import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";

const profileImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const kycDocumentTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"],
]);

export function profileImageUpload() {
  const destination = path.resolve(process.cwd(), "uploads", "profiles");
  fs.mkdirSync(destination, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination,
      filename: (_req, file, callback) => {
        const extension = profileImageTypes.get(file.mimetype);
        callback(null, `${randomUUID()}${extension ?? ".bin"}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (!profileImageTypes.has(file.mimetype)) {
        callback(new Error("Profile image must be JPEG, PNG, or WebP"));
        return;
      }
      callback(null, true);
    },
  }).single("profileImage");
}

export function catalogImageUpload() {
  const destination = path.resolve(process.cwd(), "uploads", "catalog");
  fs.mkdirSync(destination, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination,
      filename: (_req, file, callback) => {
        const extension = profileImageTypes.get(file.mimetype);
        callback(null, `${randomUUID()}${extension ?? ".bin"}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (!profileImageTypes.has(file.mimetype)) {
        callback(new Error("Catalog image must be JPEG, PNG, or WebP"));
        return;
      }
      callback(null, true);
    },
  }).single("image");
}

export function vendorKycDocumentUpload() {
  const destination = path.resolve(
    process.cwd(),
    "storage",
    "private",
    "vendor-kyc",
  );
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 2, fieldSize: 16 * 1024 },
    fileFilter: (_req, file, callback) => {
      if (!kycDocumentTypes.has(file.mimetype)) {
        callback(new Error("KYC document must be JPEG, PNG, WebP, or PDF"));
        return;
      }
      callback(null, true);
    },
  }).fields([
    { name: "frontImage", maxCount: 1 },
    { name: "backImage", maxCount: 1 },
  ]);
}
