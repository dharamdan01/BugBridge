import { lstat, realpath, readFile, mkdir } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";

// No symlinks/junctions in the path, including output files. Incident IDs never
// become paths. This assumes the local workspace is not concurrently hostile.
export async function checkedPath(root, name, { createParents = false } = {}) {
  const base = await realpath(root);
  const target = resolve(base, name);
  const local = relative(base, target);
  if (!local || isAbsolute(local) || local.split(sep).includes("..")) throw new Error("Unsafe incident path");
  const parts = local.split(sep);
  let current = base;
  for (let i = 0; i < parts.length; i++) {
    current = resolve(current, parts[i]);
    let info;
    try { info = await lstat(current); } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (createParents && i < parts.length - 1) {
        await mkdir(current);
        info = await lstat(current);
      } else if (createParents && i === parts.length - 1) return target;
      else throw new Error("Missing incident input");
    }
    if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile())) {
      throw new Error("Unsafe incident path");
    }
  }
  return target;
}

export async function readIncidentFile(root, name) {
  const path = await checkedPath(root, name);
  if ((await lstat(path)).size > 128 * 1024) throw new Error("Incident input too large");
  return readFile(path, "utf8");
}
