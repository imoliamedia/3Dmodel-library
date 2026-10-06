import { isModelFile, extOf } from './loaders.js';
import { addModel, updateModel } from './db.js';

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
  // .mtl files carry the OBJ colours; they are not models themselves but get attached to their OBJ.
  const mtlFiles = new Map(list.filter((f) => extOf(f.name) === 'mtl').map((f) => [f.name.toLowerCase(), f]));
  const known = new Map(existing.map((m) => [`${m.name}|${m.size}|${m.lastModified}`, m]));
  const result = { added: [], updated: [], dupes: 0, skipped: list.length - models.length - mtlFiles.size };

  let done = 0;
  for (const file of models) {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    const mtl = file.name.toLowerCase().endsWith('.obj') ? await findMtl(file, mtlFiles) : '';
    const match = known.get(key);
    if (match) {
      if (mtl && !match.mtl) {
        // Same OBJ added earlier without its colours: attach them and rebuild the preview.
        const updated = { ...match, mtl, hasThumb: false, thumbFailed: false };
        await updateModel(updated);
        result.updated.push(updated);
      } else {
        result.dupes++;
      }
    } else {
      // files that come from the linked disk folder: the first sub folder becomes the app folder
      const folder = file._path ? '' : folderOf(file);
      const meta = {
        id: crypto.randomUUID(),
        name: file.name,
        ext: extOf(file.name),
        size: file.size,
        lastModified: file.lastModified,
        title: '',
        folder: file._path?.length > 1 ? file._path[0] : '',
        tags: folder ? [folder] : [],
        note: '',
        fav: false,
        added: Date.now(),
        dims: null,
        hasThumb: false,
        thumbFailed: false,
        ...(mtl ? { mtl } : {}),
        ...(file._path ? { path: file._path } : {}),
      };
      await addModel(meta, file);
      known.set(key, meta);
      result.added.push(meta);
    }
    done++;
    onProgress?.(done, models.length);
  }
  return result;
}

/** Look up the .mtl an OBJ points to (mtllib line) among the files added together. */
async function findMtl(objFile, mtlFiles) {
  if (!mtlFiles.size) return '';
  const head = await objFile.slice(0, 65536).text();
  const m = head.match(/^mtllib\s+(.+)$/m);
  if (!m) return '';
  const file = mtlFiles.get(m[1].trim().split(/[\\/]/).pop().toLowerCase());
  return file ? file.text() : '';
}

// Folder names that say nothing about the model, so they are not turned into tags.
const GENERIC_FOLDERS = new Set([
  'downloads', 'download', 'files', 'file', 'documents', 'documenten', 'desktop', 'bureaublad',
  'models', 'model', 'modellen', 'stl', 'stls', 'stl files', 'stl-files', 'obj', 'objs', '3mf', '3mfs',
  '3d', '3d models', '3d printing', '3d print', '3dprint', '3d-print', 'prints', 'print', 'printing',
  'new folder', 'nieuwe map', 'temp', 'tmp', 'untitled', 'misc', 'diversen', 'various', 'other', 'overig',
  'onedrive', 'dropbox', 'google drive', 'mijn drive', 'my drive', 'pictures', 'afbeeldingen', 'data', 'src',
]);

/** Last folder name of a file's path, lower-case, or '' when missing or generic. */
function folderOf(file) {
  const path = file._folder || (file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(0, -1).join('/') : '');
  const name = path.split('/').pop().trim().toLowerCase();
  return !name || GENERIC_FOLDERS.has(name) ? '' : name;
}
