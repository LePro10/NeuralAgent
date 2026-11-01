// Files explorer: the icon and colour of an entry, and its small git letter.
import type { FileEntry, GitFileStatus } from "@neuralagent/protocol";
import { cn, type SysColor } from "@neuralagent/ui";
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderGit2,
  FolderLock,
  type LucideIcon,
} from "lucide-react";
import { GIT_LABEL, GIT_LETTER, langOf } from "./model";

const ext = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "bmp", "ico", "avif", "tif", "tiff"]);
const VIDEO = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v"]);
const AUDIO = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"]);
const ARCHIVE = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "dmg", "apk", "aab", "jar"]);
const SHEET = new Set(["csv", "tsv", "xls", "xlsx", "numbers", "ods"]);
const DOC = new Set(["md", "markdown", "mdx", "txt", "rtf", "pdf", "doc", "docx", "pages", "log"]);

/** Icon and tile colour for a file or folder name. */
export function iconOf(e: Pick<FileEntry, "name" | "dir" | "protected">): { Icon: LucideIcon; color: SysColor } {
  if (e.dir) {
    if (e.protected) return { Icon: FolderLock, color: "gray" };
    if (e.name === ".git") return { Icon: FolderGit2, color: "gray" };
    return { Icon: Folder, color: "blue" };
  }
  const x = ext(e.name);
  if (IMAGE.has(x)) return { Icon: FileImage, color: "purple" };
  if (VIDEO.has(x)) return { Icon: FileVideo, color: "pink" };
  if (AUDIO.has(x)) return { Icon: FileAudio, color: "pink" };
  if (ARCHIVE.has(x)) return { Icon: FileArchive, color: "yellow" };
  if (SHEET.has(x)) return { Icon: FileSpreadsheet, color: "green" };
  if (x === "json" || x === "jsonc") return { Icon: FileJson, color: "orange" };
  if (DOC.has(x)) return { Icon: FileText, color: x === "pdf" ? "red" : "gray" };
  if (langOf(e.name)) return { Icon: FileCode, color: "teal" };
  return { Icon: File, color: "gray" };
}

const TONE: Record<GitFileStatus, string> = {
  modified: "text-warning",
  added: "text-success",
  untracked: "text-success",
  deleted: "text-danger",
  renamed: "text-info",
  conflicted: "text-danger",
};

/** "M", "U", … in the git colour; folders show a dot (something inside changed). */
export function GitMark({ status, dir, className }: { status: GitFileStatus; dir?: boolean; className?: string }) {
  return (
    <span className={cn("shrink-0 font-mono text-caption", TONE[status], className)} title={dir ? `${GIT_LABEL[status]} inside` : GIT_LABEL[status]}>
      {dir ? "●" : GIT_LETTER[status]}
    </span>
  );
}
