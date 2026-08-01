import { randomInt } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { githubRequest } from "./github.mjs";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif"]);

export function addedImageCandidate(file, commit) {
  if (file?.status !== "added" || typeof file.filename !== "string" || !file.sha) return null;
  const extension = file.filename.split(".").at(-1)?.toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) return null;
  return {
    project: commit.projectLabel,
    repositoryFullName: commit.repositoryFullName,
    blobSha: file.sha,
    extension: extension === "jpeg" ? "jpg" : extension,
  };
}

function safeProjectSlug(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "project";
}

function hasImageSignature(buffer, extension) {
  if (extension === "png") {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (extension === "jpg") return buffer[0] === 0xff && buffer[1] === 0xd8;
  if (extension === "gif") return ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  if (extension === "webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (extension === "avif") return buffer.subarray(4, 12).toString("ascii").includes("ftypavif");
  return false;
}

async function fetchImageBlob(token, candidate, maximumImageBytes) {
  const [owner, repository] = candidate.repositoryFullName.split("/");
  const blob = await githubRequest(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/blobs/${candidate.blobSha}`
  );
  if (blob.encoding !== "base64" || typeof blob.content !== "string") {
    throw new Error(`GitHub returned an unsupported image encoding for ${candidate.project}.`);
  }
  if (!Number.isInteger(blob.size) || blob.size <= 0 || blob.size > maximumImageBytes) {
    throw new Error(`An uploaded image for ${candidate.project} is outside the configured size limit.`);
  }
  const buffer = Buffer.from(blob.content.replace(/\s/g, ""), "base64");
  if (buffer.length !== blob.size || !hasImageSignature(buffer, candidate.extension)) {
    throw new Error(`An uploaded image for ${candidate.project} did not match its raster format.`);
  }
  return buffer;
}

export async function prepareProjectMedia({
  token,
  projects,
  candidates,
  date,
  targetDirectory,
  maximumImageBytes,
  chooseIndex = (length) => randomInt(length),
}) {
  const candidatesByProject = new Map();
  for (const candidate of candidates) {
    const current = candidatesByProject.get(candidate.project) ?? [];
    current.push(candidate);
    candidatesByProject.set(candidate.project, current);
  }

  const preparedProjects = [];
  const writtenPaths = [];
  for (let projectIndex = 0; projectIndex < projects.length; projectIndex += 1) {
    const project = projects[projectIndex];
    const available = [...(candidatesByProject.get(project.name) ?? [])];
    if (available.length === 0) {
      preparedProjects.push({ ...project, image: null });
      continue;
    }

    const selectedIndex = chooseIndex(available.length);
    const selected = available[selectedIndex];
    const buffer = await fetchImageBlob(token, selected, maximumImageBytes);
    const fileName = `${safeProjectSlug(project.name)}-${projectIndex + 1}.${selected.extension}`;
    const filePath = path.join(targetDirectory, fileName);
    await fs.mkdir(targetDirectory, { recursive: true });
    await fs.writeFile(filePath, buffer);
    writtenPaths.push(filePath);
    preparedProjects.push({
      ...project,
      image: `/build-in-public/${date}/${fileName}`,
    });
  }

  return { projects: preparedProjects, writtenPaths };
}
