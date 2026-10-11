/** Saves text as a file through the browser's normal download flow. */
export function downloadText(fileName: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Copies text to the clipboard. Throws a readable error if the browser refuses. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    throw new Error('Could not copy to the clipboard. Click inside the page and try again.');
  }
}

/** Reads a user-chosen file as text, with a size guard. */
export function readFileText(file: File, maxBytes: number): Promise<string> {
  if (file.size > maxBytes) {
    return Promise.reject(new Error(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`));
  }
  return file.text();
}
