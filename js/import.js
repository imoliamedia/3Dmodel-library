import { isModelFile, extOf } from './loaders.js';
import { addModel } from './db.js';

/** Collect File objects from a drop event, including dropped folders. */
export async function filesFromDrop(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];

  const out = [];
  const walk = async (entry, path) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, folder: path });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, path ? `${path}/${entry.name}` : entry.name);
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e, '');
  return out.map((o) => Object.assign(o.file, { _folder: o.folder }));
}

/**
 * Add files to the library. Skips non-model files and duplicates (same name+size+modified).
 * Returns { added: meta[], dupes, skipped }.
 */
export async function importFiles(files, existing, onProgress) {
  const list = [...files].filter((f) => f && f.name);
  const models = list.filter((f) => isModelFile(f.name));
  const seen = new Set(existing.map((m) => `${m.name}|${m.size}|${m.lastModified}`));
  const result = { added: [], dupes: 0, skipped: list.length - models.length };

  let done = 0;
  for (const file of models) {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (seen.has(key)) {
      result.dupes++;
    } else {
      seen.add(key);
      // Folder names are useful hints: prefill them as a tag, so a user's own structure is not lost.
      const folder = file._folder || (file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(0, -1).pop() : '');
      const meta = {
        id: crypto.randomUUID(),
        name: file.name,
        ext: extOf(file.name),
        size: file.size,
        lastModified: file.lastModified,
        title: '',
        tags: folder ? [folder.toLowerCase()] : [],
        note: '',
        fav: false,
        added: Date.now(),
        dims: null,
        hasThumb: false,
        thumbFailed: false,
      };
      await addModel(meta, file);
      result.added.push(meta);
    }
    done++;
    onProgress?.(done, models.length);
  }
  return result;
}
