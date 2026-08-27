import { supabase } from './supabase';

/**
 * Photos and OTDR traces from the field.
 *
 * THE HARD PART IS NOT THE UPLOAD, IT IS THE SIZE. A photo off a modern phone is
 * 3-12 MB. A splicer standing in a manhole at 2am has one or two bars, and a
 * 12 MB upload over that either takes minutes or times out and loses the lot.
 * So every image is resized and re-encoded in the browser BEFORE it goes
 * anywhere — a 4032x3024 original lands around 250-400 KB, which uploads on bad
 * signal and is still far more detail than anyone needs to see a cable count or
 * a damaged buffer tube.
 *
 * Non-images (.sor traces) are uploaded untouched. Never re-encode a trace file;
 * it is instrument data, not a picture.
 */

export const BUCKET = 'attachments';

/** Longest edge after resizing. Enough to read a date code off a jacket. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/** Anything bigger than this refuses to upload rather than hanging on a bad link. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type AttachmentKind = 'photo' | 'otdr' | 'test_pkg' | 'other';

export interface AttachmentRow {
  id: string;
  location_id: string | null;
  visit_id: string | null;
  job_id: string | null;
  kind: AttachmentKind;
  storage_path: string;
  filename: string | null;
  created_at: string;
  uploaded_by: string | null;
}

export interface AttachmentView extends AttachmentRow {
  /** Short-lived link. The bucket is private; there is no permanent URL. */
  url: string | null;
}

const isImage = (f: File) => f.type.startsWith('image/');

/** .sor is an OTDR trace. Browsers report no MIME type for it. */
export function kindForFile(f: File): AttachmentKind {
  if (isImage(f)) return 'photo';
  if (/\.sor$/i.test(f.name)) return 'otdr';
  if (/\.(pdf|xlsx|xls|csv)$/i.test(f.name)) return 'test_pkg';
  return 'other';
}

/**
 * Shrink a photo in the browser. Returns the original untouched if anything at
 * all goes wrong — a slightly slow upload beats a lost photo, and some phones
 * (HEIC on non-Safari, mostly) simply cannot be decoded here.
 */
export async function compressImage(file: File): Promise<Blob> {
  if (!isImage(file)) return file;
  try {
    // `imageOrientation: 'from-image'` matters: phone photos carry EXIF rotation
    // and drawing them to a canvas without it silently turns them sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 900_000) {
      bitmap.close?.();
      return file;                       // already small; leave it alone
    }
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));

    // If re-encoding somehow made it bigger, keep the original.
    if (!blob || blob.size >= file.size) return file;
    return blob;
  } catch {
    return file;
  }
}

function extensionFor(file: File, blob: Blob): string {
  if (blob !== (file as unknown as Blob) && blob.type === 'image/jpeg') return 'jpg';
  const m = /\.([A-Za-z0-9]+)$/.exec(file.name);
  return (m?.[1] ?? 'bin').toLowerCase();
}

/**
 * Put one file in the bucket and record it against a location.
 *
 * Storage path is job/location/uuid so the bucket stays browsable by a human
 * when something needs digging out by hand, and so two techs uploading
 * "IMG_0001.jpg" at the same hole never collide.
 */
export async function uploadAttachment(opts: {
  file: File;
  jobId: string;
  visitId?: string | null;
  locationId: string;
  uploadedBy?: string | null;
}): Promise<AttachmentRow> {
  const { file, jobId, visitId, locationId, uploadedBy } = opts;

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB — too big to send from the field.`);
  }

  const body = await compressImage(file);
  const ext = extensionFor(file, body);
  const id = (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${jobId}/${locationId}/${id}.${ext}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: body.type || file.type || 'application/octet-stream',
    upsert: false,
  });
  if (upErr) throw new Error(`Could not upload ${file.name}: ${upErr.message}`);

  const { data, error } = await supabase.from('attachments').insert({
    job_id: jobId,
    visit_id: visitId ?? null,
    location_id: locationId,
    kind: kindForFile(file),
    storage_path: path,
    filename: file.name,
    uploaded_by: uploadedBy ?? null,
  }).select('*').single();

  if (error || !data) {
    // The file is in the bucket but nothing points at it. Take it back out
    // rather than leaving an orphan nobody can find or clean up.
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`Uploaded ${file.name} but could not record it: ${error?.message ?? 'no row returned'}`);
  }
  return data as AttachmentRow;
}

/** Everything attached to one location, newest first, with viewable links. */
export async function listForLocation(locationId: string): Promise<AttachmentView[]> {
  const { data } = await supabase
    .from('attachments')
    .select('*')
    .eq('location_id', locationId)
    .order('created_at', { ascending: false });

  const rows = (data ?? []) as AttachmentRow[];
  if (!rows.length) return [];

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), 3600);

  const byPath = new Map((signed ?? []).map((s: any) => [s.path, s.signedUrl]));
  return rows.map((r) => ({ ...r, url: byPath.get(r.storage_path) ?? null }));
}

/** Office/admin only — the storage policy enforces it too. */
export async function deleteAttachment(a: AttachmentRow): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([a.storage_path]);
  if (error) throw new Error(`Could not remove the file: ${error.message}`);
  const { error: rErr } = await supabase.from('attachments').delete().eq('id', a.id);
  if (rErr) throw new Error(`File removed but the record stayed: ${rErr.message}`);
}
