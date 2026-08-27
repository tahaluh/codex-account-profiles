import * as path from "node:path";
import { promises as fs } from "node:fs";

export async function writeJsonAtomic(filePath: string, value: unknown, mode = 0o600): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(value, null, 2), mode);
}

export async function writeFileAtomic(filePath: string, content: string, mode = 0o600): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  await fs.writeFile(tempPath, content, { mode });
  try {
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, mode).catch(() => undefined);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
