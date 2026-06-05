const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const [inputPath, outputPath] = process.argv.slice(2);
const password = process.env.MAXEL_DATA_PASSWORD;

if (!inputPath || !outputPath || !password) {
  console.error("Usage: MAXEL_DATA_PASSWORD=<password> node tools/encrypt-data.js <input.json> <output.enc.json>");
  process.exit(1);
}

const plaintext = fs.readFileSync(path.resolve(inputPath));
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const iterations = 250000;
const key = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();

const payload = {
  version: 1,
  algorithm: "AES-256-GCM",
  kdf: "PBKDF2-SHA256",
  iterations,
  salt: salt.toString("base64"),
  iv: iv.toString("base64"),
  tag: tag.toString("base64"),
  ciphertext: ciphertext.toString("base64")
};

fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(payload, null, 2)}\n`);
