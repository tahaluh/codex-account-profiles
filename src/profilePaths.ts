import * as path from "node:path";

export function isPathInsideRoots(candidatePath: string, rootPaths: string[]): boolean {
  const candidate = path.resolve(candidatePath);
  return rootPaths.some((rootPath) => {
    const relative = path.relative(path.resolve(rootPath), candidate);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
}
