import fs from "fs/promises";
import path from "path";

export const productsFile = "products.json";
export const ordersFile = "orders.json";
export const settingsFile = "settings.json";
export const profilesFile = "profiles.json";

const ALLOWED_DATA_FILES = new Set([
  productsFile,
  ordersFile,
  settingsFile,
  profilesFile,
]);

function resolveFilePath(fileOrName: string): string {
  if (path.isAbsolute(fileOrName)) return fileOrName;
  const safeName = path.basename(fileOrName);
  if (!ALLOWED_DATA_FILES.has(safeName)) {
    throw new Error(`Disallowed local data file access: ${safeName}`);
  }
  const customDir = process.env.AFRA_DATA_DIR;
  if (customDir) {
    return path.join(/*turbopackIgnore: true*/ customDir, safeName);
  }
  return path.join(process.cwd(), "data", safeName);
}

export async function readData(fileOrName: string, defaultVal: any = []) {
  const filePath = resolveFilePath(fileOrName);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      console.error(`[DB Error] Failed to read ${filePath}:`, error.message);
    }
    if (Array.isArray(defaultVal)) {
      return [];
    }
    return defaultVal;
  }
}

export async function writeData(fileOrName: string, data: any) {
  const filePath = resolveFilePath(fileOrName);
  try {
    const dir = path.dirname(filePath);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error: any) {
    console.error(`[DB Error] Failed to write ${filePath}:`, error.message);
    if (!process.env.VERCEL) throw error;
  }
}
